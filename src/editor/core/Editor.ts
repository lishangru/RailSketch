import type { Crossing, DiagramElement, DirectionMarkerElement, LabelElement, LineElement, PlatformElement, Point, RailDocument, RailwayNode, StationKind, TrackElement } from '../../types'
import { v4 as uuidv4 } from 'uuid'
import { Camera, MAX_ZOOM, MIN_ZOOM } from './Camera'
import { EditorState, type EditorTool, type SelectedPoint } from './EditorState'
import { CommandManager } from '../commands/CommandManager'
import type { Command } from '../commands/Command'
import { AddTrackCommand } from '../commands/AddTrackCommand'
import { CompositeCommand } from '../commands/CompositeCommand'
import { AddElementCommand } from '../commands/AddElementCommand'
import { DeleteElementCommand } from '../commands/DeleteElementCommand'
import { DeletePointCommand } from '../commands/DeletePointCommand'
import { EraserCommand } from '../commands/EraserCommand'
import { UpdateElementCommand } from '../commands/UpdateElementCommand'
import { MovePointCommand, captureBoundNodes } from '../commands/MovePointCommand'
import {
  AddVertexLinkCommand,
  ConnectCrossingCommand,
  CreateParallelTracksCommand,
  CrossingToSwitchCommand,
  DisconnectJunctionCommand,
  InsertVertexCommand,
  MergeNodesCommand,
  MoveNodeCommand,
  MoveSegmentCommand,
  ReverseTrackCommand,
  SetNodeTypeCommand,
  SplitNodeCommand,
  DeleteNodeCommand,
} from '../commands/TopologyCommands'

import { Renderer } from '../render/Renderer'
import { labelBoxSize, labelDrawnRange } from '../render/LabelRenderer'
import { createTrack } from '../model/Track'
import { createLine } from '../model/Line'
import { createPlatform } from '../model/Platform'
import { createLabel } from '../model/Label'
import { createStation, isStationOnTrack } from '../model/Station'
import { isDirectionMarker, isLabel, isLine, isPlatform, isStation, isTrack, migrateDocument } from '../model/Document'
import { hitTest, type HitResult } from '../geometry/HitTest'
import { snapToGrid, snapToPoints, snapToTrackLines, DEFAULT_SNAP_PIXELS } from '../geometry/Snap'
import { snapToRailAngle } from '../geometry/angle'
import { snapToAlignment, snapGuideToGrid, intersectionWithGuide, ALIGNMENT_SNAP_PIXELS, type AlignmentGuide } from '../geometry/Alignment'
import {
  computeSegmentSpan,
  ensureTrackEndpoints,
  findNodeNear,
  getConnectedTracks,
  getNode,
  mergeNodes,
  moveNodeTo,
  rebuildNodeConnectivity,
  reverseTrack,
  splitNode,
  splitTrackAtPoint,
  validateTopology,
} from '../topology/Topology'
import { createRailwayNode } from '../model/RailwayNode'
import { createDirectionMarker } from '../model/DirectionMarker'
import { clamp, distance } from '../geometry/Point'
import { segmentIntersection } from '../geometry/Segment'
import { offsetPolyline } from '../geometry/Offset'
import { PointerController } from '../interaction/PointerController'
import { PanController } from '../interaction/PanController'
import { SelectionController } from '../interaction/SelectionController'
import { DrawTrackController } from '../interaction/DrawTrackController'
import { DragController } from '../interaction/DragController'
import { SwitchController } from '../interaction/SwitchController'
import { NodeController } from '../interaction/NodeController'
import { SegmentController } from '../interaction/SegmentController'
import { EraserController } from '../interaction/EraserController'

export type RequestLabelPlacement = (world: Point) => void

export type CanvasContextMenu =
  | { kind: 'canvas'; screen: Point }
  | { kind: 'track'; screen: Point; trackId: string }
  | { kind: 'node'; screen: Point; nodeId: string }
  | { kind: 'intersection'; screen: Point; point: Point; trackAId: string; trackBId: string }
  | { kind: 'marker'; screen: Point; markerId: string }

/** 折线顶点的拓扑连接规划：复用节点 / 插点建道岔（不拆线）/ 新建端点。 */
type TrackVertexPlan =
  | { kind: 'node'; nodeId: string; point: Point }
  | { kind: 'insert'; trackId: string; point: Point }
  | { kind: 'new'; point: Point }

/**
 * Editor Core。不依赖 Vue / Pinia。持有 Document、
 * Camera、渲染器、交互控制器与命令栈。Vue 组件仅通过有限
 * 的回调（onChange / onSelectionChange 等）订阅 UI 需要的状态。
 */
export class Editor {
  readonly camera = new Camera()
  readonly state = new EditorState()
  readonly commands = new CommandManager()
  readonly renderer = new Renderer()

  document: RailDocument

  private canvas: HTMLCanvasElement | null = null
  private parent: HTMLElement | null = null
  private resizeObserver: ResizeObserver | null = null
  private dpr = 1
  private cssWidth = 0
  private cssHeight = 0
  private rafId: number | null = null
  private renderDirty = false
  private disposed = false

  readonly pointer = new PointerController(this)
  readonly pan = new PanController(this)
  readonly selectionController = new SelectionController(this)
  readonly drawTrack = new DrawTrackController(this)
  readonly drag = new DragController(this)
  readonly switchController = new SwitchController(this)
  readonly nodeController = new NodeController(this)
  readonly segmentController = new SegmentController(this)
  readonly eraser = new EraserController(this)

  // —— 瞬态渲染数据（不进入 Vue reactive）——
  snapPoint: Point | null = null
  /** 当前命中的虚拟对齐参考线。 */
  alignmentGuide: AlignmentGuide | null = null
  drawPreview: Point[] = []
  /** 橡皮擦当前笔画（世界坐标）。 */
  eraserStroke: Point[] = []
  /** 橡皮擦笔画当前命中的元素 id（站台 / 文字等直接删除对象）。 */
  eraserHitIds: string[] = []
  /** 橡皮擦笔画当前命中的轨道 / 线段区间（红色高亮 = 松手后删除的部分）。 */
  eraserSpans: { elementId: string; from: number; to: number }[] = []
  hoverControl: { elementId: string; index: number } | null = null
  /** 道岔工具草稿：主线锚点（岔线草稿复用 drawTrack）。 */
  switchDraft: { trackId: string; anchor: Point } | null = null
  /** 框选矩形（世界坐标）。 */
  marqueeRect: { x0: number; y0: number; x1: number; y1: number } | null = null

  // —— UI 回调 ——
  onChange: (() => void) | null = null
  onViewChange: (() => void) | null = null
  onSelectionChange: ((ids: string[]) => void) | null = null
  onCursorChange: ((cursor: string) => void) | null = null
  onPointerWorld: ((p: Point) => void) | null = null
  onSaveRequest: (() => void) | null = null
  onOpenRequest: (() => void) | null = null
  requestLabelPlacement: RequestLabelPlacement | null = null
  onContextMenuRequest: ((menu: CanvasContextMenu) => void) | null = null

  // 内部键盘状态
  private spaceDown = false
  private altDown = false
  private mouseScreen: Point = { x: 0, y: 0 }

  constructor(doc: RailDocument) {
    this.document = migrateDocument(doc)
  }

  // ─────────── 生命周期 ───────────
  attach(canvas: HTMLCanvasElement, parent: HTMLElement): void {
    this.canvas = canvas
    this.parent = parent
    this.pointer.bind(canvas)
    this.disposed = false
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(parent)
    this.resize()
    // 初次挂载让文档内容居中显示。
    this.fitToContent()
    // 附加键盘监听到 window（Editor 自身判断输入焦点）
    window.addEventListener('keydown', this.handleKeyDown, { passive: false })
    window.addEventListener('keyup', this.handleKeyUp)
    this.invalidate()
  }

  dispose(): void {
    if (this.disposed) return
    this.cancelInteractions()
    this.disposed = true
    this.pointer.unbind()
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    window.removeEventListener('keydown', this.handleKeyDown)
    window.removeEventListener('keyup', this.handleKeyUp)
    if (this.rafId != null) cancelAnimationFrame(this.rafId)
    this.rafId = null
    this.renderDirty = false
    this.canvas = null
    this.parent = null
  }

  setDocument(doc: RailDocument, resetCamera = true): void {
    const next = migrateDocument(doc)
    this.cancelInteractions()
    this.document = next
    this.state.setSelection([])
    this.state.selectedPoints = []
    this.state.activeLayerId = doc.layers[0]?.id ?? null
    this.commands.clear()
    this.drawTrack.cancel()
    this.drag.cancel()
    this.switchDraft = null
    this.eraser.cancel()
    this.snapPoint = null
    this.alignmentGuide = null
    this.drawPreview = []
    this.hoverControl = null
    if (resetCamera) this.fitToContent()
    this.emitSelection()
    this.notify()
    this.invalidate()
  }

  /**
   * 让当前所有可见内容完整、居中地显示在画布中。
   * 缩放依据图元实际包围盒计算，而不是仅使用 Document.canvas 的宽高。
   */
  fitToContent(): void {
    if (!this.canvas) return
    const bounds = this.computeContentBounds()
    const contentW = Math.max(1, bounds.maxX - bounds.minX)
    const contentH = Math.max(1, bounds.maxY - bounds.minY)
    const usableW = this.cssWidth || 800
    const usableH = this.cssHeight || 600
    const zoom = clamp(Math.min(usableW / contentW, usableH / contentH), MIN_ZOOM, MAX_ZOOM)
    this.camera.zoom = zoom
    this.camera.offsetX = (usableW - contentW * zoom) / 2 - bounds.minX * zoom
    this.camera.offsetY = (usableH - contentH * zoom) / 2 - bounds.minY * zoom
  }

