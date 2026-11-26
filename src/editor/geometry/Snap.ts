import type { Point } from '../../types'

export const DEFAULT_SNAP_PIXELS = 10

/** Snap to a world grid. */
export function snapToGrid(p: Point, gridSize: number): Point {
  if (gridSize <= 0) return p
  return {
    x: Math.round(p.x / gridSize) * gridSize,
    y: Math.round(p.y / gridSize) * gridSize,
  }
}

/** 计算点 p 到线段 [a,b] 的最近投影点。 */
function closestPointOnSegment(p: Point, a: Point, b: Point): Point {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const lenSq = abx * abx + aby * aby
  if (lenSq === 0) return { x: a.x, y: a.y }
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq
  t = Math.max(0, Math.min(1, t))
  return { x: a.x + abx * t, y: a.y + aby * t }
}

/** Snap p onto the nearest existing track polyline within maxDistance. */
export function snapToTrackLines(p: Point, tracks: Point[][], maxDistance: number): { point: Point; snapped: boolean } {
  let best: Point | null = null
  let bestDist = maxDistance
  for (const poly of tracks) {
    for (let i = 0; i < poly.length - 1; i++) {
      const proj = closestPointOnSegment(p, poly[i], poly[i + 1])
      const d = Math.hypot(p.x - proj.x, p.y - proj.y)
      if (d <= bestDist) {
        bestDist = d
        best = proj
      }
    }
  }
  if (best) return { point: best, snapped: true }
  return { point: p, snapped: false }
}

/** Snap p onto any candidate point if within maxDistance (world units). */
export function snapToPoints(p: Point, candidates: Point[], maxDistance: number): { point: Point; snapped: boolean } {
  let best: Point | null = null
  let bestDist = maxDistance
  for (const c of candidates) {
    const d = Math.hypot(c.x - p.x, c.y - p.y)
    if (d <= bestDist) {
      bestDist = d
      best = c
    }
  }
  if (best) return { point: best, snapped: true }
  return { point: p, snapped: false }
}
