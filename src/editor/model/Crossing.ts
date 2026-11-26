import { v4 as uuidv4 } from 'uuid'
import type { Crossing, CrossingMode, Point } from '../../types'

export function createCrossing(trackAId: string, trackBId: string, point: Point, mode: CrossingMode = 'plain'): Crossing {
  return { id: uuidv4(), trackAId, trackBId, point: { ...point }, mode }
}
