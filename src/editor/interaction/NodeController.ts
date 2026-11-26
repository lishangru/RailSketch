import type { Point, RailwayNode, TrackElement } from '../../types'
import type { Editor } from '../core/Editor'
import { MoveNodeCommand } from '../commands/TopologyCommands'
import { getNode, moveNodeTo } from '../topology/Topology'

const MERGE_DISTANCE_PX = 12

/** 节点编辑模式：显示 / 拖动 / 合并拓扑节点。 */
export class NodeController {
  private mode: { kind: 'none' } | { kind: 'drag'; nodeId: string; beforeNode: RailwayNode; beforeTracks: TrackElement[] } = { kind: 'none' }
  private mergeCandidateId: string | null = null

  constructor(private editor: Editor) {}

  get isDragging(): boolean {
    return this.mode.kind === 'drag'
  }

  hover(world: Point): void {
    const node = this.editor.hitTestNode(world)
    this.editor.state.hoverNodeId = node && this.editor.isNodeEditable(node) ? node.id : null
    this.editor.invalidate()
  }

  pointerDown(world: Point): void {
    this.cancel()
    const node = this.editor.hitTestNode(world)
    if (!node || !this.editor.isNodeEditable(node)) {
      this.editor.clearSelection()
      return
    }
    this.editor.setSelection([])
    this.editor.state.hoverNodeId = node.id
    this.mode = {
      kind: 'drag',
      nodeId: node.id,
      beforeNode: JSON.parse(JSON.stringify(node)),
      beforeTracks: this.editor.document.elements
        .filter((e): e is TrackElement => e.type === 'track' && node.connectedTrackIds.includes(e.id))
        .map((t) => JSON.parse(JSON.stringify(t))),
    }
    this.editor.setCursor('move')
  }

  move(world: Point): void {
    if (this.mode.kind !== 'drag') return
    const radius = MERGE_DISTANCE_PX / this.editor.camera.zoom
    const target = this.editor.findEditableNodeNear(world, radius, this.mode.nodeId)
    if (target) {
      this.mergeCandidateId = target.id
      this.editor.snapPoint = { x: target.x, y: target.y }
      moveNodeTo(this.editor.document, this.mode.nodeId, { x: target.x, y: target.y })
    } else {
      this.mergeCandidateId = null
      const p = this.editor.getSnapPoint(world, false).point
      this.editor.snapPoint = null
      moveNodeTo(this.editor.document, this.mode.nodeId, p)
    }
    this.editor.invalidate()
  }

  finish(): void {
    if (this.mode.kind !== 'drag') return
    const { nodeId, beforeNode, beforeTracks } = this.mode
    const node = getNode(this.editor.document, nodeId)
    const to = node ? { x: node.x, y: node.y } : null
    const targetId = this.mergeCandidateId
    // 实时预览不是历史状态：合并命令必须捕获拖动前的节点及轨道。
    this.cancel()
    if (targetId) {
      this.editor.mergeNodesCommand(nodeId, targetId)
    } else if (to && (to.x !== beforeNode.x || to.y !== beforeNode.y)) {
      this.editor.executeCommand(new MoveNodeCommand(this.editor, nodeId, to, beforeNode, beforeTracks))
    }
  }

  cancel(): void {
    if (this.mode.kind !== 'drag') return
    const { beforeNode, beforeTracks } = this.mode
    moveNodeTo(this.editor.document, beforeNode.id, { x: beforeNode.x, y: beforeNode.y })
    for (const t of beforeTracks) {
      const cur = this.editor.document.elements.find((e) => e.id === t.id)
      if (cur && cur.type === 'track') cur.points = t.points.map((p) => ({ ...p }))
    }
    this.mode = { kind: 'none' }
    this.mergeCandidateId = null
    this.editor.snapPoint = null
    this.editor.pointer.refreshCursor()
    this.editor.invalidate()
  }
}
