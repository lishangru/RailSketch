import { v4 as uuidv4 } from 'uuid'
import type { LabelElement } from '../../types'

export const DEFAULT_LABEL_FONT_SIZE = 14

export interface CreateLabelOptions {
  x: number
  y: number
  text: string
  layerId: string
  fontSize?: number
  rotation?: number
}

export function createLabel(options: CreateLabelOptions): LabelElement {
  return {
    id: uuidv4(),
    type: 'label',
    layerId: options.layerId,
    visible: true,
    locked: false,
    text: options.text,
    x: options.x,
    y: options.y,
    rotation: options.rotation ?? 0,
    fontSize: options.fontSize ?? DEFAULT_LABEL_FONT_SIZE,
  }
}
