import type { RailDocument, StationElement } from '../../types'
import type { Camera } from '../core/Camera'
import { isStation } from '../model/Document'

/**
 * 车站标记渲染。
 *
 * 两种图标：
 * - 普通站：白底圆圈 + 描边。
 * - 换乘站：更大的圆圈 + 更粗描边 + 内环（同心圆），一眼可区分。
 *
 * 圆圈绘制在线路之上（由 Renderer 的调用顺序保证），因此在彩色线路上
 * 依然保持白底可读，贴近真实线网图的站点符号。
 */
export class StationRenderer {
  render(ctx: CanvasRenderingContext2D, camera: Camera, doc: RailDocument): void {
    ctx.save()
    ctx.transform(camera.zoom, 0, 0, camera.zoom, camera.offsetX, camera.offsetY)
    for (const el of doc.elements) {
      if (!isStation(el)) continue
      if (!el.visible) continue
      const layer = doc.layers.find((l) => l.id === el.layerId)
      if (layer && !layer.visible) continue
      this.renderStation(ctx, el)
    }
    ctx.restore()
  }

  private renderStation(ctx: CanvasRenderingContext2D, el: StationElement): void {
    const r = Math.max(0, el.radius)
    if (r <= 0) return
    ctx.beginPath()
    ctx.arc(el.x, el.y, r, 0, Math.PI * 2)
    ctx.fillStyle = el.color
    ctx.fill()
    if (el.borderWidth > 0) {
      ctx.lineWidth = el.borderWidth
      ctx.strokeStyle = el.borderColor
      ctx.stroke()
    }
    // 换乘站内环：同心小圆，进一步强化与普通站的差异。
    if (el.kind === 'transfer' && el.innerRadius > 0) {
      // 描边宽度可大于半径（属性面板允许），负半径会让 ctx.arc 抛 IndexSizeError 并中断整帧渲染。
      const inner = Math.max(0, Math.min(el.innerRadius, r - el.borderWidth))
      if (inner > 0) {
        ctx.beginPath()
        ctx.arc(el.x, el.y, inner, 0, Math.PI * 2)
        ctx.fillStyle = el.borderColor
        ctx.fill()
      }
    }
  }
}
