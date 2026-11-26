import type { RailDocument } from '../../types'
import type { Camera } from '../core/Camera'
import type { EditorState } from '../core/EditorState'
import { GridRenderer } from './GridRenderer'
import { TrackRenderer } from './TrackRenderer'
import { PlatformRenderer } from './PlatformRenderer'
import { StationRenderer } from './StationRenderer'
import { LabelRenderer } from './LabelRenderer'
import { LineRenderer } from './LineRenderer'
import { SelectionRenderer } from './SelectionRenderer'
import { NodeRenderer } from './NodeRenderer'
import { CrossingRenderer } from './CrossingRenderer'
import { DirectionMarkerRenderer } from './DirectionMarkerRenderer'
import type { AlignmentGuide } from '../geometry/Alignment'
import type { Editor } from '../core/Editor'

export interface RenderContext {
  doc: RailDocument
  camera: Camera
  state: EditorState
}

export interface RendererInput {
  ctx: CanvasRenderingContext2D
  dpr: number
  cssWidth: number
  cssHeight: number
  context: RenderContext
  /** 吸附提示点（世界坐标），绘制时突出显示。 */
  snapPoint: { x: number; y: number } | null
  /** 当前命中的虚拟对齐参考线。 */
  alignmentGuide: AlignmentGuide | null
  /** 当前绘制中的预览 polyline（世界坐标）。 */
  drawPreview: { x: number; y: number }[]
  /** 拖动中的悬停控制点提示。 */
  hoverControl: { elementId: string; index: number } | null
  /** 框选矩形（世界坐标）。 */
  marqueeRect: { x0: number; y0: number; x1: number; y1: number } | null
  /** 橡皮擦笔画（世界坐标）。 */
  eraserStroke: { x: number; y: number }[]
  /** 橡皮擦笔画当前命中的元素 id（站台 / 文字等直接删除对象）。 */
  eraserHitIds: string[]
  /** 橡皮擦笔画当前命中的轨道 / 线段区间（红色高亮 = 松手后删除的部分）。 */
  eraserSpans: { elementId: string; from: number; to: number }[]
}

export class Renderer {
  private grid = new GridRenderer()
  private track = new TrackRenderer()
  private platform = new PlatformRenderer()
  private station = new StationRenderer()
  private label = new LabelRenderer()
  private line = new LineRenderer()
  private selection = new SelectionRenderer()
  private nodes = new NodeRenderer()
  private crossings = new CrossingRenderer()
  private markers = new DirectionMarkerRenderer()

  render(input: RendererInput, editor?: Editor): void {
    const { ctx, dpr, cssWidth, cssHeight, context } = input
    const { camera } = context
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssWidth, cssHeight)

