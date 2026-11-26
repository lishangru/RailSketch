import type { Point, RailwayNode, TrackElement } from '../../types'
import type { Editor } from '../core/Editor'
import { MoveSegmentCommand } from '../commands/TopologyCommands'
import { captureBoundNodes } from '../commands/MovePointCommand'
import { moveNodeTo } from '../topology/Topology'

/** 段编辑模式：沿段法向平移选中的 Segment；Alt 自由二维平移。 */
export class SegmentController {
  private mode:
    | { kind: 'none' }
    | { kind: 'drag'; trackId: string; index: number; before: TrackElement; beforeNodes: RailwayNode[]; beforeTracks: TrackElement[]; start: Point; normal: Point } = { kind: 'none' }

  constructor(private editor: Editor) {}

  get isDragging(): boolean {
    return this.mode.kind === 'drag'
  }

  hover(world: Point): void {
    const seg = this.editor.hitTestSegment(world)
    this.editor.state.hoverSegment = seg && this.canDrag(seg.track, seg.index) ? { trackId: seg.track.id, index: seg.index } : null
    this.editor.invalidate()
  }

  private boundNodes(track: TrackElement, index: number): RailwayNode[] {
    return [...new Map([index, index + 1]
      .flatMap((i) => captureBoundNodes(this.editor.document, track, i))
      .map((node) => [node.id, node])).values()]
  }

  private canDrag(track: TrackElement, index: number): boolean {
    return this.editor.isSelectable(track) && Number.isInteger(index) && index >= 0 && index + 1 < track.points.length
      && this.boundNodes(track, index).every((node) => this.editor.isNodeEditable(node))
  }

  pointerDown(world: Point): void {
    this.cancel()
    const seg = this.editor.hitTestSegment(world)
    if (!seg || !this.canDrag(seg.track, seg.index)) {
      this.editor.clearSelection()
      return
    }
    const beforeNodes = this.boundNodes(seg.track, seg.index)
    const affectedIds = new Set([seg.track.id, ...beforeNodes.flatMap((node) => node.connectedTrackIds)])
    this.mode = {
      kind: 'drag',
      trackId: seg.track.id,
      index: seg.index,
      before: JSON.parse(JSON.stringify(seg.track)),
      beforeNodes,
      beforeTracks: this.editor.document.elements
        .filter((el): el is TrackElement => el.type === 'track' && affectedIds.has(el.id))
        .map((el) => JSON.parse(JSON.stringify(el))),
      start: { ...world },
      normal: this.segmentNormal(seg.track.points[seg.index], seg.track.points[seg.index + 1]),
    }
    this.editor.setCursor('move')
  }

  move(world: Point): void {
    if (this.mode.kind !== 'drag') return
    const mode = this.mode
    const raw = { x: world.x - mode.start.x, y: world.y - mode.start.y }
    const dot = raw.x * mode.normal.x + raw.y * mode.normal.y
    const delta = this.editor.isAngleSnapActive ? { x: mode.normal.x * dot, y: mode.normal.y * dot } : raw
    const track = this.editor.document.elements.find((e): e is TrackElement => e.type === 'track' && e.id === mode.trackId)
    if (!track) return
    for (const index of [mode.index, mode.index + 1]) {
      track.points[index] = { x: mode.before.points[index].x + delta.x, y: mode.before.points[index].y + delta.y }
    }
    // 端点与内部 vertexLinks 使用同一节点同步路径，保持所有直连轨道一致。
    for (const node of mode.beforeNodes) {
      moveNodeTo(this.editor.document, node.id, { x: node.x + delta.x, y: node.y + delta.y })
    }
    this.editor.invalidate()
  }

  finish(): void {
    if (this.mode.kind !== 'drag') return
    const mode = this.mode
    const track = this.editor.document.elements.find((e): e is TrackElement => e.type === 'track' && e.id === mode.trackId)
    const delta = track ? {
      x: track.points[mode.index].x - mode.before.points[mode.index].x,
      y: track.points[mode.index].y - mode.before.points[mode.index].y,
    } : null
    // 命令负责真正应用 delta；先还原预览，避免释放时再平移一次。
    this.cancel()
    if (delta && (delta.x !== 0 || delta.y !== 0)) {
      this.editor.executeCommand(new MoveSegmentCommand(this.editor, mode.trackId, mode.index, delta, mode.before, mode.beforeNodes))
    }
  }

  cancel(): void {
    if (this.mode.kind !== 'drag') return
    const mode = this.mode
    for (const node of mode.beforeNodes) moveNodeTo(this.editor.document, node.id, { x: node.x, y: node.y })
    for (const before of mode.beforeTracks) {
      const track = this.editor.document.elements.find((e): e is TrackElement => e.type === 'track' && e.id === before.id)
      if (track) track.points = before.points.map((point) => ({ ...point }))
    }
    this.mode = { kind: 'none' }
    this.editor.snapPoint = null
    this.editor.pointer.refreshCursor()
    this.editor.invalidate()
  }

  private segmentNormal(a: Point, b: Point): Point {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    return { x: -dy / len, y: dx / len }
  }
}
