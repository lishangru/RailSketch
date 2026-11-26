import type { Point } from '../../types'

/** 虚拟对齐的触发阈值（屏幕像素）。 */
export const ALIGNMENT_SNAP_PIXELS = 8

/** 对齐参考线：v = 垂直线，h = 水平线，line = 沿既有线段方向的无限直线。 */
export interface AlignmentGuide {
  kind: 'v' | 'h' | 'line'
  /** v：x 坐标 */
  x?: number
  /** h：y 坐标 */
  y?: number
  /** line：线上一点与方向 */
  a?: Point
  d?: Point
}

export interface AlignmentResult {
  point: Point
  guide: AlignmentGuide
  /** 需要调整的距离（越小越优先）。 */
  distance: number
}

/**
 * 虚拟对齐：在吸附开启时自动识别“可行”的对齐关系：
 * 1. 与任意既有轨道顶点共 x / 共 y（垂直 / 水平参考线）；
 * 2. 落在某段轨道的延长线上（无限直线参考线）。
 * 返回调整量最小的对齐结果；不可行时返回 null。
 */
export function snapToAlignment(
  p: Point,
  vertices: Point[],
  segments: { a: Point; b: Point }[],
  maxDistance: number,
): AlignmentResult | null {
  let best: AlignmentResult | null = null

  const consider = (point: Point, guide: AlignmentGuide, distance: number): void => {
    if (distance <= maxDistance && (!best || distance < best.distance)) {
      best = { point, guide, distance }
    }
  }

  for (const v of vertices) {
    const dx = Math.abs(p.x - v.x)
    if (dx > 1e-6) consider({ x: v.x, y: p.y }, { kind: 'v', x: v.x }, dx)
    const dy = Math.abs(p.y - v.y)
    if (dy > 1e-6) consider({ x: p.x, y: v.y }, { kind: 'h', y: v.y }, dy)
  }

  for (const s of segments) {
    const abx = s.b.x - s.a.x
    const aby = s.b.y - s.a.y
    const lenSq = abx * abx + aby * aby
    if (lenSq < 25) continue // 太短的段不参与延长线对齐
    // 点到无限直线的带符号距离；垂足 = p - d * 单位法线
    const len = Math.sqrt(lenSq)
    const nx = -aby / len
    const ny = abx / len
    const d = (p.x - s.a.x) * nx + (p.y - s.a.y) * ny
    const dist = Math.abs(d)
    if (dist < 1e-6) continue
    const foot = { x: p.x - d * nx, y: p.y - d * ny }
    consider(foot, { kind: 'line', a: { x: s.a.x, y: s.a.y }, d: { x: abx, y: aby } }, dist)
  }

  return best
}

/**
 * 对齐线与角度射线（lastPoint → anglePoint 方向）的交点。
 * 平行（无唯一交点）时返回 null。
 */
export function intersectionWithGuide(guide: AlignmentGuide, lastPoint: Point, anglePoint: Point): Point | null {
  const dx = anglePoint.x - lastPoint.x
  const dy = anglePoint.y - lastPoint.y
  if (guide.kind === 'v' && guide.x != null) {
    if (Math.abs(dx) < 1e-9) return null
    const t = (guide.x - lastPoint.x) / dx
    return { x: guide.x, y: lastPoint.y + dy * t }
  }
  if (guide.kind === 'h' && guide.y != null) {
    if (Math.abs(dy) < 1e-9) return null
    const t = (guide.y - lastPoint.y) / dy
    return { x: lastPoint.x + dx * t, y: guide.y }
  }
  if (guide.kind === 'line' && guide.a && guide.d) {
    const gx = guide.d.x
    const gy = guide.d.y
    const denom = gx * dy - gy * dx
    if (Math.abs(denom) < 1e-9) return null
    // 射线 lastPoint + t·dir 与 guide 无限直线的交点（两直线交点公式）。
    const t = ((guide.a.x - lastPoint.x) * gy - (guide.a.y - lastPoint.y) * gx) / denom
    return { x: lastPoint.x + dx * t, y: lastPoint.y + dy * t }
  }
  return null
}

/**
 * 在已满足的对齐线上继续取整到网格（自由坐标方向）。
 * 若角度约束已生效，仅当取整后仍落在角度射线上才应用网格。
 */
export function snapGuideToGrid(
  guide: AlignmentGuide,
  p: Point,
  gridSize: number,
  angleRay?: { lastPoint: Point; anglePoint: Point },
): Point {
  const g = gridSize > 0 ? gridSize : 20
  const angleOk = (candidate: Point): boolean => {
    if (!angleRay) return true
    const dx = angleRay.anglePoint.x - angleRay.lastPoint.x
    const dy = angleRay.anglePoint.y - angleRay.lastPoint.y
    const cdx = candidate.x - angleRay.lastPoint.x
    const cdy = candidate.y - angleRay.lastPoint.y
    const len1 = Math.hypot(dx, dy)
    const len2 = Math.hypot(cdx, cdy)
    if (len1 < 1e-9 || len2 < 1e-9) return true
    // 方向向量叉积归一化后必须近似为零（保持共线）。
    return Math.abs(dx * cdy - dy * cdx) <= 1e-6 * len1 * len2
  }
  if (guide.kind === 'v' && guide.x != null) {
    const candidate = { x: guide.x, y: Math.round(p.y / g) * g }
    return angleOk(candidate) ? candidate : p
  }
  if (guide.kind === 'h' && guide.y != null) {
    const candidate = { x: Math.round(p.x / g) * g, y: guide.y }
    return angleOk(candidate) ? candidate : p
  }
  return p
}
