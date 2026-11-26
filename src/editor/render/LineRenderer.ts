import type { LineElement, Point, RailDocument } from '../../types'
import type { Camera } from '../core/Camera'
import { isLine } from '../model/Document'

/**
 * 线元素渲染器：折线 + 虚线 + 端部箭头（箭头 / 虚线等常见示意图元素）。
 */
export class LineRenderer {
  render(ctx: CanvasRenderingContext2D, camera: Camera, doc: RailDocument): void {
    ctx.save()
    ctx.transform(camera.zoom, 0, 0, camera.zoom, camera.offsetX, camera.offsetY)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const el of doc.elements) {
      if (!isLine(el)) continue
      if (!el.visible) continue
      const layer = doc.layers.find((l) => l.id === el.layerId)
      if (layer && !layer.visible) continue
      this.renderLine(ctx, el)
    }
    ctx.restore()
  }

  private renderLine(ctx: CanvasRenderingContext2D, el: LineElement): void {
    const pts = el.points
    if (pts.length === 0) return
    ctx.strokeStyle = el.color
    ctx.lineWidth = el.strokeWidth
    if (el.dashed) ctx.setLineDash([7, 5])
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
    ctx.stroke()
    if (el.dashed) ctx.setLineDash([])
    if (el.arrowStart) this.drawArrow(ctx, pts, 'start', el.color)
    if (el.arrowEnd) this.drawArrow(ctx, pts, 'end', el.color)
  }

  private drawArrow(ctx: CanvasRenderingContext2D, points: Point[], endpoint: 'start' | 'end', color: string): void {
    if (points.length < 2) return
    const idx = endpoint === 'start' ? 0 : points.length - 1
    const next = endpoint === 'start' ? 1 : points.length - 2
    let dx = points[idx].x - points[next].x
    let dy = points[idx].y - points[next].y
    const len = Math.hypot(dx, dy) || 1
    dx /= len
    dy /= len
    const headLen = 11
    const halfW = 5
    const base = { x: points[idx].x + dx * headLen, y: points[idx].y + dy * headLen }
    const nx = -dy
    const ny = dx
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(points[idx].x, points[idx].y)
    ctx.lineTo(base.x + nx * halfW, base.y + ny * halfW)
    ctx.lineTo(base.x - nx * halfW, base.y - ny * halfW)
    ctx.closePath()
    ctx.fill()
  }
}
