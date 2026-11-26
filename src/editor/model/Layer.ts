import { v4 as uuidv4 } from 'uuid'
import type { Layer } from '../../types'

export function createLayer(name = '默认图层', overrides: Partial<Layer> = {}): Layer {
  return {
    id: uuidv4(),
    name,
    visible: true,
    locked: false,
    ...overrides,
  }
}
