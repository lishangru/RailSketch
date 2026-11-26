import { v4 as uuidv4 } from 'uuid'
import type { TrackElement } from '../../types'

export interface CreateTrackOptions {
  points?: TrackElement['points']
  layerId: string
  trackStyle?: TrackElement['trackStyle']
  strokeWidth?: number
  spacing?: number
  color?: string
  cornerRadius?: number
  bridgeGap?: number
  name?: string
  startNodeId?: string
  endNodeId?: string
}

export const DEFAULT_TRACK_WIDTH = 3
export const DEFAULT_TRACK_SPACING = 8
export const DEFAULT_TRACK_COLOR = '#1f2933'
export const DEFAULT_TRACK_CORNER_RADIUS = 0
export const DEFAULT_TRACK_BRIDGE_GAP = 20

export function createTrack(options: CreateTrackOptions): TrackElement {
  return {
    id: uuidv4(),
    type: 'track',
    layerId: options.layerId,
    visible: true,
    locked: false,
    name: options.name,
    points: (options.points ?? []).map((p) => ({ ...p })),
    trackStyle: options.trackStyle ?? 'single',
    strokeWidth: options.strokeWidth ?? DEFAULT_TRACK_WIDTH,
    spacing: options.spacing ?? DEFAULT_TRACK_SPACING,
    color: options.color ?? DEFAULT_TRACK_COLOR,
    cornerRadius: options.cornerRadius ?? DEFAULT_TRACK_CORNER_RADIUS,
    bridgeGap: options.bridgeGap ?? DEFAULT_TRACK_BRIDGE_GAP,
    startNodeId: options.startNodeId,
    endNodeId: options.endNodeId,
  }
}
