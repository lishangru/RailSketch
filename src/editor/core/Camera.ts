import type { Point } from '../../types'
import { clamp } from '../geometry/Point'

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 5

/**
 * 世界坐标与屏幕坐标之间的仿射变换。
 * screen = world * zoom + offset
 * world  = (screen - offset) / zoom
 */
export class Camera {
  zoom = 1
  offsetX = 40
  offsetY = 40

  worldToScreen(world: Point): Point {
    return {
      x: world.x * this.zoom + this.offsetX,
      y: world.y * this.zoom + this.offsetY,
    }
  }

  screenToWorld(screen: Point): Point {
    return {
      x: (screen.x - this.offsetX) / this.zoom,
      y: (screen.y - this.offsetY) / this.zoom,
    }
  }

  /** Zoom around a fixed screen-space anchor (normally the mouse). */
  zoomAt(screen: Point, factor: number): void {
    if (![screen.x, screen.y, factor].every(Number.isFinite) || factor <= 0) return
    const newZoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM)
    const before = this.screenToWorld(screen)
    this.zoom = newZoom
    this.offsetX = screen.x - before.x * this.zoom
    this.offsetY = screen.y - before.y * this.zoom
  }

  panBy(dx: number, dy: number): void {
    if (![dx, dy, this.offsetX + dx, this.offsetY + dy].every(Number.isFinite)) return
    this.offsetX += dx
    this.offsetY += dy
  }

  setTransform(zoom: number, offsetX: number, offsetY: number): void {
    if (![zoom, offsetX, offsetY].every(Number.isFinite)) return
    this.zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM)
    this.offsetX = offsetX
    this.offsetY = offsetY
  }

  reset(): void {
    this.zoom = 1
    this.offsetX = 40
    this.offsetY = 40
  }
}
