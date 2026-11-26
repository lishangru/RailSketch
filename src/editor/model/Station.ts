import { v4 as uuidv4 } from 'uuid'
import type { StationElement, StationKind } from '../../types'

/** 普通站圆圈半径（世界单位）。 */
export const DEFAULT_STATION_RADIUS = 7
/** 换乘站圆圈半径：明显大于普通站，形成视觉层级。 */
export const DEFAULT_TRANSFER_RADIUS = 11
export const DEFAULT_STATION_COLOR = '#ffffff'
export const DEFAULT_STATION_BORDER_COLOR = '#1f2933'
/** 普通站描边宽度。 */
export const DEFAULT_STATION_BORDER_WIDTH = 3
/** 换乘站描边宽度：更粗，配合内环强调。 */
export const DEFAULT_TRANSFER_BORDER_WIDTH = 3.5
/** 换乘站内环半径系数（相对外圈半径）。 */
export const TRANSFER_INNER_RATIO = 0.34

export interface CreateStationOptions {
  x: number
  y: number
  layerId: string
  kind?: StationKind
  name?: string
  radius?: number
  color?: string
  borderColor?: string
  borderWidth?: number
  innerRadius?: number
  /** 关联线路的 track id；换乘站可有多条。 */
  trackIds?: string[]
}

/** 按站点类型给出合理的默认样式，使「新建站点」开箱即用。 */
export function stationDefaults(kind: StationKind): {
  radius: number
  color: string
  borderColor: string
  borderWidth: number
  innerRadius: number
} {
  return kind === 'transfer'
    ? {
        radius: DEFAULT_TRANSFER_RADIUS,
        color: DEFAULT_STATION_COLOR,
        borderColor: DEFAULT_STATION_BORDER_COLOR,
        borderWidth: DEFAULT_TRANSFER_BORDER_WIDTH,
        innerRadius: DEFAULT_TRANSFER_RADIUS * TRANSFER_INNER_RATIO,
      }
    : {
        radius: DEFAULT_STATION_RADIUS,
        color: DEFAULT_STATION_COLOR,
        borderColor: DEFAULT_STATION_BORDER_COLOR,
        borderWidth: DEFAULT_STATION_BORDER_WIDTH,
        innerRadius: 0,
      }
}

export function createStation(options: CreateStationOptions): StationElement {
  const kind: StationKind = options.kind === 'transfer' ? 'transfer' : 'station'
  const defaults = stationDefaults(kind)
  return {
    id: uuidv4(),
    type: 'station',
    layerId: options.layerId,
    visible: true,
    locked: false,
    kind,
    name: options.name,
    x: options.x,
    y: options.y,
    radius: options.radius ?? defaults.radius,
    color: options.color ?? defaults.color,
    borderColor: options.borderColor ?? defaults.borderColor,
    borderWidth: options.borderWidth ?? defaults.borderWidth,
    innerRadius: options.innerRadius ?? defaults.innerRadius,
    trackIds: options.trackIds ? [...new Set(options.trackIds)] : [],
  }
}

/** 车站是否位于某条线路的容差范围内（用于放置时自动关联）。 */
export function isStationOnTrack(track: { points: { x: number; y: number }[] }, p: { x: number; y: number }, tolerance: number): boolean {
  for (let i = 0; i < track.points.length - 1; i++) {
    const a = track.points[i]!
    const b = track.points[i + 1]!
    const abx = b.x - a.x
    const aby = b.y - a.y
    const lenSq = abx * abx + aby * aby
    if (lenSq < 1e-9) continue
    let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq
    t = Math.max(0, Math.min(1, t))
    if (Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t)) <= tolerance) return true
  }
  return false
}
