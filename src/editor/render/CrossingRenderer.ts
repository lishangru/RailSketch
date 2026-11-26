import type { RailDocument } from '../../types'
import type { Camera } from '../core/Camera'
import type { EditorState } from '../core/EditorState'
import { isTrack } from '../model/Document'
import { segmentIntersection } from '../geometry/Segment'

/** 交叉渲染：plain 画小叉提示；bridge 只负责下层白色断口，上层保持原样。 */
export class CrossingRenderer {
  private isLowerActive(doc: RailDocument, state: EditorState, lowerId: string): boolean {
    return state.selectionIds.includes(lowerId) || state.hoverElementId === lowerId || state.hoverSegment?.trackId === lowerId
  }

  /** 所有跨线桥中的上层轨道 ID：这些轨道会延后到断口之后渲染。 */
  getBridgeUpperIds(doc: RailDocument): Set<string> {
    const ids = new Set<string>()
    for (const c of doc.crossings) {
      if (c.mode === 'bridge-a-over-b') ids.add(c.trackAId)
      else if (c.mode === 'bridge-b-over-a') ids.add(c.trackBId)
    }
    return ids
  }

  /** 被选中或悬停的跨线桥下层：应最后完整绘制，覆盖在其它轨道上方。 */
  getActiveLowerIds(doc: RailDocument, state: EditorState): Set<string> {
    const ids = new Set<string>()
    for (const c of doc.crossings) {
      const lowerId = c.mode === 'bridge-a-over-b' ? c.trackBId : c.mode === 'bridge-b-over-a' ? c.trackAId : ''
      if (lowerId && this.isLowerActive(doc, state, lowerId)) ids.add(lowerId)
    }
    return ids
  }

  render(ctx: CanvasRenderingContext2D, camera: Camera, doc: RailDocument, state: EditorState): void {
    // 示意图（线网图等）关闭交叉提示：几何交叉不是配线图需要表达的语义。
    if (doc.canvas.showCrossings === false) return
    const tracks = doc.elements.filter(isTrack).filter((track) => track.visible && doc.layers.find((layer) => layer.id === track.layerId)?.visible !== false)
    const crossings = new Map<string, RailDocument['crossings']>()
    for (const crossing of doc.crossings) {
      const key = JSON.stringify([crossing.trackAId, crossing.trackBId].sort())
      const list = crossings.get(key) ?? []
      list.push(crossing)
      crossings.set(key, list)
    }
    ctx.save()
    ctx.transform(camera.zoom, 0, 0, camera.zoom, camera.offsetX, camera.offsetY)
    for (let i = 0; i < tracks.length; i++) {
      for (let j = i + 1; j < tracks.length; j++) {
        const a = tracks[i]
        const b = tracks[j]
        const records = crossings.get(JSON.stringify([a.id, b.id].sort())) ?? []
        for (const point of this.intersections(a, b)) {
          const crossing = records.find((c) => Math.hypot(c.point.x - point.x, c.point.y - point.y) < 0.01)
          const mode = crossing?.mode ?? 'plain'
          if (!crossing || mode === 'plain') {
            this.drawPlain(ctx, camera, point)
          } else {
            const lowerId = mode === 'bridge-a-over-b' ? crossing.trackBId : crossing.trackAId
            const lower = a.id === lowerId ? a : b
            if (!this.isLowerActive(doc, state, lower.id)) this.drawLowerGap(ctx, point, lower)
          }
        }
      }
    }
    ctx.restore()
  }

  private intersections(a: TrackA, b: TrackA): { x: number; y: number }[] {
    const points: { x: number; y: number }[] = []
    const seen = new Set<string>()
    for (let i = 0; i < a.points.length - 1; i++) {
      for (let j = 0; j < b.points.length - 1; j++) {
        const r = segmentIntersection(a.points[i], a.points[i + 1], b.points[j], b.points[j + 1])
        if (!r.intersects || !r.point) continue
        const key = `${Math.round(r.point.x * 1e6)},${Math.round(r.point.y * 1e6)}`
        if (!seen.has(key)) {
          seen.add(key)
          points.push(r.point)
        }
      }
    }
    return points
  }

  private drawPlain(ctx: CanvasRenderingContext2D, camera: Camera, p: { x: number; y: number }): void {
    const r = 4 / camera.zoom
    ctx.strokeStyle = 'rgba(100,116,139,0.55)'
    ctx.lineWidth = 1 / camera.zoom
    ctx.beginPath()
    ctx.moveTo(p.x - r, p.y - r)
    ctx.lineTo(p.x + r, p.y + r)
    ctx.moveTo(p.x + r, p.y - r)
    ctx.lineTo(p.x - r, p.y + r)
    ctx.stroke()
  }

  private drawLowerGap(ctx: CanvasRenderingContext2D, p: { x: number; y: number }, lower: TrackA): void {
    // bridgeGap 表示沿线路方向的断开总宽度；白色断口沿线路方向绘制。
    const halfGap = Math.max(0, lower.bridgeGap) / 2
    const lowerDir = this.directionAt(lower, p)
    const ux = lowerDir.x
    const uy = lowerDir.y
    // 垂直线路方向的法线，用于双线轨道的左右偏移。
    const nx = -uy
    const ny = ux
    const half = lower.trackStyle === 'double' ? lower.spacing / 2 : 0
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = lower.strokeWidth + 8
    const offsets = lower.trackStyle === 'double' ? [-half, half] : [0]
    for (const off of offsets) {
      const cx = p.x + nx * off
      const cy = p.y + ny * off
      ctx.beginPath()
      ctx.moveTo(cx - ux * halfGap, cy - uy * halfGap)
      ctx.lineTo(cx + ux * halfGap, cy + uy * halfGap)
      ctx.stroke()
    }
  }

  private directionAt(track: TrackA, p: { x: number; y: number }): { x: number; y: number } {
    let best = { x: 1, y: 0 }
    let bestD = Number.POSITIVE_INFINITY
    for (let i = 0; i < track.points.length - 1; i++) {
      const a = track.points[i]
      const b = track.points[i + 1]
      const abx = b.x - a.x
      const aby = b.y - a.y
      const lenSq = abx * abx + aby * aby || 1
      let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq
      t = Math.max(0, Math.min(1, t))
      const d = Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t))
      if (d < bestD) {
        bestD = d
        const len = Math.sqrt(lenSq) || 1
        best = { x: abx / len, y: aby / len }
      }
    }
    return best
  }
}

type TrackA = import('../../types').TrackElement
