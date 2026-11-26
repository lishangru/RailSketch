import type { RailDocument } from '../../types'
import type { Camera } from '../core/Camera'
import { isPlatform } from '../model/Document'

export class PlatformRenderer {
  render(ctx: CanvasRenderingContext2D, camera: Camera, doc: RailDocument): void {
    ctx.save()
    ctx.transform(camera.zoom, 0, 0, camera.zoom, camera.offsetX, camera.offsetY)
    for (const el of doc.elements) {
      if (!isPlatform(el)) continue
      if (!el.visible) continue
      const layer = doc.layers.find((l) => l.id === el.layerId)
      if (layer && !layer.visible) continue
      this.renderPlatform(ctx, el)
    }
    ctx.restore()
  }

  private renderPlatform(
    ctx: CanvasRenderingContext2D,
    pl: { start: { x: number; y: number }; end: { x: number; y: number }; width: number; label?: string; color?: string; textColor?: string },
  ): void {
    const dx = pl.end.x - pl.start.x
    const dy = pl.end.y - pl.start.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-4) return
    const angle = Math.atan2(dy, dx)

    ctx.save()
    ctx.translate(pl.start.x, pl.start.y)
    ctx.rotate(angle)
    // 细长矩形
    ctx.fillStyle = pl.color ?? '#f8fafc'
    ctx.strokeStyle = '#94a3b8'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.rect(0, -pl.width / 2, len, pl.width)
    ctx.fill()
    ctx.stroke()
    // 站台内细线（表示站台面铺装）
    ctx.strokeStyle = '#cbd5e1'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(len, 0)
    ctx.stroke()

    if (pl.label) {
      ctx.fillStyle = pl.textColor ?? '#475569'
      // 站台文字字号随站台宽度自动变化。
      const fontSize = Math.max(9, Math.min(40, pl.width * 0.8))
      ctx.font = `${fontSize}px system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(pl.label, len / 2, 0)
    }
    ctx.restore()
  }
}
