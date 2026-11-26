import type { Point } from '../../types'

/** 铁路八方向角度（世界坐标系，Y 轴向下）。 */
export const RAIL_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315] as const

export function snapToRailAngle(origin: Point, cursor: Point): Point {
  const dx = cursor.x - origin.x
  const dy = cursor.y - origin.y
  if (Math.hypot(dx, dy) < 1e-6) return { ...origin }
  const rawAngle = (Math.atan2(dy, dx) * 180) / Math.PI
  const normalized = ((rawAngle % 360) + 360) % 360
  let bestAngle = 0
  let bestDiff = Number.POSITIVE_INFINITY
  for (const a of RAIL_ANGLES) {
    let diff = Math.abs(normalized - a)
    if (diff > 180) diff = 360 - diff
    if (diff < bestDiff) {
      bestDiff = diff
      bestAngle = a
    }
  }
  const rad = (bestAngle * Math.PI) / 180
  const len = Math.hypot(dx, dy)
  return {
    x: origin.x + Math.cos(rad) * len,
    y: origin.y + Math.sin(rad) * len,
  }
}
