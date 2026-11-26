import type { DiagramElement, LineElement, Point, RailDocument, RailwayNode, TrackElement } from '../../types'
import { isLine, isTrack } from '../model/Document'
import { getNode } from '../topology/Topology'
import type { Command } from './Command'

export interface MovePointHost {
  getElement(id: string): DiagramElement | undefined
  invalidate(): void
  /** 移动与某顶点绑定的拓扑节点坐标（端点节点或 vertexLinks 节点）。 */
  moveBoundNode(nodeId: string, p: Point): void
  document: RailDocument
}

type PointedElement = TrackElement | LineElement

/** 捕获绑定某顶点的拓扑节点快照（端点节点 / vertexLinks 指向该下标的节点）。 */
export function captureBoundNodes(doc: RailDocument, el: PointedElement, index: number): RailwayNode[] {
  const ids = new Set<string>()
  if (isTrack(el)) {
    if (el.startNodeId && index === 0) ids.add(el.startNodeId)
    if (el.endNodeId && index === el.points.length - 1) ids.add(el.endNodeId)
  }
  for (const n of doc.nodes) {
    for (const l of n.vertexLinks) {
      if (l.trackId === el.id && l.vertexIndex === index) ids.add(n.id)
    }
  }
  return [...ids]
    .map((id) => {
      const node = getNode(doc, id)
      return node ? (JSON.parse(JSON.stringify(node)) as RailwayNode) : null
    })
    .filter((n): n is RailwayNode => Boolean(n))
}

/**
 * 移动控制点（轨道 / 线元素通用）。
 * 若该顶点绑定拓扑节点（轨道端点节点或 vertexLinks 道岔节点），
 * 节点坐标随动，undo 一并还原。
 */
export class MovePointCommand implements Command {
  readonly label = '移动控制点'

  private before: PointedElement | null = null
  private beforeNodes: RailwayNode[] = []
  private targetIndex: number
  private to: Point

  constructor(
    private host: MovePointHost,
    private elementId: string,
    pointIndex: number,
    to: Point,
    before?: PointedElement,
    beforeNodes?: RailwayNode[],
  ) {
    this.targetIndex = pointIndex
    this.to = { ...to }
    if (before) this.before = JSON.parse(JSON.stringify(before)) as PointedElement
    if (beforeNodes) this.beforeNodes = JSON.parse(JSON.stringify(beforeNodes)) as RailwayNode[]
  }

  execute(): void {
    const el = this.host.getElement(this.elementId)
    if (!el || (!isTrack(el) && !isLine(el))) return
    const index = Math.max(0, Math.min(this.targetIndex, el.points.length - 1))
    if (this.before == null) this.before = JSON.parse(JSON.stringify(el)) as PointedElement
    el.points[index] = { ...this.to }
    if (this.beforeNodes.length === 0) this.beforeNodes = captureBoundNodes(this.host.document, el, index)
    for (const n of this.beforeNodes) this.host.moveBoundNode(n.id, this.to)
    this.host.invalidate()
  }

  undo(): void {
    const el = this.host.getElement(this.elementId)
    if (!el || (!isTrack(el) && !isLine(el))) return
    const index = Math.max(0, Math.min(this.targetIndex, el.points.length - 1))
    if (this.before && el.points[index]) el.points[index] = { ...this.before.points[index] }
    for (const n of this.beforeNodes) this.host.moveBoundNode(n.id, { x: n.x, y: n.y })
    this.host.invalidate()
  }
}