  /**
   * 计算可见图元的世界包围盒。轨道考虑线宽与双线间距，站台考虑
   * 宽度与站名文字，文字考虑旋转后的四角。无可见内容时回退到画布范围。
   */
  computeContentBounds(): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY

    const extend = (x: number, y: number, radius = 0): void => {
      minX = Math.min(minX, x - radius)
      minY = Math.min(minY, y - radius)
      maxX = Math.max(maxX, x + radius)
      maxY = Math.max(maxY, y + radius)
    }

    for (const el of this.getVisibleElements()) {
      if (isTrack(el)) {
        const half = el.trackStyle === 'double' ? Math.max(el.strokeWidth / 2, el.spacing / 2) : el.strokeWidth / 2
        for (const pt of el.points) extend(pt.x, pt.y, half + 4)
      } else if (isLine(el)) {
        for (const pt of el.points) extend(pt.x, pt.y, el.strokeWidth / 2 + 6)
      } else if (isPlatform(el)) {
        const halfW = el.width / 2
        const labelSize = this.estimateTextWidth(el.label ?? '', this.platformFontSize(el.width))
        const dx = el.end.x - el.start.x
        const dy = el.end.y - el.start.y
        const len = Math.hypot(dx, dy) || 1
        const ux = dx / len
        const uy = dy / len
        const halfLabel = labelSize / 2 + 8
        extend(el.start.x - ux * halfLabel, el.start.y - uy * halfLabel, halfW + 6)
        extend(el.end.x + ux * halfLabel, el.end.y + uy * halfLabel, halfW + 6)
      } else if (isStation(el)) {
        extend(el.x, el.y, el.radius + el.borderWidth / 2 + 4)
      } else if (isDirectionMarker(el)) {
        const track = this.document.elements.find((e): e is TrackElement => isTrack(e) && e.id === el.trackId)
        if (track && track.points.length >= 2) {
          const p = el.endpoint === 'start' ? track.points[0] : track.points[track.points.length - 1]
          const w = this.estimateTextWidth(el.text, el.fontSize)
          extend(p.x, p.y, w / 2 + el.offset + el.textOffset + el.arrowSize + 12)
        }
      } else if (isLabel(el)) {
        // 与渲染层共用绘制范围：左对齐文字从锚点向右展开，不能再按「以锚点为中心」计算。
        const drawn = labelDrawnRange(el)
        const rad = (el.rotation * Math.PI) / 180
        const cos = Math.cos(rad)
        const sin = Math.sin(rad)
        for (const c of [
          { x: drawn.left, y: drawn.top },
          { x: drawn.right, y: drawn.top },
          { x: drawn.right, y: drawn.bottom },
          { x: drawn.left, y: drawn.bottom },
        ]) {
          const dx = c.x - el.x
          const dy = c.y - el.y
          extend(el.x + dx * cos - dy * sin, el.y + dx * sin + dy * cos, 6)
        }
      }
    }

    if (!Number.isFinite(minX)) {
      const { width, height } = this.document.canvas
      return { minX: 0, minY: 0, maxX: Math.max(1, width), maxY: Math.max(1, height) }
    }

