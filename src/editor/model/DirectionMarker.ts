import { v4 as uuidv4 } from 'uuid'
import type { DirectionMarkerElement } from '../../types'

export interface CreateDirectionMarkerOptions {
  trackId: string
  endpoint: 'start' | 'end'
  text: string
  layerId: string
  arrow?: DirectionMarkerElement['arrow']
  offset?: number
  textOffset?: number
  textOrientation?: DirectionMarkerElement['textOrientation']
}

export function createDirectionMarker(options: CreateDirectionMarkerOptions): DirectionMarkerElement {
  return {
    id: uuidv4(),
    type: 'direction-marker',
    layerId: options.layerId,
    visible: true,
    locked: false,
    trackId: options.trackId,
    endpoint: options.endpoint,
    text: options.text,
    arrow: options.arrow ?? 'outward',
    offset: options.offset ?? 12,
    textOffset: options.textOffset ?? 18,
    textOrientation: options.textOrientation ?? 'follow',
    fontSize: 13,
    arrowSize: 10,
    strokeWidth: 2,
  }
}
