import type { Point } from '../../types'

/**
 * Camera transform: screen = world * zoom + offset.
 * world = (screen - offset) / zoom.
 */
export interface CameraTransform {
  zoom: number
  offsetX: number
  offsetY: number
}

export function worldToScreen(world: Point, t: CameraTransform): Point {
  return {
    x: world.x * t.zoom + t.offsetX,
    y: world.y * t.zoom + t.offsetY,
  }
}

export function screenToWorld(screen: Point, t: CameraTransform): Point {
  return {
    x: (screen.x - t.offsetX) / t.zoom,
    y: (screen.y - t.offsetY) / t.zoom,
  }
}
