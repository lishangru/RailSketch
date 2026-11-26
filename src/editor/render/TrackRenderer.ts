import type { TrackElement, Point, RailDocument } from '../../types'
import type { Camera } from '../core/Camera'
import { isTrack } from '../model/Document'

interface OffsetPolyline {
  points: Point[]
}

/**
 * 双线轨道渲染器。用户只维护中心 Polyline；
 * 双线由中心线向两侧偏移 spacing/2 自动生成。
 *
 * 转角处采用“扇形联结点”：
 *   - 只包含两条线段的小转折：用端帽圆 + 相邻偏移线夹角平分方向连接，保证折角自然。
 *   - 更长折线：先计算每个顶点的左/右偏移点集合，按路径顺序连线。
 */
export class TrackRenderer {
  render(ctx: CanvasRenderingContext2D, camera: Camera, doc: RailDocument, filter?: (track: TrackElement) => boolean): void {
    ctx.save()
    ctx.transform(camera.zoom, 0, 0, camera.zoom, camera.offsetX, camera.offsetY)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    for (const el of doc.elements) {
      if (!isTrack(el)) continue
      if (filter && !filter(el)) continue
      if (!el.visible) continue
      const layer = doc.layers.find((l) => l.id === el.layerId)
      if (layer && !layer.visible) continue
      this.renderTrack(ctx, el)
    }
    ctx.restore()
  }

  renderPreview(ctx: CanvasRenderingContext2D, camera: Camera, points: Point[], color: string): void {
    if (points.length === 0) return
    ctx.save()
    ctx.transform(camera.zoom, 0, 0, camera.zoom, camera.offsetX, camera.offsetY)
    ctx.strokeStyle = color
    ctx.lineWidth = 2 / camera.zoom
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    // 虚线预览中心线
    ctx.setLineDash([6 / camera.zoom, 5 / camera.zoom])
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
    ctx.stroke()
    ctx.setLineDash([])
    // 预览点
    ctx.fillStyle = '#2563eb'
    for (const p of points) {
      ctx.beginPath()
      ctx.arc(p.x, p.y, 3.5 / camera.zoom, 0, Math.PI * 2)
      ctx.fill()
    }
    // 当前光标位置十字
    const last = points[points.length - 1]
    const r = 5 / camera.zoom
    ctx.strokeStyle = '#2563eb'
    ctx.lineWidth = 1.4 / camera.zoom
    ctx.beginPath()
    ctx.moveTo(last.x - r, last.y)
    ctx.lineTo(last.x + r, last.y)
    ctx.moveTo(last.x, last.y - r)
    ctx.lineTo(last.x, last.y + r)
    ctx.stroke()
    ctx.restore()
  }

  private renderTrack(ctx: CanvasRenderingContext2D, track: TrackElement): void {
    const pts = track.points
    if (pts.length === 0) return
    ctx.strokeStyle = track.color
    if (track.trackStyle === 'single' || pts.length < 2) {
      ctx.lineWidth = track.strokeWidth
      if (pts.length === 1) {
        ctx.beginPath()
        ctx.arc(pts[0].x, pts[0].y, track.strokeWidth / 2, 0, Math.PI * 2)
        ctx.fillStyle = track.color
        ctx.fill()
        return
      }
      ctx.beginPath()
      this.traceRoundedPolyline(ctx, pts, track.cornerRadius)
      ctx.stroke()
      return
    }

    // —— 双线 ——
    const half = Math.max(0.5, track.spacing / 2)
    const { left, right } = this.offsetPolyline(pts, half)
    ctx.lineWidth = track.strokeWidth
    this.drawCenteredPolyline(ctx, left, track.color, track.cornerRadius)
    this.drawCenteredPolyline(ctx, right, track.color, track.cornerRadius)
    // 端点横封：两条偏移线在起点/终点闭合，形成双线端帽。
    this.capEndpoint(ctx, track, left.points[0], right.points[0])
    this.capEndpoint(
      ctx,
      track,
      left.points[left.points.length - 1],
      right.points[right.points.length - 1],
    )
  }

  private drawCenteredPolyline(
    ctx: CanvasRenderingContext2D,
    t: OffsetPolyline,
    color: string,
    cornerRadius: number,
  ): void {
    if (t.points.length === 0) return
    ctx.strokeStyle = color
    ctx.beginPath()
    this.traceRoundedPolyline(ctx, t.points, cornerRadius)
    ctx.stroke()
  }

  /**
   * 在折线的每个内部顶点处用 arcTo 生成圆角。
   * 圆角半径会自动钳制为相邻两段长度的一半，避免自交。
   */
  private traceRoundedPolyline(ctx: CanvasRenderingContext2D, pts: Point[], radius: number): void {
    if (pts.length === 0) return
    ctx.moveTo(pts[0].x, pts[0].y)
    if (pts.length === 1 || radius <= 0.01) {
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
      return
    }
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i]
      const prev = pts[i - 1]
      const next = pts[i + 1]
      const lenPrev = Math.hypot(p.x - prev.x, p.y - prev.y)
      const lenNext = Math.hypot(next.x - p.x, next.y - p.y)
      const r = Math.min(radius, lenPrev / 2, lenNext / 2)
      if (r <= 0.01) {
        ctx.lineTo(p.x, p.y)
        continue
      }
      const u1x = (prev.x - p.x) / lenPrev
      const u1y = (prev.y - p.y) / lenPrev
      const u2x = (next.x - p.x) / lenNext
      const u2y = (next.y - p.y) / lenNext
      const a = { x: p.x + u1x * r, y: p.y + u1y * r }
      const b = { x: p.x + u2x * r, y: p.y + u2y * r }
      ctx.lineTo(a.x, a.y)
      ctx.arcTo(p.x, p.y, b.x, b.y, r)
    }
    const last = pts[pts.length - 1]
    ctx.lineTo(last.x, last.y)
  }

  private capEndpoint(
    ctx: CanvasRenderingContext2D,
    track: TrackElement,
    a: Point,
    b: Point,
  ): void {
    // 用两线端点间连线作为端帽，让双线轨类似“═”的闭合端。
    ctx.strokeStyle = track.color
    ctx.lineWidth = track.strokeWidth
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }

  /**
   * 中心线 -> 左右偏移线。
   *
   * 算法说明：
   * 1. 对每个内部顶点，取相邻两段单位法线的平均并归一化，作为该顶点处的
   *    偏移方向。这可以避免在锐角处产生过大的“尖刺”。
   * 2. 端点直接使用所在线段法线。
   * 3. 双线间距为 spacing，故分别偏移 ±spacing/2。
   */
  private offsetPolyline(pts: Point[], amount: number): { left: OffsetPolyline; right: OffsetPolyline } {
    const n = pts.length
    const left: Point[] = []
    const right: Point[] = []
    for (let i = 0; i < n; i++) {
      let nx = 0
      let ny = 0
      if (i > 0) {
        const d = this.direction(pts[i - 1], pts[i])
        nx += d.x
        ny += d.y
      }
      if (i < n - 1) {
        const d = this.direction(pts[i], pts[i + 1])
        nx += d.x
        ny += d.y
      }
      const len = Math.hypot(nx, ny) || 1
      nx /= len
      ny /= len
      left.push({ x: pts[i].x + nx * amount, y: pts[i].y + ny * amount })
      right.push({ x: pts[i].x - nx * amount, y: pts[i].y - ny * amount })
    }
    return { left: { points: left }, right: { points: right } }
  }

  /** 线段方向单位向量并取垂直于方向（左侧法线）。 */
  private direction(a: Point, b: Point): Point {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len }
  }
}
