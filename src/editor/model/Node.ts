import { v4 as uuidv4 } from 'uuid'

/**
 * 独立节点对象（第一阶段作为模型预留）。
 * 当前轨道控制点直接存储在 TrackElement.points 中，Node 用于未来
 * 道岔 / 拓扑联接点扩展，不承载绘制职责。
 */
export interface RailNode {
  id: string
  x: number
  y: number
  name?: string
  kind: 'joint' | 'station' | 'terminal'
}

export function createNode(x: number, y: number, kind: RailNode['kind'] = 'joint', name?: string): RailNode {
  return { id: uuidv4(), x, y, kind, name }
}
