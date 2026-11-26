import { v4 as uuidv4 } from 'uuid'
import type { Point, RailwayNode, RailwayNodeType } from '../../types'

export function createRailwayNode(
  p: Point,
  nodeType: RailwayNodeType = 'endpoint',
  connectedTrackIds: string[] = [],
  name?: string,
): RailwayNode {
  return {
    id: uuidv4(),
    x: p.x,
    y: p.y,
    nodeType,
    connectedTrackIds: connectedTrackIds.slice(),
    name,
    vertexLinks: [],
  }
}
