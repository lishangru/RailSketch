import { v4 as uuidv4 } from 'uuid'
import type { BaseElement } from '../../types'

export function createBase(type: string, layerId: string, overrides: Partial<BaseElement> = {}): BaseElement {
  return {
    id: uuidv4(),
    type,
    layerId,
    visible: true,
    locked: false,
    ...overrides,
  }
}
