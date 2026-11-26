import type { Point } from '../../types'
import { pointSegmentDistance } from './Segment'
import { distance } from './Point'

/** Distance from p to the polyline (min over all segments). */
export function pointPolylineDistance(p: Point, poly: Point[]): number {
  if (poly.length === 0) return Number.POSITIVE_INFINITY
  if (poly.length === 1) return distance(p, poly[0])
  let min = Number.POSITIVE_INFINITY
  for (let i = 0; i < poly.length - 1; i++) {
    const d = pointSegmentDistance(p, poly[i], poly[i + 1])
    if (d < min) min = d
  }
  return min
}

/** Total length of a polyline. */
export function polylineLength(poly: Point[]): number {
  let len = 0
  for (let i = 0; i < poly.length - 1; i++) len += distance(poly[i], poly[i + 1])
  return len
}