    const pad = 48
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }
  }

  platformFontSize(width: number): number {
    return Math.max(9, Math.min(40, width * 0.8))
  }

  estimateTextWidth(text: string, fontSize: number): number {
    let w = 0
    for (const ch of text) {
      const code = ch.codePointAt(0) ?? 0
      // CJK、全角字符按 fontSize 宽估算，其他字符约 0.55 倍。
      w += code >= 0x2e80 && code <= 0x9fff ? fontSize : fontSize * 0.58
    }
    return Math.max(0, w)
  }

  // ─────────── 渲染调度 ───────────
  invalidate(): void {
    if (this.renderDirty || this.disposed || !this.canvas) return
    this.renderDirty = true
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null
      this.renderDirty = false
      this.renderImmediate()
    })
  }

  renderImmediate(): void {
    const canvas = this.canvas
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    this.renderer.render({
      ctx,
      dpr: this.dpr,
      cssWidth: this.cssWidth,
      cssHeight: this.cssHeight,
      context: { doc: this.document, camera: this.camera, state: this.state },
      snapPoint: this.snapPoint,
      alignmentGuide: this.alignmentGuide,
      drawPreview: this.drawPreview,
      hoverControl: this.hoverControl,
      marqueeRect: this.marqueeRect,
      eraserStroke: this.eraserStroke,
      eraserHitIds: this.eraserHitIds,
      eraserSpans: this.eraserSpans,
    }, this)
  }

  private resize(): void {
    const canvas = this.canvas
    const parent = this.parent
    if (!canvas || !parent) return
    this.dpr = window.devicePixelRatio || 1
    const rect = parent.getBoundingClientRect()
    this.cssWidth = Math.max(1, Math.floor(rect.width))
    this.cssHeight = Math.max(1, Math.floor(rect.height))
    canvas.style.width = `${this.cssWidth}px`
    canvas.style.height = `${this.cssHeight}px`
    canvas.width = Math.max(1, Math.floor(this.cssWidth * this.dpr))
    canvas.height = Math.max(1, Math.floor(this.cssHeight * this.dpr))
    this.invalidate()
  }

  // ─────────── 坐标工具 ───────────
  worldToScreen(p: Point): Point {
    return this.camera.worldToScreen(p)
  }

  screenToWorld(p: Point): Point {
    return this.camera.screenToWorld(p)
  }

  setCursor(cursor: string): void {
    if (this.canvas) this.canvas.style.cursor = cursor
    this.onCursorChange?.(cursor)
  }

  // ─────────── 文档查询 / 变更 ───────────
  getElement(id: string): DiagramElement | undefined {
    return this.document.elements.find((e) => e.id === id)
  }

  getAllTrackPoints(): Point[] {
    const pts: Point[] = []
    for (const el of this.document.elements) {
      if ((isTrack(el) || isLine(el)) && this.isSelectable(el)) pts.push(...el.points)
    }
    return pts
  }

  isLayerVisible(el: DiagramElement): boolean {
    const layer = this.document.layers.find((l) => l.id === el.layerId)
    return layer ? layer.visible : true
  }

  isLayerLocked(el: DiagramElement): boolean {
    const layer = this.document.layers.find((l) => l.id === el.layerId)
    return layer ? layer.locked : false
  }

  isSelectable(el: DiagramElement): boolean {
    return el.visible && this.isLayerVisible(el) && !el.locked && !this.isLayerLocked(el)
  }

  isNodeEditable(node: RailwayNode): boolean {
    const tracks = getConnectedTracks(this.document, node.id)
    return tracks.length > 0 && tracks.every((track) => this.isSelectable(track))
  }

  findEditableNodeNear(p: Point, radius: number, excludeId?: string): RailwayNode | undefined {
    let best: RailwayNode | undefined
    let bestDistance = radius
    for (const node of this.document.nodes) {
      if (node.id === excludeId || !this.isNodeEditable(node)) continue
      const d = distance(node, p)
      if (d <= bestDistance) {
        best = node
        bestDistance = d
      }
    }
    return best
  }

  private canCreateOnActiveLayer(): boolean {
    const layer = this.document.layers.find((item) => item.id === this.getActiveLayerId())
    return !layer || (layer.visible && !layer.locked)
  }

  private validPoint(p: Point): boolean {
    return Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) <= 1_000_000 && Math.abs(p.y) <= 1_000_000
  }

  getVisibleElements(): DiagramElement[] {
    return this.document.elements.filter((el) => {
      if (!el.visible) return false
      const layer = this.document.layers.find((l) => l.id === el.layerId)
      return layer ? layer.visible : true
    })
  }

  addElement(el: DiagramElement): void {
    this.document.elements.push(el)
    this.invalidate()
  }

  removeElement(id: string): void {
    const idx = this.document.elements.findIndex((e) => e.id === id)
    if (idx >= 0) this.document.elements.splice(idx, 1)
    this.state.selectedPoints = this.state.selectedPoints.filter((s) => s.elementId !== id)
    this.state.setSelection(this.state.selectionIds.filter((s) => s !== id))
    this.invalidate()
  }

  addNode(node: RailwayNode): void {
    if (!this.document.nodes.some((n) => n.id === node.id)) this.document.nodes.push(node)
    this.invalidate()
  }

  removeNode(id: string): void {
    const idx = this.document.nodes.findIndex((n) => n.id === id)
    if (idx >= 0) this.document.nodes.splice(idx, 1)
    this.invalidate()
  }

  rebuildTopology(): void {
    rebuildNodeConnectivity(this.document)
    this.invalidate()
  }

  /** 移动拓扑节点（端点或 vertexLinks 节点），供点拖动命令同步节点坐标。 */
  moveBoundNode(nodeId: string, p: Point): void {
    moveNodeTo(this.document, nodeId, p)
  }

  setSelection(ids: string[]): void {
    this.state.selectedPoints = []
    this.state.setSelection(ids)
    this.emitSelection()
    this.invalidate()
  }

  /** 选中控制点：元素选择同步为这些点所属的元素。 */
  setSelectedPoints(points: SelectedPoint[]): void {
    this.state.selectedPoints = points.slice()
    this.state.setSelection([...new Set(points.map((p) => p.elementId))])
    this.emitSelection()
    this.invalidate()
  }

  togglePointSelection(elementId: string, index: number): void {
    const exists = this.state.selectedPoints.some((s) => s.elementId === elementId && s.index === index)
    const next = exists
      ? this.state.selectedPoints.filter((s) => !(s.elementId === elementId && s.index === index))
      : [...this.state.selectedPoints, { elementId, index }]
    this.setSelectedPoints(next)
  }

  clearSelection(): void {
    if (this.state.selectionIds.length === 0 && this.state.selectedPoints.length === 0) return
    this.setSelection([])
  }

  getSelectedElements(): DiagramElement[] {
    return this.document.elements.filter((e) => this.state.selectionIds.includes(e.id))
  }

  get selectionIds(): string[] {
    return this.state.selectionIds
  }

  // ─────────── 命中测试 ───────────
  hitTest(world: Point): HitResult | null {
    const visible = this.getVisibleElements().filter((e) => this.isSelectable(e))
    return hitTest(world, visible, { maxDistance: 8 / this.camera.zoom })
  }

  /**
   * 只在当前已选中的元素里做命中测试。
   *
   * 多选拖动时使用：密集图元互相重叠时，普通 hitTest 可能命中一个「没被选中但离得更近」
   * 的对象，导致拖动从整批变成单个、其余元素被取消选中。
   */
  hitTestSelected(world: Point): HitResult | null {
    const ids = this.state.selectionIds
    if (ids.length === 0) return null
    const selected = this.getVisibleElements().filter((e) => ids.includes(e.id) && this.isSelectable(e))
    if (selected.length === 0) return null
    return hitTest(world, selected, { maxDistance: 8 / this.camera.zoom })
  }

  /**
   * 命中方向标识或文字框（按文字框范围判断）。
   * 用于让“点击标识 / 文字位置”优先选中它们本身，即使与线路或控制点重叠。
   */
  hitTestMarkerLabel(world: Point): DiagramElement | null {
    for (const el of this.document.elements) {
      if (!this.isSelectable(el)) continue
      if (isLabel(el)) {
        // 复用渲染层的绘制范围，命中区域与屏幕上的文字严格一致。
        const drawn = labelDrawnRange(el)
        if (world.x >= drawn.left && world.x <= drawn.right && world.y >= drawn.top && world.y <= drawn.bottom) return el
      } else if (isDirectionMarker(el)) {
        const track = this.document.elements.find((e): e is TrackElement => isTrack(e) && e.id === el.trackId)
        if (!track || track.points.length < 2) continue
        const endpoint = el.endpoint === 'start' ? track.points[0] : track.points[track.points.length - 1]
        const other = el.endpoint === 'start' ? track.points[1] : track.points[track.points.length - 2]
        const len = Math.hypot(endpoint.x - other.x, endpoint.y - other.y) || 1
        const ux = (endpoint.x - other.x) / len
        const uy = (endpoint.y - other.y) / len
        const dist = el.offset + el.textOffset + 8
        const tx = endpoint.x + ux * dist
        const ty = endpoint.y + uy * dist
        const w = el.text.length * el.fontSize
        if (Math.abs(world.x - tx) <= w / 2 && Math.abs(world.y - ty) <= 9) return el
      }
    }
    return null
  }

  /** 命中任意可编辑站台的起点 / 终点控制柄，用于端点拖拽旋转。 */
  hitTestPlatformEndpoint(world: Point): { element: PlatformElement; endpoint: 'start' | 'end' } | null {    let best: { element: PlatformElement; endpoint: 'start' | 'end'; d: number } | null = null
    const threshold = 10 / this.camera.zoom
    for (const el of this.document.elements) {
      if (!isPlatform(el) || !this.isSelectable(el)) continue
      const candidates: { endpoint: 'start' | 'end'; p: Point }[] = [
        { endpoint: 'start', p: el.start },
        { endpoint: 'end', p: el.end },
      ]
      for (const c of candidates) {
        const d = distance(world, c.p)
        if (d <= threshold && (!best || d < best.d)) {
          best = { element: el, endpoint: c.endpoint, d }
        }
      }
    }
    return best ? { element: best.element, endpoint: best.endpoint } : null
  }

  /**
   * 命中任意可编辑轨道 / 线元素的控制点（顶点）。
   *
   * `maxDistance` 可由调用方收紧：线网图上顶点极其密集（站点处必有顶点），
   * 用默认的 9px 阈值会让顶点抢走站点 / 文字的点击。
   */
  hitTestControlPoint(world: Point, maxDistance?: number): { element: TrackElement | LineElement; index: number } | null {
    let best: { element: TrackElement | LineElement; index: number; d: number } | null = null
    const threshold = maxDistance ?? 9 / this.camera.zoom
    for (const el of this.document.elements) {
      if (!this.isSelectable(el)) continue
      if (!isTrack(el) && !isLine(el)) continue
      for (let i = 0; i < el.points.length; i++) {
        const p = el.points[i]
        const d = distance(world, p)
        if (d <= threshold && (!best || d < best.d)) {
          best = { element: el, index: i, d }
        }
      }
    }
    return best ? { element: best.element, index: best.index } : null
  }

  hitTestNode(world: Point): RailwayNode | null {
    let best: RailwayNode | null = null
    let bestD = 10 / this.camera.zoom
    for (const node of this.document.nodes) {
      if (!this.isNodeEditable(node)) continue
      const d = distance(world, node)
      if (d <= bestD) {
        bestD = d
        best = node
      }
    }
    return best
  }

  hitTestSegment(world: Point): { track: TrackElement; index: number } | null {
    let best: { track: TrackElement; index: number; d: number } | null = null
    const threshold = 8 / this.camera.zoom
    for (const el of this.document.elements) {
      if (!isTrack(el) || !this.isSelectable(el)) continue
      for (let i = 0; i < el.points.length - 1; i++) {
        const d = this.pointSegmentDistance(world, el.points[i], el.points[i + 1])
        if (d <= threshold && (!best || d < best.d)) best = { track: el, index: i, d }
      }
    }
    return best ? { track: best.track, index: best.index } : null
  }

  private pointSegmentDistance(p: Point, a: Point, b: Point): number {
    const abx = b.x - a.x
    const aby = b.y - a.y
    const lenSq = abx * abx + aby * aby
    if (lenSq === 0) return distance(p, a)
    let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq
    t = Math.max(0, Math.min(1, t))
    return distance(p, { x: a.x + abx * t, y: a.y + aby * t })
  }

  /** 检测两条 Track 的几何交点（不建立拓扑）。 */
  findTrackIntersections(aId: string, bId: string): Point[] {
    const a = this.document.elements.find((e): e is TrackElement => isTrack(e) && e.id === aId)
    const b = this.document.elements.find((e): e is TrackElement => isTrack(e) && e.id === bId)
    if (!a || !b) return []
    const pts: Point[] = []
    for (let i = 0; i < a.points.length - 1; i++) {
      for (let j = 0; j < b.points.length - 1; j++) {
        const r = segmentIntersection(a.points[i], a.points[i + 1], b.points[j], b.points[j + 1])
        if (r.intersects && r.point) pts.push(r.point)
      }
    }
    return pts
  }

  /** 查找光标附近可右键的几何交叉。 */
  findIntersectionNear(world: Point): { point: Point; trackAId: string; trackBId: string } | null {
    const threshold = 12 / this.camera.zoom
    const tracks = this.document.elements.filter((e): e is TrackElement => isTrack(e) && this.isSelectable(e))
    let best: { point: Point; trackAId: string; trackBId: string; d: number } | null = null
    for (let i = 0; i < tracks.length; i++) {
      for (let j = i + 1; j < tracks.length; j++) {
        for (const pt of this.findTrackIntersections(tracks[i].id, tracks[j].id)) {
          const d = distance(world, pt)
          if (d <= threshold && (!best || d < best.d)) best = { point: pt, trackAId: tracks[i].id, trackBId: tracks[j].id, d }
        }
      }
    }
    return best ? { point: best.point, trackAId: best.trackAId, trackBId: best.trackBId } : null
  }

  /** Hover 优先级：Node → Control Point → Segment → Element → Intersection。 */
  updateHover(world: Point): void {
    this.state.clearHover()
    const node = this.hitTestNode(world)
    if (node) {
      this.state.hoverNodeId = node.id
      this.invalidate()
      return
    }
    const cp = this.hitTestControlPoint(world)
    if (cp) {
      this.state.hoverElementId = cp.element.id
      this.hoverControl = { elementId: cp.element.id, index: cp.index }
      this.setCursor('move')
      this.invalidate()
      return
    }
    const pe = this.hitTestPlatformEndpoint(world)
    if (pe) {
      this.state.hoverElementId = pe.element.id
      this.setCursor('move')
      this.invalidate()
      return
    }
    this.hoverControl = null
    const seg = this.hitTestSegment(world)
    if (seg) {
      this.state.hoverElementId = seg.track.id
      this.state.hoverSegment = { trackId: seg.track.id, index: seg.index }
      if (this.state.tool === 'switch' || this.state.tool === 'segment') {
        this.setCursor(this.state.tool === 'segment' ? 'move' : 'crosshair')
      } else {
        this.setCursor('default')
      }
      this.invalidate()
      return
    }
    const hit = this.hitTest(world)
    if (hit) {
      this.state.hoverElementId = hit.element.id
      this.setCursor('default')
      this.invalidate()
      return
    }
    const inter = this.findIntersectionNear(world)
    if (inter) {
      this.state.hoverIntersection = { point: inter.point, trackAId: inter.trackAId, trackBId: inter.trackBId }
      this.invalidate()
      return
    }
    if (this.state.tool === 'switch' || this.state.tool === 'track' || this.state.tool === 'platform') this.setCursor('crosshair')
    else if (this.state.tool === 'node' || this.state.tool === 'segment') this.setCursor('pointer')
    else this.setCursor('default')
    this.invalidate()
  }

  /** 框选：返回与矩形相交的可编辑图元。 */
  selectInRect(rect: { x0: number; y0: number; x1: number; y1: number }, additive: boolean): void {
    const minX = Math.min(rect.x0, rect.x1)
    const maxX = Math.max(rect.x0, rect.x1)
    const minY = Math.min(rect.y0, rect.y1)
    const maxY = Math.max(rect.y0, rect.y1)
    const pointIn = (p: Point): boolean => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY
    const segIn = (a: Point, b: Point): boolean => {
      if (pointIn(a) || pointIn(b)) return true
      const corners = [
        { x: minX, y: minY }, { x: maxX, y: minY },
        { x: maxX, y: maxY }, { x: minX, y: maxY },
      ]
      for (let i = 0; i < 4; i++) {
        const r = segmentIntersection(a, b, corners[i], corners[(i + 1) % 4])
        if (r.intersects) return true
      }
      return false
    }

    const ids: string[] = []
    for (const el of this.document.elements) {
      if (!this.isSelectable(el)) continue
      if (isTrack(el) || isLine(el)) {
        if (el.points.length === 0) continue
        if (el.points.some(pointIn)) ids.push(el.id)
        else if (el.points.some((_, i) => i < el.points.length - 1 && segIn(el.points[i], el.points[i + 1]))) ids.push(el.id)
      } else if (isPlatform(el)) {
        if (pointIn(el.start) || pointIn(el.end) || segIn(el.start, el.end)) ids.push(el.id)
      } else if (isStation(el)) {
        if (pointIn({ x: el.x, y: el.y })) ids.push(el.id)
      } else if (isLabel(el)) {
        if (pointIn({ x: el.x, y: el.y })) ids.push(el.id)
      } else if (isDirectionMarker(el)) {
        const track = this.document.elements.find((e): e is TrackElement => isTrack(e) && e.id === el.trackId)
        if (track && track.points.length >= 2) {
          const p = el.endpoint === 'start' ? track.points[0] : track.points[track.points.length - 1]
          const d = this.getTrackEndpointDirection(track, el.endpoint)
          const len = Math.hypot(d.x, d.y) || 1
          const x = p.x + (d.x / len) * (el.offset + el.textOffset)
          const y = p.y + (d.y / len) * (el.offset + el.textOffset)
          if (pointIn({ x, y })) ids.push(el.id)
        }
      }
    }
    if (additive) this.setSelection([...new Set([...this.state.selectionIds, ...ids])])
    else this.setSelection(ids)
  }

  // ─────────── 吸附 ───────────
  getSnapPoint(
    p: Point,
    useAngleSnap = false,
    lastPoint?: Point,
    useLineSnap = false,
  ): { point: Point; snapped: boolean } {
    const maxDistance = DEFAULT_SNAP_PIXELS / this.camera.zoom
    let result = p
    let snapped = false
    this.alignmentGuide = null

    // 1. 虚拟对齐优先：高于角度约束与网格吸附（吸附开关开启时自动识别）。
    //    对齐线满足后，若可能再满足角度约束，其次网格（角度 > 网格）。
    if (this.state.snapGrid) {
      const align = snapToAlignment(
        result,
        this.getAllTrackVertices(),
        this.getAllTrackSegments(),
        ALIGNMENT_SNAP_PIXELS / this.camera.zoom,
      )
      if (align) {
        result = align.point
        this.alignmentGuide = align.guide
        snapped = true
        // 1a. 角度约束：角度射线与对齐线的交点同时满足两者。
        let angleRay: { lastPoint: Point; anglePoint: Point } | null = null
        if (useAngleSnap && lastPoint) {
          const anglePoint = snapToRailAngle(lastPoint, p)
          const inter = intersectionWithGuide(align.guide, lastPoint, anglePoint)
          if (inter) {
            result = inter
            angleRay = { lastPoint, anglePoint }
          }
        }
        // 1b. 网格：对齐线上的自由坐标取整到网格（不破坏已满足的角度约束）。
        result = snapGuideToGrid(align.guide, result, this.document.canvas.gridSize, angleRay ?? undefined)
      }
    }

    // 2. 角度吸附（未被虚拟对齐占用时）。
    if (!snapped && useAngleSnap && lastPoint) {
      result = snapToRailAngle(lastPoint, p)
      snapped = true
    }

    // 3. 端点吸附：优先已有轨道控制点，其次吸附到已有线路中心线上。
    if (!snapped) {
      const pointSnap = snapToPoints(result, this.getAllTrackPoints(), maxDistance)
      let lineSnap: { point: Point; snapped: boolean } = { point: result, snapped: false }
      // 线路中心线吸附跟随顶部“吸附”开关（与网格吸附共用同一开关）。
      if (useLineSnap && this.state.snapGrid) {
        lineSnap = snapToTrackLines(result, this.getAllTrackLines(), maxDistance)
      }
      if (pointSnap.snapped || lineSnap.snapped) {
        const pointDist = pointSnap.snapped ? Math.hypot(result.x - pointSnap.point.x, result.y - pointSnap.point.y) : Number.POSITIVE_INFINITY
        const lineDist = lineSnap.snapped ? Math.hypot(result.x - lineSnap.point.x, result.y - lineSnap.point.y) : Number.POSITIVE_INFINITY
        result = pointDist <= lineDist ? pointSnap.point : lineSnap.point
        snapped = true
      }
    }

    // 4. 网格吸附：仅在未命中端点 / 线路 / 对齐线时生效。
    if (!snapped && this.state.snapGrid) {
      result = snapToGrid(result, this.document.canvas.gridSize)
      if (Math.hypot(result.x - p.x, result.y - p.y) > 1e-6) snapped = true
    }

    this.snapPoint = snapped ? { ...result } : null
    return { point: result, snapped }
  }

  /** 所有可编辑轨道折线，用于线路中心线吸附。 */
  getAllTrackLines(): Point[][] {
    const lines: Point[][] = []
    for (const el of this.document.elements) {
      if (isTrack(el) && this.isSelectable(el) && el.points.length >= 2) lines.push(el.points)
    }
    return lines
  }

  /** 所有可编辑轨道 / 线元素的顶点，用于虚拟对齐参考。 */
  getAllTrackVertices(): Point[] {
    const pts: Point[] = []
    for (const el of this.document.elements) {
      if (!this.isSelectable(el)) continue
      if (isTrack(el) || isLine(el)) pts.push(...el.points)
    }
    return pts
  }

  /** 所有可编辑轨道 / 线元素的线段，用于虚拟对齐延长线参考。 */
  getAllTrackSegments(): { a: Point; b: Point }[] {
    const segs: { a: Point; b: Point }[] = []
    for (const el of this.document.elements) {
      if (!this.isSelectable(el)) continue
      if (!isTrack(el) && !isLine(el)) continue
      for (let i = 0; i < el.points.length - 1; i++) segs.push({ a: el.points[i], b: el.points[i + 1] })
    }
    return segs
  }

  get isAngleSnapActive(): boolean {
    return !this.altDown
  }

  // ─────────── 轨道绘制公共入口 ───────────
  /** 按当前工具分发草稿提交：轨道 / 线元素 / 道岔岔线。 */
  commitDraft(points: Point[]): void {
    if (this.state.tool === 'switch' && this.switchDraft) {
      this.commitSwitchBranch(points)
    } else if (this.state.tool === 'line') {
      this.commitLine(points)
    } else {
      this.commitTrack(points)
    }
    this.switchDraft = null
    this.alignmentGuide = null
  }

  commitTrack(points: Point[]): void {
    if (points.length < 2 || !points.every((p) => this.validPoint(p)) || !this.canCreateOnActiveLayer()) return
    const activeLayer = this.getActiveLayerId()
    const track = createTrack({ points: points.map((p) => ({ ...p })), layerId: activeLayer, bridgeGap: this.state.bridgeGap })
    this.commitTrackWithPlans(track, (plan, vertexIndex, isStart, isEnd) => this.planTrackVertex(plan, vertexIndex, isStart, isEnd))
  }

  commitLine(points: Point[]): void {
    if (points.length < 2 || !points.every((p) => this.validPoint(p)) || !this.canCreateOnActiveLayer()) return
    const layerId = this.getActiveLayerId()
    const line = createLine({ points: points.map((p) => ({ ...p })), layerId })
    this.executeCommand(new AddElementCommand(this, line, '新建线'))
  }

  /**
   * 提交一条折线轨道，逐顶点规划拓扑连接：
   * - 端点落在既有节点 → 复用；
   * - 端点 / 中间顶点落在既有线路中间 → 插入顶点并建 switch 节点（不拆线）；
   * - 中间顶点落在既有节点上 → 追加 vertexLink；
   * - 其余新建独立端点节点。
   * 全部合成为一个 CompositeCommand，一次撤销。
   */
  private commitTrackWithPlans(
    track: TrackElement,
    planVertex: (p: Point, vertexIndex: number, isStart: boolean, isEnd: boolean) => TrackVertexPlan,
  ): void {
    const commands: Command[] = []
    const endpointNodes: RailwayNode[] = []
    const insertCommands: InsertVertexCommand[] = []
    const linkCommands: AddVertexLinkCommand[] = []
    const n = track.points.length

    for (let i = 0; i < n; i++) {
      const isStart = i === 0
      const isEnd = i === n - 1
      const plan = planVertex(track.points[i], i, isStart, isEnd)
      if (plan.kind === 'node') {
        if (isStart) {
          track.startNodeId = plan.nodeId
          track.points[0] = { x: plan.point.x, y: plan.point.y }
        } else if (isEnd) {
          track.endNodeId = plan.nodeId
          track.points[n - 1] = { x: plan.point.x, y: plan.point.y }
        } else {
          // 中间顶点落在既有节点上：节点不拆线，追加 vertexLink。
          linkCommands.push(new AddVertexLinkCommand(this, plan.nodeId, track.id, i))
        }
      } else if (plan.kind === 'insert') {
        const nodeId = uuidv4()
        const extraLinks = isStart || isEnd ? [] : [{ trackId: track.id, vertexIndex: i }]
        insertCommands.push(new InsertVertexCommand(this, plan.trackId, plan.point, 'switch', nodeId, extraLinks))
        if (isStart) {
          track.startNodeId = nodeId
          track.points[0] = { ...plan.point }
        } else if (isEnd) {
          track.endNodeId = nodeId
          track.points[n - 1] = { ...plan.point }
        }
      } else {
        const node = createRailwayNode(plan.point, 'endpoint', [track.id])
        endpointNodes.push(node)
        if (isStart) {
          track.startNodeId = node.id
          track.points[0] = { ...plan.point }
        } else if (isEnd) {
          track.endNodeId = node.id
          track.points[n - 1] = { ...plan.point }
        }
      }
    }

    commands.push(new AddTrackCommand(this, track, endpointNodes))
    commands.push(...insertCommands, ...linkCommands)
    this.executeCommand(commands.length === 1 ? commands[0] : new CompositeCommand('新建轨道', commands))
  }

  /**
   * 道岔工具提交：岔线像画轨道一样连续绘制。
   * 主线不拆：锚点处插入顶点并建立 switch 节点，岔线以该节点为起点。
   */
  commitSwitchBranch(points: Point[]): void {
    const draft = this.switchDraft
    if (!draft) return
    if (points.length < 2 || !points.every((p) => this.validPoint(p)) || !this.canCreateOnActiveLayer()) return
    const main = this.document.elements.find((e): e is TrackElement => isTrack(e) && e.id === draft.trackId)
    if (!main || !this.isSelectable(main)) return
    const commands: Command[] = []
    const anchor = { ...points[0] }

    // 1. 岔线起点：锚点已有节点则复用，否则主线插入顶点建 switch 节点（不拆线）。
    const radius = DEFAULT_SNAP_PIXELS / this.camera.zoom
    const nearNode = this.findEditableNodeNear(anchor, radius)
    let startNodeId: string
    if (nearNode) {
      startNodeId = nearNode.id
    } else {
      startNodeId = uuidv4()
      commands.push(new InsertVertexCommand(this, main.id, anchor, 'switch', startNodeId))
    }

    // 2. 岔线：从锚点开始的连续折线，端点 / 中间顶点同样按道岔规则规划。
    const branch = createTrack({
      points: points.map((p) => ({ ...p })),
      layerId: this.getActiveLayerId() || main.layerId,
      color: main.color,
      strokeWidth: main.strokeWidth,
      trackStyle: 'single',
      bridgeGap: main.bridgeGap,
      startNodeId,
    })
    if (nearNode) branch.points[0] = { x: nearNode.x, y: nearNode.y }
    this.collectVertexPlans(branch, commands)
    this.executeCommand(new CompositeCommand('创建道岔', commands))
  }

  /** 轨道折线的统一顶点规划（供 commitTrackWithPlans 使用）。 */
  private planTrackVertex(p: Point, _vertexIndex: number, _isStart: boolean, _isEnd: boolean): TrackVertexPlan {
    return this.planVertex(p)
  }

  /** 生成顶点连接规划并收集对应的插入 / 连接命令（岔线共用）。 */
  private collectVertexPlans(track: TrackElement, commands: Command[]): void {
    const endpointNodes: RailwayNode[] = []
    const insertCommands: InsertVertexCommand[] = []
    const linkCommands: AddVertexLinkCommand[] = []
    const n = track.points.length
    const startPlanned = track.startNodeId != null

    for (let i = 0; i < n; i++) {
      const isStart = i === 0
      const isEnd = i === n - 1
      // 岔线起点已强制绑定 switch 节点，跳过规划。
      if (isStart && startPlanned) continue
      const plan = this.planVertex(track.points[i])
      if (plan.kind === 'node') {
        if (isStart) {
          track.startNodeId = plan.nodeId
          track.points[0] = { x: plan.point.x, y: plan.point.y }
        } else if (isEnd) {
          track.endNodeId = plan.nodeId
          track.points[n - 1] = { x: plan.point.x, y: plan.point.y }
        } else {
          linkCommands.push(new AddVertexLinkCommand(this, plan.nodeId, track.id, i))
        }
      } else if (plan.kind === 'insert') {
        const nodeId = uuidv4()
        const extraLinks = isStart || isEnd ? [] : [{ trackId: track.id, vertexIndex: i }]
        insertCommands.push(new InsertVertexCommand(this, plan.trackId, plan.point, 'switch', nodeId, extraLinks))
        if (isStart) {
          track.startNodeId = nodeId
          track.points[0] = { ...plan.point }
        } else if (isEnd) {
          track.endNodeId = nodeId
          track.points[n - 1] = { ...plan.point }
        }
      } else {
        const node = createRailwayNode(plan.point, 'endpoint', [track.id])
        endpointNodes.push(node)
        if (isStart) {
          track.startNodeId = node.id
          track.points[0] = { ...plan.point }
        } else if (isEnd) {
          track.endNodeId = node.id
          track.points[n - 1] = { ...plan.point }
        }
      }
    }
    commands.unshift(new AddTrackCommand(this, track, endpointNodes))
    commands.push(...insertCommands, ...linkCommands)
  }

  /**
   * 顶点连接规划：优先复用既有节点，其次落在既有线路中间时
   * 生成“插点建 switch 节点”的规划（不拆线），否则新建端点节点。
   */
  private planVertex(p: Point): TrackVertexPlan {
    const radius = DEFAULT_SNAP_PIXELS / this.camera.zoom
    const node = this.findEditableNodeNear(p, radius)
    if (node) return { kind: 'node', nodeId: node.id, point: { x: node.x, y: node.y } }
    let best: { trackId: string; point: Point; d: number } | null = null
    for (const el of this.document.elements) {
      if (!isTrack(el) || !this.isSelectable(el)) continue
      for (let i = 0; i < el.points.length - 1; i++) {
        const d = this.pointSegmentDistance(p, el.points[i], el.points[i + 1])
        if (d <= radius && (!best || d < best.d)) best = { trackId: el.id, point: this.projectPointToSegment(p, el.points[i], el.points[i + 1]), d }
      }
    }
    if (best) return { kind: 'insert', trackId: best.trackId, point: best.point }
    return { kind: 'new', point: p }
  }

  private projectPointToSegment(p: Point, a: Point, b: Point): Point {
    const abx = b.x - a.x
    const aby = b.y - a.y
    const lenSq = abx * abx + aby * aby
    if (lenSq === 0) return { ...a }
    let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq
    t = Math.max(0, Math.min(1, t))
    return { x: a.x + abx * t, y: a.y + aby * t }
  }

  getActiveLayerId(): string {
    const active = this.document.layers.find((layer) => layer.id === this.state.activeLayerId)
    return active?.id ?? this.document.layers[0]?.id ?? ''
  }

  removeLayer(id: string): void {
    const index = this.document.layers.findIndex((layer) => layer.id === id)
    if (index < 0) return
    this.cancelInteractions()
    const layer = { ...this.document.layers[index] }
    const activeId = this.state.activeLayerId
    const fallback = this.document.layers.find((item) => item.id !== id)?.id ?? ''
    const elementIds = this.document.elements.filter((el) => el.layerId === id).map((el) => el.id)
    this.executeCommand({
      label: '删除图层',
      execute: () => {
        this.document.layers = this.document.layers.filter((item) => item.id !== id)
        for (const elementId of elementIds) {
          const el = this.getElement(elementId)
          if (el) el.layerId = fallback
        }
        if (this.state.activeLayerId === id) this.state.activeLayerId = fallback || null
        this.setSelection([])
      },
      undo: () => {
        this.document.layers.splice(index, 0, { ...layer })
        for (const elementId of elementIds) {
          const el = this.getElement(elementId)
          if (el) el.layerId = id
        }
        this.state.activeLayerId = activeId
      },
    })
  }

  /** 车站落点判定为「在某条线路上」的容差（世界单位）。 */
  static readonly STATION_LINK_TOLERANCE = 12

  /** 选中一个车站时，同时选中的线路（用于属性面板展示关联）。 */
  getSelectedStationTracks(): TrackElement[] {
    const ids = this.state.selectionIds
    const station = ids.length === 1 ? this.getElement(ids[0]!) : null
    if (station && isStation(station)) return this.getStationTracks(station.id)
    // 多选时，取其中第一个车站的关联线路。
    for (const id of ids) {
      const el = this.getElement(id)
      if (el && isStation(el)) return this.getStationTracks(el.id)
    }
    return []
  }

  // ─────────── 站台 / 车站 / 文字入口 ───────────
  commitPlatform(start: Point, end: Point): void {
    if (!this.validPoint(start) || !this.validPoint(end) || distance(start, end) < 1 || !this.canCreateOnActiveLayer()) return
    const layerId = this.getActiveLayerId()
    const platform = createPlatform({ start, end, layerId })
    this.executeCommand(new AddElementCommand(this, platform, '新建站台'))
  }

  commitLabel(text: string, world: Point): void {
    if (!this.validPoint(world) || !this.canCreateOnActiveLayer()) return
    const layerId = this.getActiveLayerId()
    const label = createLabel({ text, x: world.x, y: world.y, layerId })
    this.executeCommand(new AddElementCommand(this, label, '新建文字'))
  }

  /**
   * 新建车站圆圈；kind 决定普通站 / 换乘站图标，缺省沿用工具上次选择。
   *
   * 落点附近的线路会自动写入 `trackIds`，形成「车站 — 线路」关联；
   * 一条线路内落点即视为该线车站，跨两条线路落点则升级为换乘站。
   */
  commitStation(world: Point, kind?: StationKind): void {
    if (!this.validPoint(world) || !this.canCreateOnActiveLayer()) return
    const layerId = this.getActiveLayerId()
    const requested = kind ?? this.state.stationKind
    const near = this.findTracksNear(world, Editor.STATION_LINK_TOLERANCE)
    // 落在两条及以上线路上自动成为换乘站。
    const resolved: StationKind = near.length >= 2 ? 'transfer' : requested
    // 记录本次类型，后续新建时沿用。
    this.state.stationKind = resolved
    // 同步到 store，否则工具栏上的类型按钮与实际沿用的类型会不一致。
    this.onChangeTool?.()
    const station = createStation({
      x: world.x,
      y: world.y,
      layerId,
      kind: resolved,
      trackIds: near,
      // 换乘站沿用第一条线路的配色作为描边，普通站同理。
      borderColor: this.getElement(near[0] ?? '') && isTrack(this.getElement(near[0]!)!)
        ? (this.getElement(near[0]!) as TrackElement).color
        : undefined,
    })
    this.executeCommand(new AddElementCommand(this, station, resolved === 'transfer' ? '新建换乘站' : '新建车站'))
  }

  /** 返回距离 p 在容差内的所有线路 id。 */
  findTracksNear(p: Point, tolerance: number): string[] {
    const ids: string[] = []
    for (const el of this.document.elements) {
      if (isTrack(el) && this.isSelectable(el) && isStationOnTrack(el, p, tolerance)) ids.push(el.id)
    }
    return ids
  }

  /**
   * 把选中车站关联到一条线路，或从线路取消关联。
   * 返回是否产生了变更。
   */
  toggleStationTrackLink(stationId: string, trackId: string): boolean {
    const station = this.getElement(stationId)
    if (!station || !isStation(station) || !this.isSelectable(station)) return false
    const track = this.getElement(trackId)
    if (!track || !isTrack(track)) return false
    const has = station.trackIds.includes(trackId)
    const next = has ? station.trackIds.filter((id) => id !== trackId) : [...station.trackIds, trackId]
    this.executeCommand(new UpdateElementCommand(
      this,
      stationId,
      { trackIds: next, kind: next.length >= 2 ? 'transfer' : station.kind },
      has ? '取消车站线路关联' : '关联车站线路',
    ))
    return true
  }

  /** 车站当前关联的线路元素。 */
  getStationTracks(stationId: string): TrackElement[] {
    const station = this.getElement(stationId)
    if (!station || !isStation(station)) return []
    return station.trackIds
      .map((id) => this.getElement(id))
      .filter((el): el is TrackElement => !!el && isTrack(el))
  }

  selectOnly(id: string): void {
    this.setSelection([id])
  }

  // ─────────── 道岔 / 平行轨道 / 拓扑操作 ───────────
  createParallelTracks(
    trackId: string,
    count: number,
    spacing: number,
    side: 'left' | 'right' | 'both',
  ): number {
    const track = this.document.elements.find((e): e is TrackElement => isTrack(e) && e.id === trackId)
    if (!track || !this.isSelectable(track) || !Number.isInteger(count) || count < 1 || count > 100) return 0
    if (!Number.isFinite(spacing) || spacing <= 0 || spacing > 100_000 || !['left', 'right', 'both'].includes(side)) return 0
    const offsets: number[] = []
    if (side === 'both') {
      for (let i = 1; i <= count; i++) {
        offsets.push((i * spacing) / 2)
        offsets.push((-i * spacing) / 2)
      }
    } else {
      const sign = side === 'left' ? -1 : 1
      for (let i = 1; i <= count; i++) offsets.push(sign * i * spacing)
    }
    const tracks: TrackElement[] = []
    const nodes: RailwayNode[] = []
    for (const off of offsets) {
      const pts = offsetPolyline(track.points, off)
      if (pts.length < 2 || !pts.every((p) => this.validPoint(p))) return 0
      const startNode = createRailwayNode(pts[0], 'endpoint')
      const endNode = createRailwayNode(pts[pts.length - 1], 'endpoint')
      nodes.push(startNode, endNode)
      const t = createTrack({
        points: pts,
        layerId: track.layerId,
        color: track.color,
        strokeWidth: track.strokeWidth,
        trackStyle: track.trackStyle,
        spacing: track.spacing,
        cornerRadius: track.cornerRadius,
        bridgeGap: track.bridgeGap,
        startNodeId: startNode.id,
        endNodeId: endNode.id,
        name: track.name ? `${track.name} 平行线` : undefined,
      })
      startNode.connectedTrackIds = [t.id]
      endNode.connectedTrackIds = [t.id]
      tracks.push(t)
    }
    if (tracks.length === 0) return 0
    this.executeCommand(new CreateParallelTracksCommand(this, tracks, nodes))
    return tracks.length
  }

  mergeNodesCommand(sourceId: string, targetId: string): void {
    this.executeCommand(new MergeNodesCommand(this, sourceId, targetId))
  }

  splitNodeCommand(nodeId: string, keepTrackIds: string[]): void {
    this.executeCommand(new SplitNodeCommand(this, nodeId, keepTrackIds))
  }

  moveNodeCommand(nodeId: string, p: Point): void {
    this.executeCommand(new MoveNodeCommand(this, nodeId, p))
  }

  moveSegmentCommand(trackId: string, index: number, delta: Point): void {
    this.executeCommand(new MoveSegmentCommand(this, trackId, index, delta))
  }

  reverseTrackCommand(trackId: string): void {
    this.executeCommand(new ReverseTrackCommand(this, trackId))
  }

  connectCrossingCommand(trackAId: string, trackBId: string, p: Point): void {
    this.executeCommand(new ConnectCrossingCommand(this, trackAId, trackBId, p))
  }

  /** 交叉点右键设为道岔：两条线不拆线，交点处共用 switch 节点。 */
  crossingToSwitchCommand(trackAId: string, trackBId: string, p: Point): void {
    this.executeCommand(new CrossingToSwitchCommand(this, trackAId, trackBId, p))
  }

  /** 右键把节点类型改为道岔（或其他类型）。 */
  setNodeTypeCommand(nodeId: string, nodeType: RailwayNode['nodeType']): void {
    this.executeCommand(new SetNodeTypeCommand(this, nodeId, nodeType))
  }

  disconnectJunctionCommand(nodeId: string): void {
    this.executeCommand(new DisconnectJunctionCommand(this, nodeId))
  }

  deleteNodeCommand(nodeId: string): void {
    this.executeCommand(new DeleteNodeCommand(this, nodeId))
  }

  setCrossingMode(trackAId: string, trackBId: string, p: Point, mode: Crossing['mode']): void {
    const tracks = [this.getElement(trackAId), this.getElement(trackBId)]
    if (trackAId === trackBId || !this.validPoint(p) || tracks.some((track) => !track || !isTrack(track) || !this.isSelectable(track))) return
    const before = structuredClone(this.document.crossings)
    const after = structuredClone(before)
    const existing = after.find((c) =>
      ((c.trackAId === trackAId && c.trackBId === trackBId) || (c.trackAId === trackBId && c.trackBId === trackAId)) && distance(c.point, p) < 0.01,
    )
    if (existing) {
      existing.mode = existing.trackAId === trackAId || mode === 'plain' ? mode : mode === 'bridge-a-over-b' ? 'bridge-b-over-a' : 'bridge-a-over-b'
    } else {
      after.push({ id: uuidv4(), trackAId, trackBId, point: { ...p }, mode })
    }
    this.executeCommand({
      label: '修改交叉样式',
      execute: () => { this.document.crossings = structuredClone(after) },
      undo: () => { this.document.crossings = structuredClone(before) },
    })
  }

  addDirectionMarker(trackId: string, endpoint: 'start' | 'end', text = '方向'): void {
    const track = this.document.elements.find((e): e is TrackElement => isTrack(e) && e.id === trackId)
    if (!track) return
    const marker = createDirectionMarker({ trackId, endpoint, text, layerId: track.layerId })
    this.executeCommand(new AddElementCommand(this, marker, '添加方向标识'))
    this.setSelection([marker.id])
  }

  deleteDirectionMarker(markerId: string): void {
    const marker = this.document.elements.find((e) => e.id === markerId)
    if (!marker) return
    this.executeCommand(new DeleteElementCommand(this, markerId))
  }

  // ─────────── 橡皮擦 ───────────
  /** 橡皮擦命中：轨道 / 线元素返回被擦除的段区间；站台 / 文字等返回直接删除的元素 id。 */
  findEraserHits(stroke: Point[]): { spans: { elementId: string; from: number; to: number }[]; deleteIds: string[] } {
    const spans: { elementId: string; from: number; to: number }[] = []
    const deleteIds: string[] = []
    const threshold = 6 / this.camera.zoom
    for (const el of this.document.elements) {
      if (!this.isSelectable(el)) continue
      if (isTrack(el) || isLine(el)) {
        if (el.points.length < 2) continue
        const span = computeSegmentSpan(el.points, stroke)
        if (span) spans.push({ elementId: el.id, ...span })
      } else if (isPlatform(el)) {
        if (stroke.some((sp) => this.pointSegmentDistance(sp, el.start, el.end) <= el.width / 2 + threshold)) deleteIds.push(el.id)
      } else if (isStation(el)) {
        if (stroke.some((sp) => distance(sp, el) <= el.radius + threshold)) deleteIds.push(el.id)
      } else if (isLabel(el)) {
        // 复用渲染层的文字范围，避免橡皮擦与实际绘制错位。
        const drawn = labelDrawnRange(el)
        if (stroke.some((sp) => sp.x >= drawn.left - threshold && sp.x <= drawn.right + threshold
          && sp.y >= drawn.top - threshold && sp.y <= drawn.bottom + threshold)) deleteIds.push(el.id)
      } else if (isDirectionMarker(el)) {
        const track = this.document.elements.find((e): e is TrackElement => isTrack(e) && e.id === el.trackId)
        if (!track || track.points.length < 2) continue
        const p = el.endpoint === 'start' ? track.points[0] : track.points[track.points.length - 1]
        if (stroke.some((sp) => distance(sp, p) <= 16 + threshold)) deleteIds.push(el.id)
      }
    }
    return { spans, deleteIds }
  }

  executeEraser(stroke: Point[]): void {
    if (stroke.length < 2) return
    this.executeCommand(new EraserCommand(this, stroke))
  }

  private pointPolylineDistance(p: Point, poly: Point[]): number {
    if (poly.length === 0) return Number.POSITIVE_INFINITY
    let min = Number.POSITIVE_INFINITY
    for (let i = 0; i < poly.length - 1; i++) {
      const d = this.pointSegmentDistance(p, poly[i], poly[i + 1])
      if (d < min) min = d
    }
    return min
  }

  // ─────────── 批量布置站台线路 ───────────
  /** 按行布局在视口中心生成站台与轨道。rows: { type: 'platform' | 'tracks'; count: number }[]。 */
  createBatchLayout(rows: { type: 'platform' | 'tracks'; count: number }[], opts: { length: number; rowSpacing: number; trackSpacing: number; platformWidth: number }): void {
    if (rows.length === 0 || rows.length > 100 || !this.canCreateOnActiveLayer()) return
    if (!Object.values(opts).every((value) => Number.isFinite(value) && value > 0 && value <= 10_000)) return
    if (rows.some((row) => !['platform', 'tracks'].includes(row.type) || !Number.isInteger(row.count) || row.count < 1 || row.count > 20)) return
    const cx = (this.cssWidth / 2 - this.camera.offsetX) / this.camera.zoom
    const cy = (this.cssHeight / 2 - this.camera.offsetY) / this.camera.zoom
    const layerId = this.getActiveLayerId()
    const halfLen = opts.length / 2
    const top = cy - ((rows.length - 1) * opts.rowSpacing) / 2
    const commands: Command[] = []
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]
      const y = top + r * opts.rowSpacing
      if (row.type === 'platform') {
        const platform = createPlatform({
          start: { x: cx - halfLen, y },
          end: { x: cx + halfLen, y },
          width: opts.platformWidth,
          layerId,
        })
        commands.push(new AddElementCommand(this, platform, '批量布置站台'))
      } else {
        for (let k = 0; k < row.count; k++) {
          const yk = y + (k - (row.count - 1) / 2) * opts.trackSpacing
          const startNode = createRailwayNode({ x: cx - halfLen, y: yk }, 'endpoint')
          const endNode = createRailwayNode({ x: cx + halfLen, y: yk }, 'endpoint')
          const track = createTrack({
            points: [{ x: cx - halfLen, y: yk }, { x: cx + halfLen, y: yk }],
            layerId,
            startNodeId: startNode.id,
            endNodeId: endNode.id,
          })
          startNode.connectedTrackIds = [track.id]
          endNode.connectedTrackIds = [track.id]
          commands.push(new AddTrackCommand(this, track, [startNode, endNode]))
        }
      }
    }
    if (commands.length > 0) this.executeCommand(new CompositeCommand('批量布置站台线路', commands))
  }

  updateElementProperties(ids: string[], patch: Partial<DiagramElement>, label = '修改属性'): void {
    const minimums: Record<string, number> = { strokeWidth: 0.5, spacing: 0, cornerRadius: 0, bridgeGap: 0, width: 2, fontSize: 6, arrowSize: 2, offset: -10000, textOffset: -10000, radius: 0, borderWidth: 0, innerRadius: 0, backgroundWidth: 0, backgroundHeight: 0, backgroundRadius: 0 }
    const maximums: Record<string, number> = { strokeWidth: 1000, spacing: 10000, cornerRadius: 10000, bridgeGap: 10000, width: 10000, fontSize: 200, arrowSize: 1000, offset: 10000, textOffset: 10000, radius: 200, borderWidth: 40, innerRadius: 200, backgroundWidth: 2000, backgroundHeight: 2000, backgroundRadius: 200 }
    for (const [key, value] of Object.entries(patch)) {
      // undefined 表示清除该可选字段，由 UpdateElementCommand 负责删键。
      if (value === undefined) continue
      if (typeof value !== 'number') continue
      if (!Number.isFinite(value) || value < (minimums[key] ?? -100000) || value > (maximums[key] ?? 100000)) return
    }
    const commands = [...new Set(ids)].flatMap((id) => {
      const el = this.getElement(id)
      return el && this.isSelectable(el) ? [new UpdateElementCommand(this, id, patch, label)] : []
    })
    if (commands.length > 0) this.executeCommand(commands.length === 1 ? commands[0] : new CompositeCommand(label, commands))
  }

  setPlatformAngle(ids: string[], degrees: number): void {
    if (!Number.isFinite(degrees)) return
    const commands: Command[] = []
    const target = ((degrees % 180) + 180) % 180 * Math.PI / 180
    for (const id of new Set(ids)) {
      const platform = this.getElement(id)
      if (!platform || !isPlatform(platform) || !this.isSelectable(platform)) continue
      const current = Math.atan2(platform.end.y - platform.start.y, platform.end.x - platform.start.x)
      const delta = target - ((current % Math.PI) + Math.PI) % Math.PI
      const cx = (platform.start.x + platform.end.x) / 2
      const cy = (platform.start.y + platform.end.y) / 2
      const hx = (platform.end.x - platform.start.x) / 2
      const hy = (platform.end.y - platform.start.y) / 2
      const dx = hx * Math.cos(delta) - hy * Math.sin(delta)
      const dy = hx * Math.sin(delta) + hy * Math.cos(delta)
      const start = { x: cx - dx, y: cy - dy }
      const end = { x: cx + dx, y: cy + dy }
      if (!this.validPoint(start) || !this.validPoint(end)) continue
      commands.push(new UpdateElementCommand(this, id, { start, end }, '修改站台角度'))
    }
    if (commands.length > 0) this.executeCommand(new CompositeCommand('修改站台角度', commands))
  }

  setTrackAngle(trackIds: string[], degrees: number): void {
    if (!Number.isFinite(degrees)) return
    const commands: Command[] = []
    for (const id of new Set(trackIds)) {
      const track = this.getElement(id)
      if (!track || !isTrack(track) || !this.isSelectable(track) || track.points.length < 2) continue
      const nodes = this.document.nodes.filter((node) => node.connectedTrackIds.includes(id))
      if (nodes.some((node) => !this.isNodeEditable(node))) continue
      const current = Math.atan2(track.points[1].y - track.points[0].y, track.points[1].x - track.points[0].x)
      const target = ((degrees % 180) + 180) % 180 * Math.PI / 180
      const delta = target - ((current % Math.PI) + Math.PI) % Math.PI
      const cx = (track.points[0].x + track.points[1].x) / 2
      const cy = (track.points[0].y + track.points[1].y) / 2
      const points = track.points.map((p) => ({
        x: cx + (p.x - cx) * Math.cos(delta) - (p.y - cy) * Math.sin(delta),
        y: cy + (p.x - cx) * Math.sin(delta) + (p.y - cy) * Math.cos(delta),
      }))
      if (!points.every((p) => this.validPoint(p))) continue
      for (let index = 0; index < points.length; index++) {
        commands.push(new MovePointCommand(this, id, index, points[index], track, captureBoundNodes(this.document, track, index)))
      }
    }
    if (commands.length > 0) this.executeCommand(new CompositeCommand('修改线路角度', commands))
  }

  // ─────────── 轨道标注文字 ───────────
  /** 设置轨道标注文字：相当于在轨道旁边创建 / 更新一个普通文字框。 */
  setTrackLabel(trackId: string, text: string): void {
    const track = this.document.elements.find((e): e is TrackElement => isTrack(e) && e.id === trackId)
    if (!track || !this.isSelectable(track)) return
    const commands: Command[] = []
    const trimmed = text.trim()
    const existingLabel = track.labelId ? this.getElement(track.labelId) : undefined
    if (!trimmed) {
      if (existingLabel && isLabel(existingLabel)) commands.push(new DeleteElementCommand(this, existingLabel.id))
      if (track.labelText || track.labelId) {
        commands.push(new UpdateElementCommand(this, track.id, { labelText: undefined, labelId: undefined }, '清除线路标注'))
      }
    } else if (existingLabel && isLabel(existingLabel)) {
      commands.push(new UpdateElementCommand(this, existingLabel.id, { text: trimmed }, '修改线路标注'))
      commands.push(new UpdateElementCommand(this, track.id, { labelText: trimmed }, '修改线路标注'))
    } else {
      const pos = this.computeTrackLabelPosition(track)
      const label = createLabel({ text: trimmed, x: pos.x, y: pos.y, layerId: track.layerId || this.getActiveLayerId() })
      commands.push(new AddElementCommand(this, label, '添加线路标注'))
      commands.push(new UpdateElementCommand(this, track.id, { labelText: trimmed, labelId: label.id }, '设置线路标注'))
    }
    if (commands.length > 0) this.executeCommand(commands.length === 1 ? commands[0] : new CompositeCommand('设置线路标注', commands))
  }

  /** 标注文字位置：折线弧长中点 + 法向偏移（线路一侧）。 */
  private computeTrackLabelPosition(track: TrackElement): Point {
    const pts = track.points
    if (pts.length < 2) return { x: pts[0]?.x ?? 0, y: (pts[0]?.y ?? 0) - 30 }
    const segLen: number[] = []
    let total = 0
    for (let i = 0; i < pts.length - 1; i++) {
      const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y)
      segLen.push(l)
      total += l
    }
    let target = total / 2
    for (let i = 0; i < segLen.length; i++) {
      if (target <= segLen[i] || i === segLen.length - 1) {
        const t = segLen[i] === 0 ? 0 : target / segLen[i]
        const x = pts[i].x + (pts[i + 1].x - pts[i].x) * t
        const y = pts[i].y + (pts[i + 1].y - pts[i].y) * t
        const dx = pts[i + 1].x - pts[i].x
        const dy = pts[i + 1].y - pts[i].y
        const len = Math.hypot(dx, dy) || 1
        const off = track.spacing / 2 + 26
        return { x: x + (dy / len) * off, y: y - (dx / len) * off }
      }
      target -= segLen[i]
    }
    return { x: pts[0].x, y: pts[0].y - 30 }
  }

  /** 端点方向向量：start 取 points[0]-points[1]，end 取 points[n-1]-points[n-2]。 */
  getTrackEndpointDirection(track: TrackElement, endpoint: 'start' | 'end'): Point {
    if (track.points.length < 2) return { x: 1, y: 0 }
    if (endpoint === 'start') {
      const a = track.points[0]
      const b = track.points[1]
      return { x: a.x - b.x, y: a.y - b.y }
    }
    const a = track.points[track.points.length - 1]
    const b = track.points[track.points.length - 2]
    return { x: a.x - b.x, y: a.y - b.y }
  }

  getTopologyIssues(): string[] {
    return validateTopology(this.document).map((i) => i.message)
  }

  // ─────────── 命令栈 ───────────
  executeCommand(command: Command): void {
    this.commands.execute(command)
    this.markDirty()
  }

  undo(): boolean {
    this.cancelInteractions()
    const ok = this.commands.undo()
    if (ok) this.markDirty()
    return ok
  }

  redo(): boolean {
    this.cancelInteractions()
    const ok = this.commands.redo()
    if (ok) this.markDirty()
    this.invalidate()
    return ok
  }

  markDirty(): void {
    this.notify()
    this.invalidate()
  }

  // ─────────── 通知 ───────────
  private emitSelection(): void {
    this.onSelectionChange?.(this.state.selectionIds.slice())
  }

  private notify(): void {
    this.onChange?.()
  }

  // ─────────── 键盘 ───────────
  private isTypingTarget(): boolean {
    const el = document.activeElement
    if (!el) return false
    const tag = el.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Space' && this.pointer.isDown) return // 正在拖动时忽略
    if (this.isTypingTarget()) return

    const mod = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()

    if (e.code === 'Space') {
      this.spaceDown = true
      this.setCursor(this.pointer.isDown ? 'grabbing' : 'grab')
      e.preventDefault()
      return
    }
    if (e.altKey) this.altDown = true
    if (e.shiftKey && mod && key === 'z') {
      e.preventDefault()
      this.redo()
      return
    }
    if (mod && key === 'z') {
      e.preventDefault()
      this.undo()
      return
    }
    if (mod && key === 'y') {
      e.preventDefault()
      this.redo()
      return
    }
    if (mod && key === 's') {
      e.preventDefault()
      this.onSaveRequest?.()
      return
    }
    if (mod && key === 'o') {
      e.preventDefault()
      this.onOpenRequest?.()
      return
    }

    switch (e.key) {
      case 'v':
      case 'V':
        this.setTool('select')
        break
      case 't':
      case 'T':
        this.setTool('track')
        break
      case 'w':
      case 'W':
        this.setTool('switch')
        break
      case 'e':
      case 'E':
        this.setTool('eraser')
        break
      case 'g':
      case 'G':
        this.setTool('line')
        break
      case 'p':
      case 'P':
        this.setTool('platform')
        break
      case 'm':
      case 'M':
        this.setTool('station')
        break
      case 'l':
      case 'L':
        this.setTool('label')
        break
      case 'n':
      case 'N':
        this.setTool('node')
        break
      case 's':
      case 'S':
        this.setTool('segment')
        break
      case 'Delete':
      case 'Backspace':
        e.preventDefault()
        this.deleteSelection()
        break
      case 'Escape':
        this.cancelCurrent()
        break
      case 'Enter':
        // 轨道 / 线 / 道岔岔线：回车直接结束并提交当前草稿。
        if (this.drawTrack.isDrawing) this.drawTrack.finish()
        break
      default:
        break
    }
  }

  private handleKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Space') {
      this.spaceDown = false
      this.pointer.refreshCursor()
      e.preventDefault()
    }
    if (!e.altKey) this.altDown = false
    if (e.key === 'Alt' || e.code.startsWith('Alt')) this.altDown = false
  }

  onChangeTool: (() => void) | null = null

  cancelInteractions(): void {
    this.pointer.cancel()
    this.snapPoint = null
    this.alignmentGuide = null
    this.hoverControl = null
    this.state.clearHover()
  }

  setTool(tool: EditorTool): void {
    this.cancelInteractions()
    this.state.setTool(tool)
    this.setCursor(
      tool === 'track' || tool === 'switch' || tool === 'platform' || tool === 'line' || tool === 'eraser'
        ? 'crosshair'
        : tool === 'label'
          ? 'text'
          : tool === 'node' || tool === 'segment'
            ? 'pointer'
            : 'default',
    )
    this.onChangeTool?.()
    this.invalidate()
  }

  cancelCurrent(): void {
    const active = this.pointer.isDown || this.drawTrack.isDrawing || this.drag.isDragging ||
      this.nodeController.isDragging || this.segmentController.isDragging || this.eraser.isErasing ||
      this.selectionController.draftPlatform.active || this.switchDraft != null
    this.cancelInteractions()
    if (!active) this.clearSelection()
  }

  deleteSelection(): void {
    // 优先删除单独选中的控制点。
    if (this.state.selectedPoints.length > 0) {
      const cmds: Command[] = []
      const points = [...new Map(this.state.selectedPoints.map((sp) => [JSON.stringify([sp.elementId, sp.index]), sp])).values()]
        .sort((a, b) => a.elementId.localeCompare(b.elementId) || b.index - a.index)
      for (const sp of points) {
        const el = this.getElement(sp.elementId)
        if (!el || !this.isSelectable(el) || (!isTrack(el) && !isLine(el))) continue
        if (!Number.isInteger(sp.index) || sp.index < 0 || sp.index >= el.points.length) continue
        cmds.push(new DeletePointCommand(this, sp.elementId, sp.index))
      }
      this.state.selectedPoints = []
      this.state.setSelection([])
      if (cmds.length > 0) this.executeCommand(cmds.length === 1 ? cmds[0] : new CompositeCommand('删除点', cmds))
      this.emitSelection()
      this.invalidate()
      return
    }
    if (this.state.selectionIds.length === 0) {
      this.cancelCurrent()
      return
    }
    const commands: Command[] = []
    for (const id of new Set(this.state.selectionIds)) {
      const el = this.getElement(id)
      if (!el || !this.isSelectable(el)) continue
      commands.push(new DeleteElementCommand(this, id))
    }
    if (commands.length > 0) this.executeCommand(new CompositeCommand('删除所选对象', commands))
    this.clearSelection()
  }

  // ─────────── 指针集成（供控制器调用）──
  get mouseWorld(): Point {
    return this.screenToWorld(this.mouseScreen)
  }

  setMouseScreen(screen: Point): void {
    this.mouseScreen = screen
    this.onPointerWorld?.(this.mouseWorld)
  }

  get spacePan(): boolean {
    return this.spaceDown
  }

  /** 中键 / Space+左键拖动画布。 */
  panBy(dx: number, dy: number): void {
    this.camera.panBy(dx, dy)
    this.onViewChange?.()
    this.invalidate()
  }

  zoomAt(screen: Point, factor: number): void {
    this.camera.zoomAt(screen, factor)
    this.onViewChange?.()
    this.invalidate()
  }

  // ─────────── 文件操作（由 UI 触发）──
  toJSON(): string {
    return JSON.stringify(this.document, null, 2)
  }

  /** 该 editor 实例的完整选择，用于测试与序列化。 */
  get selectionSnapshot(): { ids: string[]; elements: DiagramElement[] } {
    return { ids: this.state.selectionIds.slice(), elements: this.getSelectedElements() }
  }
}

