import type { Camera } from '../core/Camera'

/**
 * 无限网格。使用世界坐标并绘制屏幕可见范围，网格步长随 zoom 自适应，
 * 避免缩放很小时出现网格过密。
 */
export class GridRenderer {
  render(ctx: CanvasRenderingContext2D, camera: Camera, cssWidth: number, cssHeight: number, baseGridSize: number): void {
    if (![baseGridSize, camera.zoom, camera.offsetX, camera.offsetY, cssWidth, cssHeight].every(Number.isFinite)) return
    if (baseGridSize <= 0 || camera.zoom <= 0 || cssWidth <= 0 || cssHeight <= 0) return
    const base = Math.max(4, baseGridSize)
    const scale = Math.max(0, Math.ceil(Math.log(24 / (base * camera.zoom)) / Math.log(5)))
    const step = base * 5 ** scale
    if (!Number.isFinite(step) || step <= 0) return

    const tl = camera.screenToWorld({ x: -10, y: -10 })
    const br = camera.screenToWorld({ x: cssWidth + 10, y: cssHeight + 10 })
    if (![tl.x, tl.y, br.x, br.y].every(Number.isFinite)) return

    const draw = (spacing: number, color: string, width: number): void => {
      const startX = Math.floor(tl.x / spacing) * spacing
      const startY = Math.floor(tl.y / spacing) * spacing
      const countX = Math.floor((br.x - startX) / spacing) + 1
      const countY = Math.floor((br.y - startY) / spacing) + 1
      if (![startX, startY, countX, countY].every(Number.isFinite)) return
      if (countX < 0 || countY < 0 || countX + countY > 10_000) return
      ctx.beginPath()
      // 按数量迭代，避免极大世界坐标下浮点加法 x + spacing === x。
      for (let i = 0; i < countX; i++) {
        const x = startX + i * spacing
        ctx.moveTo(x, tl.y)
        ctx.lineTo(x, br.y)
      }
      for (let i = 0; i < countY; i++) {
        const y = startY + i * spacing
        ctx.moveTo(tl.x, y)
        ctx.lineTo(br.x, y)
      }
      ctx.lineWidth = width / camera.zoom
      ctx.strokeStyle = color
      ctx.stroke()
    }

    ctx.save()
    ctx.transform(camera.zoom, 0, 0, camera.zoom, camera.offsetX, camera.offsetY)
    draw(step, '#e6e9ee', 1)
    draw(step * 5, '#d7dce3', 1.4)
    ctx.restore()
  }
}