    // 画布背景（白色，但暗色 UI 下保持专业浅色）
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, cssWidth, cssHeight)

    if (context.state.showGrid) this.grid.render(ctx, camera, cssWidth, cssHeight, context.doc.canvas.gridSize)

    this.platform.render(ctx, camera, context.doc)
    // 跨线桥：普通状态先画非上层轨道，再画下层断口，最后原样画上层轨道；
    // 下层被选中或悬停时，下层最后完整绘制，显示原来完整的线条。
    const bridgeUpperIds = this.crossings.getBridgeUpperIds(context.doc)
    const activeLowerIds = this.crossings.getActiveLowerIds(context.doc, context.state)
    const lateIds = new Set<string>([...bridgeUpperIds, ...activeLowerIds])
    this.track.render(ctx, camera, context.doc, (t) => !lateIds.has(t.id))
    this.crossings.render(ctx, camera, context.doc, context.state)
    if (bridgeUpperIds.size > 0) this.track.render(ctx, camera, context.doc, (t) => bridgeUpperIds.has(t.id) && !activeLowerIds.has(t.id))
    if (activeLowerIds.size > 0) this.track.render(ctx, camera, context.doc, (t) => activeLowerIds.has(t.id))
    if (editor) this.markers.render(ctx, camera, context.doc, editor)
    // 站点圆圈必须压在线路之上，才能在彩色线路上保持白底可读。
    this.station.render(ctx, camera, context.doc)
    this.line.render(ctx, camera, context.doc)
    this.label.render(ctx, camera, context.doc)

    if (input.alignmentGuide) this.renderAlignmentGuide(ctx, camera, input.alignmentGuide, cssWidth, cssHeight, dpr)

    if (input.drawPreview.length > 0) this.track.renderPreview(ctx, camera, input.drawPreview, '#2563eb')

    // 选中元素重绘高亮与全部控制点
    this.selection.render(ctx, camera, context.doc, context.state.selectionIds, context.state.selectedPoints)
    if (context.state.hoverSegment) this.renderHoverSegment(ctx, camera, context)
    this.nodes.render(ctx, camera, context.doc, context.state)

    if (input.hoverControl && context.state.tool !== 'track') {
      const el = context.doc.elements.find((e) => e.id === input.hoverControl!.elementId)
      if (el && (el.type === 'track' || el.type === 'line')) {
        this.selection.renderHoverControl(ctx, camera, el, input.hoverControl.index)
      }
    }

    if (input.eraserStroke.length > 0) this.renderEraser(ctx, camera, input, dpr)

    if (input.marqueeRect) this.renderMarquee(ctx, camera, input.marqueeRect, dpr)

    if (input.snapPoint) this.selection.renderSnapPoint(ctx, camera, input.snapPoint)
  }

  private renderAlignmentGuide(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    g: AlignmentGuide,
    cssWidth: number,
    cssHeight: number,
    dpr: number,
  ): void {
    ctx.save()
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.strokeStyle = 'rgba(14, 165, 233, 0.85)'
    ctx.lineWidth = 1
    ctx.setLineDash([6, 4])
    ctx.beginPath()
    if (g.kind === 'v' && g.x != null) {
      const x = camera.worldToScreen({ x: g.x, y: 0 }).x
      ctx.moveTo(x, 0)
      ctx.lineTo(x, cssHeight)
    } else if (g.kind === 'h' && g.y != null) {
      const y = camera.worldToScreen({ x: 0, y: g.y }).y
      ctx.moveTo(0, y)
      ctx.lineTo(cssWidth, y)
    } else if (g.kind === 'line' && g.a && g.d) {
      const x0 = (0 - camera.offsetX) / camera.zoom
      const x1 = (cssWidth - camera.offsetX) / camera.zoom
      const y0 = (0 - camera.offsetY) / camera.zoom
      const y1 = (cssHeight - camera.offsetY) / camera.zoom
      const seg = this.clipInfiniteLine(g.a, g.d, x0, y0, x1, y1)
      if (seg.length === 2) {
        const a = camera.worldToScreen(seg[0])
        const b = camera.worldToScreen(seg[1])
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
      }
    }
    ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()
  }

  /** 无限直线与视口矩形的两个交点（按参数 t 取极值）。 */
  private clipInfiniteLine(a: { x: number; y: number }, d: { x: number; y: number }, x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] {
    const ts: number[] = []
    const add = (t: number): void => {
      const p = { x: a.x + d.x * t, y: a.y + d.y * t }
      if (p.x >= x0 - 1e-6 && p.x <= x1 + 1e-6 && p.y >= y0 - 1e-6 && p.y <= y1 + 1e-6) ts.push(t)
    }
    if (Math.abs(d.x) > 1e-9) {
      add((x0 - a.x) / d.x)
      add((x1 - a.x) / d.x)
    }
    if (Math.abs(d.y) > 1e-9) {
      add((y0 - a.y) / d.y)
      add((y1 - a.y) / d.y)
    }
    if (ts.length < 2) return []
    ts.sort((m, n) => m - n)
    return [
      { x: a.x + d.x * ts[0], y: a.y + d.y * ts[0] },
      { x: a.x + d.x * ts[ts.length - 1], y: a.y + d.y * ts[ts.length - 1] },
    ]
  }

  private renderEraser(ctx: CanvasRenderingContext2D, camera: Camera, input: RendererInput, dpr: number): void {
    const { doc } = input.context
    // 命中部分红色高亮：轨道 / 线只高亮被擦除的段区间，站台 / 文字整块高亮。
    ctx.save()
    ctx.transform(camera.zoom, 0, 0, camera.zoom, camera.offsetX, camera.offsetY)
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.55)'
    ctx.lineWidth = 3.5 / camera.zoom
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const el of doc.elements) {
      if (el.type === 'track' || el.type === 'line') {
        const span = input.eraserSpans.find((s) => s.elementId === el.id)
        if (!span || el.points.length < 2) continue
        const from = Math.max(0, Math.min(span.from, el.points.length - 2))
        const to = Math.max(from, Math.min(span.to, el.points.length - 2))
        ctx.beginPath()
        ctx.moveTo(el.points[from].x, el.points[from].y)
        for (let i = from + 1; i <= to + 1 && i < el.points.length; i++) ctx.lineTo(el.points[i].x, el.points[i].y)
        ctx.stroke()
      } else if (input.eraserHitIds.includes(el.id)) {
        if (el.type === 'platform') {
          ctx.strokeRect(el.start.x, el.start.y, el.end.x - el.start.x, el.end.y - el.start.y)
        } else if (el.type === 'label') {
          const w = el.text.length * el.fontSize
          const h = el.fontSize * 1.4
          ctx.strokeRect(el.x - w / 2, el.y - h / 2, w, h)
        }
      }
    }
    ctx.restore()

    // 笔画本身
    ctx.save()
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.9)'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.setLineDash([5, 3])
    ctx.beginPath()
    const first = camera.worldToScreen(input.eraserStroke[0])
    ctx.moveTo(first.x, first.y)
    for (let i = 1; i < input.eraserStroke.length; i++) {
      const p = camera.worldToScreen(input.eraserStroke[i])
      ctx.lineTo(p.x, p.y)
    }
    ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()
  }

  private renderMarquee(ctx: CanvasRenderingContext2D, camera: Camera, r: { x0: number; y0: number; x1: number; y1: number }, dpr: number): void {
    const a = camera.worldToScreen({ x: r.x0, y: r.y0 })
    const b = camera.worldToScreen({ x: r.x1, y: r.y1 })
    ctx.save()
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = 'rgba(37, 99, 235, 0.08)'
    ctx.strokeStyle = '#2563eb'
    ctx.lineWidth = 1
    ctx.setLineDash([5, 3])
    ctx.beginPath()
    ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y)
    ctx.fill()
    ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()
  }

  private renderHoverSegment(ctx: CanvasRenderingContext2D, camera: Camera, context: RenderContext): void {
    const seg = context.state.hoverSegment
    if (!seg) return
    const track = context.doc.elements.find((e) => e.type === 'track' && e.id === seg.trackId)
    if (!track || track.type !== 'track' || seg.index < 0 || seg.index >= track.points.length - 1) return
    ctx.save()
    ctx.transform(camera.zoom, 0, 0, camera.zoom, camera.offsetX, camera.offsetY)
    ctx.strokeStyle = 'rgba(37, 99, 235, 0.45)'
    ctx.lineWidth = (track.strokeWidth + 5) / camera.zoom
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(track.points[seg.index].x, track.points[seg.index].y)
    ctx.lineTo(track.points[seg.index + 1].x, track.points[seg.index + 1].y)
    ctx.stroke()
    ctx.restore()
  }
}
