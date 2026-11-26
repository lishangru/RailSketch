import type { DiagramElement, LineElement, PlatformElement, Point, RailwayNode, TrackElement } from '../../types'
import type { SelectedPoint } from '../core/EditorState'
import type { Editor } from '../core/Editor'
import type { Command } from '../commands/Command'
import { MovePointCommand, captureBoundNodes } from '../commands/MovePointCommand'
import { UpdateElementCommand } from '../commands/UpdateElementCommand'
import { CompositeCommand } from '../commands/CompositeCommand'
import { MoveNodeCommand, DetachEndpointCommand } from '../commands/TopologyCommands'
import { getNode, moveNodeTo, rebuildNodeConnectivity } from '../topology/Topology'
import { isLine, isTrack } from '../model/Document'

type PointedElement = TrackElement | LineElement
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

interface PointDrag {
  elementId: string
  index: number
  before: PointedElement
  boundNodes: RailwayNode[]
}

interface NodeDrag {
  beforeNode: RailwayNode
  beforeTracks: TrackElement[]
}

type DragMode =
  | { kind: 'none' }
  | { kind: 'points'; points: PointDrag[]; origin: Point | null }
  | { kind: 'platform-endpoint'; id: string; endpoint: 'start' | 'end'; before: PlatformElement; pivot: Point }
  | {
      kind: 'elements'
      before: DiagramElement[]
      origin: Point
      movedNodes: NodeDrag[]
      detachEndpoints: { trackId: string; endpoint: 'start' | 'end' }[]
      detached: boolean
      /** 拖动对象中唯一的车站：拖动时跟随线路中心线吸附。 */
      movingStation: boolean
      /** 该车站拖动前的坐标，作为吸附计算的基准点。 */
      stationAnchor: Point
    }

/** 拖动中预览几何；提交前恢复原状态，再以单条命令记录整个操作。 */
export class DragController {
  private mode: DragMode = { kind: 'none' }

  constructor(private editor: Editor) {}

  get isDragging(): boolean {
    return this.mode.kind !== 'none'
  }

  private capturePoint(elementId: string, index: number): PointDrag | null {
    const el = this.editor.getElement(elementId)
    if (!el || (!isTrack(el) && !isLine(el)) || !this.editor.isSelectable(el)) return null
    if (!Number.isInteger(index) || index < 0 || index >= el.points.length) return null
    const boundNodes = captureBoundNodes(this.editor.document, el, index)
    if (!boundNodes.every((node) => this.editor.isNodeEditable(node))) return null
    return { elementId, index, before: clone(el), boundNodes }
  }

  beginPointDrag(elementId: string, index: number): void {
    this.cancel()
    const point = this.capturePoint(elementId, index)
    if (!point) return
    this.mode = { kind: 'points', points: [point], origin: null }
    this.editor.setCursor('move')
  }

  /** 批量点拖动：过滤不可编辑点，同时拒绝间接移动锁定轨道的共享节点。 */
  beginPointsDrag(points: SelectedPoint[], world: Point): void {
    this.cancel()
    const list = points.map((point) => this.capturePoint(point.elementId, point.index))
      .filter((point): point is PointDrag => point !== null)
      .filter((point, index, all) => all.findIndex((other) => other.elementId === point.elementId && other.index === point.index) === index)
    if (!list.length) return
    this.mode = { kind: 'points', points: list, origin: { ...world } }
    this.editor.setCursor('move')
  }

  /** 拖动站台端点：以另一端为旋转轴，改变站台角度与长度。 */
  beginPlatformEndpointDrag(id: string, endpoint: 'start' | 'end'): void {
    this.cancel()
    const el = this.editor.getElement(id)
    if (!el || el.type !== 'platform' || !this.editor.isSelectable(el)) return
    this.editor.setSelection([id])
    this.mode = {
      kind: 'platform-endpoint', id, endpoint,
      pivot: { ...(endpoint === 'start' ? el.end : el.start) },
      before: clone(el),
    }
    this.editor.setCursor('move')
  }

  private trackNodes(track: TrackElement): RailwayNode[] {
    return this.editor.document.nodes.filter((node) => node.id === track.startNodeId || node.id === track.endNodeId
      || node.vertexLinks.some((link) => link.trackId === track.id))
  }

  /** 整体拖动与批量拖动共用拓扑规则，避免两条路径的共享节点行为不一致。 */
  beginElementDrag(id: string, world: Point): void {
    this.beginBatchDrag([id], world)
  }

