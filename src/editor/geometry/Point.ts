import type { Point } from '../../types'

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y }
}

export function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y }
}

export function scale(a: Point, s: number): Point {
  return { x: a.x * s, y: a.y * s }
}

export function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

export function norm(a: Point): number {
  return Math.hypot(a.x, a.y)
}

export function normalize(a: Point): Point {
  const n = norm(a)
  if (n === 0) return { x: 1, y: 0 }
  return { x: a.x / n, y: a.y / n }
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

export function roundTo(value: number, step: number): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}
