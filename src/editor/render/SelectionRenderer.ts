import type { DiagramElement, Point, RailDocument } from '../../types'
import type { Camera } from '../core/Camera'
import type { SelectedPoint } from '../core/EditorState'
import { isLine, isTrack } from '../model/Document'
import { labelDrawnRange } from './LabelRenderer'

const SELECTION_COLOR = '#2563eb'
const CONTROL_COLOR = '#ffffff'
const POINT_SELECTED_FILL = '#1d4ed8'

export class SelectionRenderer {
  render(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    doc: RailDocument,
    selectionIds: string[],
    selectedPoints: SelectedPoint[] = [],
  ): void {
    ctx.save()
    ctx.transform(camera.zoom, 0, 0, camera.zoom, camera.offsetX, camera.offsetY)
    for (const el of doc.elements) {
      if (!selectionIds.includes(el.id)) continue
      if (el.type === 'track') this.renderTrack(ctx, camera, el)
      else if (el.type === 'line') this.renderLine(ctx, camera, el)
      else if (el.type === 'platform') this.renderPlatform(ctx, camera, el)
      else if (el.type === 'label') this.renderLabel(ctx, camera, el)
    }
    if (selectedPoints.length > 0) this.renderSelectedPoints(ctx, camera, doc, selectedPoints)
    ctx.restore()
  }

  /** 单独选中的控制点：实心方块高亮。 */
  private renderSelectedPoints(ctx: CanvasRenderingContext2D, camera: Camera, doc: RailDocument, selectedPoints: SelectedPoint[]): void {
    for (const sp of selectedPoints) {
      const el = doc.elements.find((e) => e.id === sp.elementId)
      if (!el || (el.type !== 'track' && el.type !== 'line')) continue
      const index = Math.min(sp.index, el.points.length - 1)
      const p = el.points[index]
      if (!p) continue
      const r = 5.5 / camera.zoom
      ctx.beginPath()
      ctx.rect(p.x - r, p.y - r, r * 2, r * 2)
      ctx.fillStyle = POINT_SELECTED_FILL
      ctx.fill()
      ctx.lineWidth = r * 0.3
      ctx.strokeStyle = '#ffffff'
      ctx.stroke()
    }
  }

  renderHoverControl(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    el: DiagramElement,
    index: number,
  ): void {
    if ((!isTrack(el) && !isLine(el)) || index < 0 || index >= el.points.length) return
    ctx.save()
    ctx.transform(camera.zoom, 0, 0, camera.zoom, camera.offsetX, camera.offsetY)
    const p = el.points[index]
    this.drawControlHandles(ctx, [p], 6.5 / camera.zoom, SELECTION_COLOR, '#bfdbfe')
    ctx.restore()
  }

  renderSnapPoint(ctx: CanvasRenderingContext2D, camera: Camera, p: Point): void {
    ctx.save()
    ctx.transform(camera.zoom, 0, 0, camera.zoom, camera.offsetX, camera.offsetY)
    const r = 5 / camera.zoom
    ctx.beginPath()
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(37, 99, 235, 0.25)'
    ctx.fill()
    ctx.lineWidth = 1.4
    ctx.strokeStyle = '#2563eb'
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(p.x - r - 4, p.y)
    ctx.lineTo(p.x + r + 4, p.y)
    ctx.moveTo(p.x, p.y - r - 4)
    ctx.lineTo(p.x, p.y + r + 4)
    ctx.stroke()
    ctx.restore()
  }

  private renderTrack(ctx: CanvasRenderingContext2D, camera: Camera, el: DiagramElement): void {
    if (!isTrack(el)) return
    // 高亮光环
    ctx.strokeStyle = 'rgba(37, 99, 235, 0.32)'
    ctx.lineWidth = Math.max(4, el.strokeWidth + el.spacing + 8) / camera.zoom
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    if (el.points.length > 0) {
      ctx.moveTo(el.points[0].x, el.points[0].y)
      for (let i = 1; i < el.points.length; i++) ctx.lineTo(el.points[i].x, el.points[i].y)
    }
    ctx.stroke()
    this.drawControlHandles(ctx, el.points, 5 / camera.zoom, SELECTION_COLOR, CONTROL_COLOR)
  }

  private renderLine(ctx: CanvasRenderingContext2D, camera: Camera, el: DiagramElement): void {
    if (el.type !== 'line' || el.points.length < 2) return
    ctx.strokeStyle = 'rgba(37, 99, 235, 0.32)'
    ctx.lineWidth = Math.max(4, el.strokeWidth + 8) / camera.zoom
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(el.points[0].x, el.points[0].y)
    for (let i = 1; i < el.points.length; i++) ctx.lineTo(el.points[i].x, el.points[i].y)
    ctx.stroke()
    this.drawControlHandles(ctx, el.points, 5 / camera.zoom, SELECTION_COLOR, CONTROL_COLOR)
  }

  private renderPlatform(ctx: CanvasRenderingContext2D, camera: Camera, el: DiagramElement): void {
    if (el.type !== 'platform') return
    const dx = el.end.x - el.start.x
    const dy = el.end.y - el.start.y
    const len = Math.hypot(dx, dy) || 1
    const angle = Math.atan2(dy, dx)
    ctx.save()
    ctx.translate(el.start.x, el.start.y)
    ctx.rotate(angle)
    ctx.strokeStyle = 'rgba(37, 99, 235, 0.9)'
    ctx.lineWidth = 1.6 / camera.zoom
    ctx.setLineDash([4 / camera.zoom, 3 / camera.zoom])
    ctx.strokeRect(-4 / camera.zoom, -el.width / 2 - 4 / camera.zoom, len + 8 / camera.zoom, el.width + 8 / camera.zoom)
    ctx.setLineDash([])
    this.drawControlHandles(ctx, [
      { x: 0, y: 0 },
      { x: len, y: 0 },
    ], 5 / camera.zoom, SELECTION_COLOR, CONTROL_COLOR)
    ctx.restore()
  }

  private renderLabel(ctx: CanvasRenderingContext2D, camera: Camera, el: DiagramElement): void {
    if (el.type !== 'label') return
    // 选中框贴合实际绘制范围：左对齐文字的框必须从锚点向右展开。
    const drawn = labelDrawnRange(el)
    const pad = 4 / camera.zoom
    ctx.save()
    ctx.translate(el.x, el.y)
    ctx.rotate((el.rotation * Math.PI) / 180)
    ctx.strokeStyle = 'rgba(37, 99, 235, 0.9)'
    ctx.lineWidth = 1.2 / camera.zoom
    ctx.setLineDash([4 / camera.zoom, 3 / camera.zoom])
    ctx.strokeRect(
      drawn.left - el.x - pad,
      drawn.top - el.y - pad,
      drawn.right - drawn.left + pad * 2,
      drawn.bottom - drawn.top + pad * 2,
    )
    ctx.setLineDash([])
    ctx.restore()
  }

  private drawControlHandles(
    ctx: CanvasRenderingContext2D,
    points: Point[],
    radius: number,
    border: string,
    fill: string,
  ): void {
    for (const p of points) {
      const r = radius
      ctx.beginPath()
      ctx.rect(p.x - r, p.y - r, r * 2, r * 2)
      ctx.fillStyle = fill
      ctx.fill()
      ctx.lineWidth = r * 0.32
      ctx.strokeStyle = border
      ctx.stroke()
    }
  }
}