  beginBatchDrag(ids: string[], world: Point): void {
    this.cancel()
    const movable = [...new Set(ids)].map((id) => this.editor.getElement(id))
      .filter((el): el is DiagramElement => !!el && this.editor.isSelectable(el)
        && (el.type === 'track' || el.type === 'platform' || el.type === 'station' || el.type === 'label' || el.type === 'line'))
      .filter((el) => !isTrack(el) || this.trackNodes(el).every((node) => this.editor.isNodeEditable(node)))
    if (!movable.length) return
    const movableIds = new Set(movable.map((el) => el.id))
    const touchedNodes = new Map(movable.filter(isTrack).flatMap((track) => this.trackNodes(track)).map((node) => [node.id, node]))
    const movedNodes: NodeDrag[] = []
    const movingIds = new Set<string>()
    for (const node of touchedNodes.values()) {
      // 内部顶点绑定必须随动；普通端点仅在全部直连轨道被选中时随动。
      if (node.connectedTrackIds.every((id) => movableIds.has(id)) || node.vertexLinks.some((link) => movableIds.has(link.trackId))) {
        movingIds.add(node.id)
        movedNodes.push({
          beforeNode: clone(node),
          beforeTracks: this.editor.document.elements
            .filter((el): el is TrackElement => isTrack(el) && node.connectedTrackIds.includes(el.id)).map(clone),
        })
      }
    }
    const detachEndpoints: { trackId: string; endpoint: 'start' | 'end' }[] = []
    for (const track of movable.filter(isTrack)) {
      for (const endpoint of ['start', 'end'] as const) {
        const nodeId = endpoint === 'start' ? track.startNodeId : track.endNodeId
        if (nodeId && !movingIds.has(nodeId)) detachEndpoints.push({ trackId: track.id, endpoint })
      }
    }
    // 车站单独拖动时吸附到线路中心线；与其他图元混选时按普通位移处理。
    const station = movable.length === 1 && movable[0]!.type === 'station' ? movable[0] : null
    this.mode = {
      kind: 'elements',
      before: movable.map(clone),
      origin: { ...world },
      movedNodes,
      detachEndpoints,
      detached: false,
      movingStation: station !== null,
      stationAnchor: station ? { x: station.x, y: station.y } : { x: 0, y: 0 },
    }
    this.editor.setCursor('move')
  }

  move(world: Point): void {
    const mode = this.mode
    if (mode.kind === 'none') return
    if (mode.kind === 'points') {
      const snapped = this.editor.getSnapPoint(world, false).point
      for (const point of mode.points) {
        const el = this.editor.getElement(point.elementId)
        if (!el || (!isTrack(el) && !isLine(el))) continue
        const to = mode.origin ? {
          x: point.before.points[point.index].x + snapped.x - mode.origin.x,
          y: point.before.points[point.index].y + snapped.y - mode.origin.y,
        } : { ...snapped }
        el.points[point.index] = to
        for (const node of point.boundNodes) this.editor.moveBoundNode(node.id, to)
      }
    } else if (mode.kind === 'platform-endpoint') {
      const el = this.editor.getElement(mode.id)
      if (!el || el.type !== 'platform') return
      const snapped = this.editor.getSnapPoint(world, this.editor.isAngleSnapActive, mode.pivot).point
      if (Math.hypot(snapped.x - mode.pivot.x, snapped.y - mode.pivot.y) < 1e-4) return
      el[mode.endpoint] = { ...snapped }
    } else {
      // 车站跟随线路中心线吸附，其余图元按原始位移量同步预览。
      const rawDx = world.x - mode.origin.x
      const rawDy = world.y - mode.origin.y
      let dx = rawDx
      let dy = rawDy
      if (mode.movingStation) {
        const anchor = mode.stationAnchor
        const snapped = this.editor.getSnapPoint({ x: anchor.x + rawDx, y: anchor.y + rawDy }, false, undefined, true)
        dx = snapped.point.x - anchor.x
        dy = snapped.point.y - anchor.y
      }
      if (!mode.detached && (rawDx !== 0 || rawDy !== 0)) {
        // 预览阶段也必须断开共享端点，不能保留引用却只移动 points。
        for (const { trackId, endpoint } of mode.detachEndpoints) {
          const track = this.editor.getElement(trackId)
          if (track && isTrack(track)) {
            if (endpoint === 'start') delete track.startNodeId
            else delete track.endNodeId
          }
        }
        if (mode.detachEndpoints.length) rebuildNodeConnectivity(this.editor.document)
        mode.detached = true
      }
      for (const before of mode.before) {
        const el = this.editor.getElement(before.id)
        if (!el) continue
        if ((isTrack(before) && isTrack(el)) || (isLine(before) && isLine(el))) {
          el.points = before.points.map((point) => ({ x: point.x + dx, y: point.y + dy }))
        } else if (before.type === 'platform' && el.type === 'platform') {
          el.start = { x: before.start.x + dx, y: before.start.y + dy }
          el.end = { x: before.end.x + dx, y: before.end.y + dy }
        } else if (before.type === 'label' && el.type === 'label') {
          el.x = before.x + dx
          el.y = before.y + dy
        } else if (before.type === 'station' && el.type === 'station') {
          el.x = before.x + dx
          el.y = before.y + dy
        }
      }
      for (const { beforeNode } of mode.movedNodes) {
        moveNodeTo(this.editor.document, beforeNode.id, { x: beforeNode.x + dx, y: beforeNode.y + dy })
      }
    }
    this.editor.invalidate()
  }

