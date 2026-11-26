import { v4 as uuidv4 } from 'uuid'
import type { LineElement } from '../../types'

export interface CreateLineOptions {
  points: LineElement['points']
  layerId: string
  name?: string
  dashed?: boolean
  arrowStart?: boolean
  arrowEnd?: boolean
  color?: string
  strokeWidth?: number
}

export const DEFAULT_LINE_WIDTH = 2
export const DEFAULT_LINE_COLOR = '#475569'

export function createLine(options: CreateLineOptions): LineElement {
  return {
    id: uuidv4(),
    type: 'line',
    layerId: options.layerId,
    visible: true,
    locked: false,
    name: options.name,
    points: options.points.map((p) => ({ ...p })),
    dashed: options.dashed ?? false,
    arrowStart: options.arrowStart ?? false,
    arrowEnd: options.arrowEnd ?? false,
    color: options.color ?? DEFAULT_LINE_COLOR,
    strokeWidth: options.strokeWidth ?? DEFAULT_LINE_WIDTH,
  }
}
