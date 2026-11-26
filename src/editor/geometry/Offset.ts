import type { Point } from '../../types'

const MITER_LIMIT = 4
const EPS = 1e-6

/**
 * 通用 Polyline Offset。对每段求单位法线，在折点处求相邻
 * 偏移直线的交点；锐角斜接超过 MITER_LIMIT 时退化为 bevel。
 */
export function offsetPolyline(points: Point[], distance: number): Point[] {
  if (points.length < 2) return points.map((p) => ({ ...p }))
  if (Math.abs(distance) < EPS) return points.map((p) => ({ ...p }))

  const n = points.length
  const normals: Point[] = []
  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1].x - points[i].x
    const dy = points[i + 1].y - points[i].y
    const len = Math.hypot(dx, dy) || 1
    normals.push({ x: -dy / len, y: dx / len })
  }

  const result: Point[] = []
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      result.push({ x: points[0].x + normals[0].x * distance, y: points[0].y + normals[0].y * distance })
    } else if (i === n - 1) {
      const k = n - 2
      result.push({ x: points[i].x + normals[k].x * distance, y: points[i].y + normals[k].y * distance })
    } else {
      const a = points[i - 1]
      const b = points[i]
      const c = points[i + 1]
      const na = normals[i - 1]
      const nb = normals[i]
      const line1p = { x: b.x + na.x * distance, y: b.y + na.y * distance }
      const line1v = { x: b.x - a.x, y: b.y - a.y }
      const line2p = { x: b.x + nb.x * distance, y: b.y + nb.y * distance }
      const line2v = { x: c.x - b.x, y: c.y - b.y }
      const cross = line1v.x * line2v.y - line1v.y * line2v.x
      if (Math.abs(cross) < EPS) {
        result.push({ ...line1p })
      } else {
        const t = ((line2p.x - line1p.x) * line2v.y - (line2p.y - line1p.y) * line2v.x) / cross
        const joint = { x: line1p.x + line1v.x * t, y: line1p.y + line1v.y * t }
        const miterLen = Math.hypot(joint.x - b.x, joint.y - b.y) / (Math.abs(distance) || 1)
        if (miterLen <= MITER_LIMIT) {
          result.push(joint)
        } else {
          // Bevel：用两个相邻偏移端点连接，取中点作为折点。
          const mid = { x: (line1p.x + line2p.x) / 2, y: (line1p.y + line2p.y) / 2 }
          result.push(mid)
        }
      }
    }
  }
  return result
}