  finish(): void {
    const mode = this.mode
    if (mode.kind === 'none') return
    const commands: Command[] = []
    if (mode.kind === 'points') {
      for (const point of mode.points) {
        const el = this.editor.getElement(point.elementId)
        if (!el || (!isTrack(el) && !isLine(el))) continue
        const to = el.points[point.index]
        const from = point.before.points[point.index]
        if (to && (to.x !== from.x || to.y !== from.y)) {
          commands.push(new MovePointCommand(this.editor, point.elementId, point.index, { ...to }, point.before, point.boundNodes))
        }
      }
    } else if (mode.kind === 'platform-endpoint') {
      const el = this.editor.getElement(mode.id)
      if (el) {
        const patch = this.buildPatch(mode.before, el)
        if (Object.keys(patch).length) commands.push(new UpdateElementCommand(this.editor, mode.id, patch, '旋转站台', mode.before))
      }
    } else {
      for (const before of mode.before) {
        const el = this.editor.getElement(before.id)
        if (!el) continue
        const patch = this.buildPatch(before, el)
        if (Object.keys(patch).length) commands.push(new UpdateElementCommand(this.editor, before.id, patch, '移动图元', before))
      }
      if (commands.length) {
        for (const { beforeNode, beforeTracks } of mode.movedNodes) {
          const node = getNode(this.editor.document, beforeNode.id)
          if (node) commands.push(new MoveNodeCommand(this.editor, node.id, { x: node.x, y: node.y }, beforeNode, beforeTracks))
        }
        commands.unshift(...mode.detachEndpoints.map(({ trackId, endpoint }) => new DetachEndpointCommand(this.editor, trackId, endpoint)))
      }
    }
    // 回滚预览后再执行，保证每个命令捕获的都是操作前状态。
    this.cancel()
    if (commands.length) this.editor.executeCommand(commands.length === 1 ? commands[0] : new CompositeCommand('移动图元', commands))
  }

  private buildPatch(before: DiagramElement, after: DiagramElement): Partial<DiagramElement> {
    let from: object = {}
    let to: Partial<DiagramElement> = {}
    if (before.type === 'platform' && after.type === 'platform') {
      from = { start: before.start, end: before.end }
      to = { start: { ...after.start }, end: { ...after.end } }
    } else if (before.type === 'label' && after.type === 'label') {
      from = { x: before.x, y: before.y }
      to = { x: after.x, y: after.y }
    } else if (before.type === 'station' && after.type === 'station') {
      from = { x: before.x, y: before.y }
      to = { x: after.x, y: after.y }
    } else if ((isTrack(before) && isTrack(after)) || (isLine(before) && isLine(after))) {
      from = { points: before.points }
      to = { points: after.points.map((point) => ({ ...point })) }
    }
    return JSON.stringify(from) === JSON.stringify(to) ? {} : to
  }

  cancel(): void {
    const mode = this.mode
    if (mode.kind === 'none') return
    if (mode.kind === 'points') {
      for (const point of mode.points) {
        for (const node of point.boundNodes) this.editor.moveBoundNode(node.id, { x: node.x, y: node.y })
      }
      for (const point of mode.points) {
        const el = this.editor.getElement(point.elementId)
        if (el) this.restoreElement(el, point.before)
      }
    } else if (mode.kind === 'platform-endpoint') {
      const el = this.editor.getElement(mode.id)
      if (el) this.restoreElement(el, mode.before)
    } else {
      for (const { beforeNode, beforeTracks } of mode.movedNodes) {
        moveNodeTo(this.editor.document, beforeNode.id, { x: beforeNode.x, y: beforeNode.y })
        for (const before of beforeTracks) {
          const el = this.editor.getElement(before.id)
          if (el) this.restoreElement(el, before)
        }
      }
      for (const before of mode.before) {
        const el = this.editor.getElement(before.id)
        if (el) this.restoreElement(el, before)
      }
      if (mode.detached && mode.detachEndpoints.length) rebuildNodeConnectivity(this.editor.document)
    }
    this.mode = { kind: 'none' }
    this.editor.snapPoint = null
    this.editor.alignmentGuide = null
    this.editor.pointer.refreshCursor()
    this.editor.invalidate()
  }

  private restoreElement(el: DiagramElement, before: DiagramElement): void {
    const record = el as unknown as Record<string, unknown>
    for (const key of Object.getOwnPropertyNames(record)) delete record[key]
    Object.assign(record, clone(before))
  }
}
