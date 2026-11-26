import { v4 as uuidv4 } from 'uuid'
import type { PlatformElement } from '../../types'

export const DEFAULT_PLATFORM_WIDTH = 12
export const DEFAULT_PLATFORM_COLOR = '#f8fafc'
export const DEFAULT_PLATFORM_TEXT_COLOR = '#475569'

export interface CreatePlatformOptions {
  start: { x: number; y: number }
  end: { x: number; y: number }
  layerId: string
  width?: number
  label?: string
  color?: string
  textColor?: string
}

export function createPlatform(options: CreatePlatformOptions): PlatformElement {
  return {
    id: uuidv4(),
    type: 'platform',
    layerId: options.layerId,
    visible: true,
    locked: false,
    start: { ...options.start },
    end: { ...options.end },
    width: options.width ?? DEFAULT_PLATFORM_WIDTH,
    label: options.label,
    color: options.color ?? DEFAULT_PLATFORM_COLOR,
    textColor: options.textColor ?? DEFAULT_PLATFORM_TEXT_COLOR,
  }
}
