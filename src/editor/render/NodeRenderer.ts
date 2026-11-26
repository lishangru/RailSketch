import type { RailDocument, TrackElement } from '../../types'
import type { Camera } from '../core/Camera'
import type { EditorState } from '../core/EditorState'
import { isTrack } from '../model/Document'

/** 拓扑节点渲染：默认不明显，节点模式 / 相关线路选中 / 道岔节点时显示。 */
export class NodeRenderer {
  render(ctx: CanvasRenderingContext2D, camera: Camera, doc: RailDocument, state: EditorState): void {
    if (doc.nodes.length === 0) return
    const selectedTracks = doc.elements.filter((e): e is TrackElement => isTrack(e) && state.selectionIds.includes(e.id))
    const selectedNodeIds = new Set<string>()
    for (const t of selectedTracks) {
      if (t.startNodeId) selectedNodeIds.add(t.startNodeId)
      if (t.endNodeId) selectedNodeIds.add(t.endNodeId)
    }

    ctx.save()
    ctx.transform(camera.zoom, 0, 0, camera.zoom, camera.offsetX, camera.offsetY)
    for (const node of doc.nodes) {
      const show =
        state.tool === 'node' ||
        node.nodeType === 'switch' ||
        node.nodeType === 'junction' ||
        node.nodeType === 'crossing' ||
        selectedNodeIds.has(node.id) ||
        state.hoverNodeId === node.id
      if (!show) continue
      this.drawNode(ctx, camera, node.x, node.y, node.nodeType, node.connectedTrackIds.length > 1)
    }
    ctx.restore()
  }

  private drawNode(ctx: CanvasRenderingContext2D, camera: Camera, x: number, y: number, nodeType: string, connected: boolean): void {
    const r = 4.2 / camera.zoom
    ctx.lineWidth = 1.4 / camera.zoom
    ctx.strokeStyle = '#1f2933'
    ctx.fillStyle = connected ? '#1f2933' : '#ffffff'
    if (nodeType === 'switch' || nodeType === 'junction') {
      // ◆ / ●
      ctx.beginPath()
      if (nodeType === 'switch') {
        ctx.moveTo(x, y - r)
        ctx.lineTo(x + r, y)
        ctx.lineTo(x, y + r)
        ctx.lineTo(x - r, y)
      } else {
        ctx.arc(x, y, r * 0.9, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.closePath()
      if (nodeType === 'switch') {
        ctx.fillStyle = '#ffffff'
        ctx.fill()
      }
      ctx.stroke()
      return
    }
    if (nodeType === 'crossing') {
      ctx.beginPath()
      ctx.moveTo(x, y - r)
      ctx.lineTo(x + r, y)
      ctx.lineTo(x, y + r)
      ctx.lineTo(x - r, y)
      ctx.closePath()
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.stroke()
      return
    }
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
}
