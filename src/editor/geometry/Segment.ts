import type { Point } from '../../types'
import { distance } from './Point'

/** A directed geometric segment with an implicit normal for double-track offsetting. */
export function segmentLength(a: Point, b: Point): number {
  return distance(a, b)
}

/** Normalized perpendicular (left side) of segment a->b in world space. */
export function perpendicularLeft(a: Point, b: Point): Point {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  return { x: -dy / len, y: dx / len }
}

export function segmentMid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

export function offsetPoint(p: Point, n: Point, amount: number): Point {
  return { x: p.x + n.x * amount, y: p.y + n.y * amount }
}

/** Shortest distance between point p and finite segment [a,b]. */
export function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const lenSq = abx * abx + aby * aby
  if (lenSq === 0) return distance(p, a)
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq
  t = Math.max(0, Math.min(1, t))
  const proj = { x: a.x + abx * t, y: a.y + aby * t }
  return distance(p, proj)
}

export interface IntersectionResult {
  intersects: boolean
  point?: { x: number; y: number }
  t1?: number
  t2?: number
}

/** 两线段交点（不含平行重叠线，返回端点接触）。 */
export function segmentIntersection(
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number },
): IntersectionResult {
  const d1x = a2.x - a1.x
  const d1y = a2.y - a1.y
  const d2x = b2.x - b1.x
  const d2y = b2.y - b1.y
  const denom = d1x * d2y - d1y * d2x
  if (Math.abs(denom) < 1e-9) return { intersects: false }
  const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / denom
  const u = ((b1.x - a1.x) * d1y - (b1.y - a1.y) * d1x) / denom
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return {
      intersects: true,
      point: { x: a1.x + d1x * t, y: a1.y + d1y * t },
      t1: t,
      t2: u,
    }
  }
  return { intersects: false }
}
