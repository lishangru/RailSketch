import type { DiagramElement, Point, PlatformElement, LabelElement } from '../../types'
import { isDirectionMarker, isLabel, isLine, isPlatform, isStation, isTrack } from '../model/Document'
import { labelBoxSize, labelDrawnRange } from '../render/LabelRenderer'
import { pointPolylineDistance } from './Polyline'
import { pointSegmentDistance } from './Segment'
import { distance as pointDistance } from './Point'

const PICK_PRIORITY: Record<DiagramElement['type'], number> = {
  platform: 3,
  station: 2,
  track: 1,
  label: 0,
  'direction-marker': 0,
  line: 0,
}

export interface HitResult {
  element: DiagramElement
  worldDistance: number
}

function labelBounding(v: LabelElement): { x: number; y: number; w: number; h: number; cy: number; cx: number } {
  // 命中框直接采用渲染层的绘制范围，保证「看到的」与「点得到的」是同一块区域。
  const box = labelBoxSize(v)
  const drawn = labelDrawnRange(v)
  return { x: v.x, y: v.y, w: box.w, h: box.h, cx: (drawn.left + drawn.right) / 2, cy: v.y }
}

function pointInOBBbAsAABB(p: Point, l: LabelElement): boolean {
  // Rotation-aware test: rotate p back into the label local frame.
  const b = labelBounding(l)
  const rad = (l.rotation * Math.PI) / 180
  const cos = Math.cos(-rad)
  const sin = Math.sin(-rad)
  const dx = p.x - b.cx
  const dy = p.y - b.cy
  const lx = dx * cos - dy * sin
  const ly = dx * sin + dy * cos
  return Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2
}

function labelToPointDistance(p: Point, l: LabelElement): number {
  if (pointInOBBbAsAABB(p, l)) return 0
  const b = labelBounding(l)
  // Fast approximation: distance to center minus half diagonal (adequate for single-line labels).
  const centerDist = pointDistance(p, { x: b.cx, y: b.cy })
  return Math.max(0, centerDist - Math.hypot(b.w, b.h) / 2)
}

function platformDistance(p: Point, pf: PlatformElement): number {
  const d = pointSegmentDistance(p, pf.start, pf.end)
  return Math.max(0, d - pf.width / 2)
}

function markerDistance(p: Point, m: import('../../types').DirectionMarkerElement, elements: DiagramElement[]): number {
  const track = elements.find((e): e is import('../../types').TrackElement => isTrack(e) && e.id === m.trackId)
  if (!track || track.points.length < 2) return Number.POSITIVE_INFINITY
  const endpoint = m.endpoint === 'start' ? track.points[0] : track.points[track.points.length - 1]
  const other = m.endpoint === 'start' ? track.points[1] : track.points[track.points.length - 2]
  const len = Math.hypot(endpoint.x - other.x, endpoint.y - other.y) || 1
  const ux = (endpoint.x - other.x) / len
  const uy = (endpoint.y - other.y) / len
  const dist = m.offset + m.textOffset + 8
  const tx = endpoint.x + ux * dist
  const ty = endpoint.y + uy * dist
  const w = m.text.length * m.fontSize
  const dx = Math.abs(p.x - tx)
  const dy = Math.abs(p.y - ty)
  if (dx <= w / 2 && dy <= 9) return 0
  return Math.max(0, Math.hypot(p.x - tx, p.y - ty) - Math.hypot(w, 18) / 2)
}

function hitDistance(p: Point, el: DiagramElement, elements: DiagramElement[] = []): number {
  if (isTrack(el)) {
    if (el.points.length < 1) return Number.POSITIVE_INFINITY
    // Include the offset lines so double-track rails feel pickable.
    const d = pointPolylineDistance(p, el.points)
    const base = Math.max(0, d - el.strokeWidth / 2)
    if (el.trackStyle === 'double') {
      const half = el.spacing / 2
      const centerOff = Math.max(0, d - Math.max(half, el.strokeWidth) / 2)
      return Math.min(base, centerOff)
    }
    return base
  }
  if (isLine(el)) {
    if (el.points.length < 2) return Number.POSITIVE_INFINITY
    return Math.max(0, pointPolylineDistance(p, el.points) - el.strokeWidth / 2)
  }
  if (isPlatform(el)) return platformDistance(p, el)
  if (isStation(el)) return Math.max(0, pointDistance(p, el) - el.radius)
  if (isLabel(el)) return labelToPointDistance(p, el)
  if (isDirectionMarker(el)) return markerDistance(p, el, elements)
  return Number.POSITIVE_INFINITY
}

export interface HitTestOptions {
  /** hit slop in world units; caller passes 8 / zoom. */
  maxDistance: number
  includeLocked?: boolean
  filter?: (el: DiagramElement) => boolean
}

/**
 * Hit-test：先比较世界距离（阈值由调用方按 8 / zoom 计算）。
 * 距离完全相同时，按 platform > track > label 的优先级打破平局，
 * 避免站台与股道中心线重合时站台永远无法被选中。
 */
export function hitTest(
  p: Point,
  elements: DiagramElement[],
  options: HitTestOptions,
): HitResult | null {
  let best: HitResult | null = null
  for (const el of elements) {
    if (!options.includeLocked && el.locked) continue
    if (options.filter && !options.filter(el)) continue
    const d = hitDistance(p, el, elements)
    if (d <= options.maxDistance) {
      const eps = 1e-6
      if (
        !best ||
        d < best.worldDistance - eps ||
        (Math.abs(d - best.worldDistance) <= eps && PICK_PRIORITY[el.type] > PICK_PRIORITY[best.element.type])
      ) {
        best = { element: el, worldDistance: d }
      }
    }
  }
  return best
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** 空间查询预留接口：第一版为线性遍历，后续可替换 RTree。 */
export interface SpatialQuery {
  queryPoint(point: Point, radius: number): string[]
  queryBounds(bounds: Bounds): string[]
}

export class LinearSpatialQuery implements SpatialQuery {
  constructor(private elements: DiagramElement[]) {}

  queryPoint(point: Point, radius: number): string[] {
    const ids: string[] = []
    for (const el of this.elements) {
      if (hitDistance(point, el, this.elements) <= radius) ids.push(el.id)
    }
    return ids
  }

  queryBounds(bounds: Bounds): string[] {
    const ids: string[] = []
    for (const el of this.elements) {
      if (el.type === 'track') {
        for (const p of el.points) {
          if (p.x >= bounds.minX && p.x <= bounds.maxX && p.y >= bounds.minY && p.y <= bounds.maxY) {
            ids.push(el.id)
            break
          }
        }
      } else if (el.type === 'platform') {
        if ((el.start.x >= bounds.minX && el.start.x <= bounds.maxX && el.start.y >= bounds.minY && el.start.y <= bounds.maxY) ||
            (el.end.x >= bounds.minX && el.end.x <= bounds.maxX && el.end.y >= bounds.minY && el.end.y <= bounds.maxY)) ids.push(el.id)
      } else if (el.type === 'label') {
        if (el.x >= bounds.minX && el.x <= bounds.maxX && el.y >= bounds.minY && el.y <= bounds.maxY) ids.push(el.id)
      }
    }
    return ids
  }
}
