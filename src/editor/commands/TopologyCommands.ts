import type { DiagramElement, NodeVertexLink, Point, RailDocument, RailwayNode, TrackElement } from '../../types'
import { v4 as uuidv4 } from 'uuid'
import type { Command } from './Command'
import type { Editor } from '../core/Editor'
import { isTrack } from '../model/Document'
import { createRailwayNode } from '../model/RailwayNode'
import { mergeNodes, moveNodeTo, rebuildNodeConnectivity, splitNode, splitTrackAtPoint, getNode, reverseTrack } from '../topology/Topology'
import { AddTrackCommand } from './AddTrackCommand'
import { DocumentChange } from './DocumentChange'
import { removeElementsWithReferences } from '../topology/Topology'
import { captureBoundNodes } from './MovePointCommand'

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

function trackSnapshot(doc: RailDocument, ids: string[]): TrackElement[] {
  return doc.elements.filter((e): e is TrackElement => isTrack(e) && ids.includes(e.id)).map(clone)
}

function replaceTrackSnapshots(doc: RailDocument, snapshots: TrackElement[]): void {
  const map = new Map(snapshots.map((t) => [t.id, t]))
  for (let i = 0; i < doc.elements.length; i++) {
    const el = doc.elements[i]
    if (isTrack(el) && map.has(el.id)) doc.elements[i] = clone(map.get(el.id)!)
  }
}

function removeElement(doc: RailDocument, id: string): void {
  const i = doc.elements.findIndex((e) => e.id === id)
  if (i >= 0) doc.elements.splice(i, 1)
}

/** 拆分轨道为两条拓扑边。 */
export class SplitTrackCommand implements Command {
  readonly label = '拆分轨道'
  private change?: DocumentChange

  constructor(
    private editor: Editor,
    private trackId: string,
    private point: Point,
    private nodeType: RailwayNode['nodeType'] = 'junction',
    private forceNodeId?: string,
  ) {}

  execute(): void {
    const doc = this.editor.document
    const track = doc.elements.find((e): e is TrackElement => isTrack(e) && e.id === this.trackId)
    if (!track) return
    if (this.change) this.change.redo(doc)
    else this.change = DocumentChange.capture(doc, () => { splitTrackAtPoint(doc, this.trackId, this.point, this.nodeType, this.forceNodeId) })
    this.editor.invalidate()
  }

  undo(): void {
    this.change?.undo(this.editor.document)
    this.editor.invalidate()
  }
}

/** 移动拓扑节点：所有直连 Track 端点同步跟随。 */
export class MoveNodeCommand implements Command {
  readonly label = '移动节点'
  private beforeNode: RailwayNode | null = null
  private beforeTracks: TrackElement[] = []
  constructor(
    private editor: Editor,
    private nodeId: string,
    private to: Point,
    beforeNode?: RailwayNode,
    beforeTracks?: TrackElement[],
  ) {
    if (beforeNode) this.beforeNode = clone(beforeNode)
    if (beforeTracks) this.beforeTracks = clone(beforeTracks)
  }

  execute(): void {
    const node = getNode(this.editor.document, this.nodeId)
    if (!node) return
    if (this.beforeNode == null) this.beforeNode = clone(node)
    if (this.beforeTracks.length === 0) this.beforeTracks = trackSnapshot(this.editor.document, node.connectedTrackIds)
    moveNodeTo(this.editor.document, this.nodeId, this.to)
    this.editor.invalidate()
  }

  undo(): void {
    if (!this.beforeNode) return
    const i = this.editor.document.nodes.findIndex((n) => n.id === this.nodeId)
    if (i >= 0) this.editor.document.nodes[i] = clone(this.beforeNode)
    replaceTrackSnapshots(this.editor.document, this.beforeTracks)
    this.editor.invalidate()
  }
}

/** 合并两个拓扑节点。 */
export class MergeNodesCommand implements Command {
  readonly label = '合并节点'
  private change?: DocumentChange
  constructor(
    private editor: Editor,
    private sourceNodeId: string,
    private targetNodeId: string,
  ) {}

  execute(): void {
    const doc = this.editor.document
    const source = getNode(doc, this.sourceNodeId)
    const target = getNode(doc, this.targetNodeId)
    if (!source || !target) return
    if (this.change) this.change.redo(doc)
    else this.change = DocumentChange.capture(doc, () => mergeNodes(doc, source.id, target.id))
    this.editor.invalidate()
  }

  undo(): void {
    this.change?.undo(this.editor.document)
    this.editor.invalidate()
  }
}

/** 拆分节点：一部分轨道迁往新的重合节点。 */
export class SplitNodeCommand implements Command {
  readonly label = '拆分节点'
  private change?: DocumentChange
  constructor(
    private editor: Editor,
    private nodeId: string,
    private keepTrackIds: string[],
  ) {}

  execute(): void {
    const doc = this.editor.document
    const node = getNode(doc, this.nodeId)
    if (!node) return
    if (this.change) this.change.redo(doc)
    else this.change = DocumentChange.capture(doc, () => { splitNode(doc, node.id, this.keepTrackIds) })
    this.editor.invalidate()
  }

  undo(): void {
    this.change?.undo(this.editor.document)
    this.editor.invalidate()
  }
}

/** 段平移：默认沿段法向，Alt 时自由二维。 */
export class MoveSegmentCommand implements Command {
  readonly label = '平移段'
  private change?: DocumentChange
  private before?: TrackElement
  private beforeNodes?: RailwayNode[]
  constructor(
    private editor: Editor,
    private trackId: string,
    private segmentIndex: number,
    private delta: Point,
    before?: TrackElement,
    beforeNodes?: RailwayNode[],
  ) {
    if (before) this.before = clone(before)
    if (beforeNodes) this.beforeNodes = clone(beforeNodes)
  }

  execute(): void {
    const doc = this.editor.document
    if (this.change) this.change.redo(doc)
    else {
      // A supplied snapshot is the pre-preview geometry, never add delta to the preview again.
      if (this.before) replaceTrackSnapshots(doc, [this.before])
      for (const n of this.beforeNodes ?? []) moveNodeTo(doc, n.id, n)
      const track = doc.elements.find((e): e is TrackElement => isTrack(e) && e.id === this.trackId)
      if (!track || track.points.length < 2) return
      this.change = DocumentChange.capture(doc, () => {
        const i = Math.max(0, Math.min(this.segmentIndex, track.points.length - 2))
        const targets = [i, i + 1].map((index) => ({ index, point: { x: track.points[index].x + this.delta.x, y: track.points[index].y + this.delta.y }, nodes: captureBoundNodes(doc, track, index) }))
        for (const target of targets) {
          track.points[target.index] = target.point
          for (const node of target.nodes) moveNodeTo(doc, node.id, target.point)
        }
      })
    }
    this.editor.invalidate()
  }

  undo(): void {
    this.change?.undo(this.editor.document)
    this.editor.invalidate()
  }
}

/**
 * 在既有轨道上插入一个顶点并创建拓扑节点（道岔不拆线）。
 * 若点击位置已命中既有顶点则复用该顶点。
 * extraLinks：新线路的内部顶点连接（节点同时挂在两条轨道上）。
 * 插入位置之后的既有 vertexLinks 下标会顺移，undo 时一并还原。
 */
export class InsertVertexCommand implements Command {
  readonly label = '插入道岔顶点'
  private before: TrackElement | null = null
  private beforeNodes: RailwayNode[] = []
  readonly nodeId: string

  constructor(
    private editor: Editor,
    private trackId: string,
    private point: Point,
    private nodeType: RailwayNode['nodeType'] = 'switch',
    nodeId?: string,
    private extraLinks: NodeVertexLink[] = [],
  ) {
    this.nodeId = nodeId ?? uuidv4()
  }

  execute(): void {
    const doc = this.editor.document
    const track = doc.elements.find((e): e is TrackElement => isTrack(e) && e.id === this.trackId)
    if (!track) return
    this.before = clone(track)
    const pointCount = track.points.length
    const { index, point } = this.insertPoint(track, this.point)
    const inserted = track.points.length > pointCount
    // 捕获本命令执行前所有关联该轨道的节点（顺移的 vertexLinks 需要还原）。
    this.beforeNodes = doc.nodes.filter((n) => n.vertexLinks.some((l) => l.trackId === track.id)).map(clone)
    // 插入点之后的既有链接下标顺移（新节点自身的连接稍后写入）。
    for (const n of doc.nodes) {
      for (const l of n.vertexLinks) {
        if (inserted && l.trackId === track.id && l.vertexIndex >= index) l.vertexIndex += 1
      }
    }
    const node = createRailwayNode(point, this.nodeType)
    node.id = this.nodeId
    node.vertexLinks = [{ trackId: track.id, vertexIndex: index }, ...this.extraLinks.map((l) => ({ ...l }))]
    doc.nodes.push(node)
    rebuildNodeConnectivity(doc)
    this.editor.invalidate()
  }

  undo(): void {
    const doc = this.editor.document
    if (!this.before) return
    replaceTrackSnapshots(doc, [this.before])
    for (const n of this.beforeNodes) {
      const i = doc.nodes.findIndex((x) => x.id === n.id)
      if (i >= 0) doc.nodes[i] = clone(n)
      else doc.nodes.push(clone(n))
    }
    const i = doc.nodes.findIndex((n) => n.id === this.nodeId)
    if (i >= 0) doc.nodes.splice(i, 1)
    rebuildNodeConnectivity(doc)
    this.editor.invalidate()
  }

  /** 命中既有顶点则复用，否则插入最近段的投影点。 */
  private insertPoint(track: TrackElement, p: Point): { index: number; point: Point } {
    const pts = track.points
    for (let i = 0; i < pts.length; i++) {
      if (Math.hypot(pts[i].x - p.x, pts[i].y - p.y) < 1e-6) return { index: i, point: { ...pts[i] } }
    }
    let bestIndex = 0
    let bestT = 0
    let bestD = Number.POSITIVE_INFINITY
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      const abx = b.x - a.x
      const aby = b.y - a.y
      const lenSq = abx * abx + aby * aby || 1
      let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq
      t = Math.max(0, Math.min(1, t))
      const proj = { x: a.x + abx * t, y: a.y + aby * t }
      const d = Math.hypot(proj.x - p.x, proj.y - p.y)
      if (d < bestD) {
        bestD = d
        bestIndex = i
        bestT = t
      }
    }
    const insertAt = bestIndex + 1
    const proj = { x: pts[bestIndex].x + (pts[bestIndex + 1].x - pts[bestIndex].x) * bestT, y: pts[bestIndex].y + (pts[bestIndex + 1].y - pts[bestIndex].y) * bestT }
    if (bestT < 1e-6) return { index: bestIndex, point: { ...pts[bestIndex] } }
    if (bestT > 1 - 1e-6) return { index: bestIndex + 1, point: { ...pts[bestIndex + 1] } }
    pts.splice(insertAt, 0, proj)
    return { index: insertAt, point: proj }
  }
}

/** 给既有节点追加一条不拆线的内部顶点连接（新线路中间顶点汇入既有节点）。 */
export class AddVertexLinkCommand implements Command {
  readonly label = '连接线路节点'
  private added = false
  private link: NodeVertexLink
  constructor(
    private editor: Editor,
    private nodeId: string,
    trackId: string,
    vertexIndex: number,
  ) {
    this.link = { trackId, vertexIndex }
  }

  execute(): void {
    const node = getNode(this.editor.document, this.nodeId)
    if (!node) return
    this.added = !node.vertexLinks.some((l) => l.trackId === this.link.trackId && l.vertexIndex === this.link.vertexIndex)
    if (this.added) node.vertexLinks.push({ ...this.link })
    rebuildNodeConnectivity(this.editor.document)
    this.editor.invalidate()
  }

  undo(): void {
    const node = getNode(this.editor.document, this.nodeId)
    if (!node) return
    if (!this.added) return
    node.vertexLinks = node.vertexLinks.filter((l) => !(l.trackId === this.link.trackId && l.vertexIndex === this.link.vertexIndex))
    rebuildNodeConnectivity(this.editor.document)
    this.editor.invalidate()
  }
}

/** 拖动轨道时，断开与共享节点的端点连接（节点被其他轨道占用，不能随轨道移动）。 */
export class DetachEndpointCommand implements Command {
  readonly label = '断开节点连接'
  private beforeTrack: TrackElement | null = null
  private beforeNode: RailwayNode | null = null

  constructor(
    private editor: Editor,
    private trackId: string,
    private endpoint: 'start' | 'end',
  ) {}

  execute(): void {
    const track = this.editor.document.elements.find((e): e is TrackElement => isTrack(e) && e.id === this.trackId)
    if (!track) return
    const nodeId = this.endpoint === 'start' ? track.startNodeId : track.endNodeId
    if (!nodeId) return
    const node = getNode(this.editor.document, nodeId)
    if (!node) return
    this.beforeTrack = clone(track)
    this.beforeNode = clone(node)
    if (this.endpoint === 'start') track.startNodeId = undefined
    else track.endNodeId = undefined
    rebuildNodeConnectivity(this.editor.document)
    this.editor.invalidate()
  }

  undo(): void {
    if (!this.beforeTrack) return
    replaceTrackSnapshots(this.editor.document, [this.beforeTrack])
    if (this.beforeNode) {
      const i = this.editor.document.nodes.findIndex((n) => n.id === this.beforeNode!.id)
      if (i >= 0) this.editor.document.nodes[i] = clone(this.beforeNode)
      else this.editor.document.nodes.push(clone(this.beforeNode))
    }
    rebuildNodeConnectivity(this.editor.document)
    this.editor.invalidate()
  }
}

/** 修改节点类型（如右键把节点设为道岔）。 */
export class SetNodeTypeCommand implements Command {
  label: string
  private beforeType: RailwayNode['nodeType'] | null = null

  constructor(
    private editor: Editor,
    private nodeId: string,
    private nodeType: RailwayNode['nodeType'],
  ) {
    this.label = nodeType === 'switch' ? '设为道岔' : '设为普通节点'
  }

  execute(): void {
    const node = getNode(this.editor.document, this.nodeId)
    if (!node) return
    if (this.beforeType == null) this.beforeType = node.nodeType
    node.nodeType = this.nodeType
    this.editor.invalidate()
  }

  undo(): void {
    const node = getNode(this.editor.document, this.nodeId)
    if (!node || this.beforeType == null) return
    node.nodeType = this.beforeType
    this.editor.invalidate()
  }
}

/** 交叉点右键设为道岔：两条线在交点处各插入顶点（不拆线），共用同一个 switch 节点。 */
export class CrossingToSwitchCommand implements Command {
  readonly label = '设为道岔'
  private change?: DocumentChange

  constructor(
    private editor: Editor,
    private trackAId: string,
    private trackBId: string,
    private point: Point,
  ) {}

  execute(): void {
    const doc = this.editor.document
    const a = doc.elements.find((e): e is TrackElement => isTrack(e) && e.id === this.trackAId)
    const b = doc.elements.find((e): e is TrackElement => isTrack(e) && e.id === this.trackBId)
    if (!a || !b) return
    if (this.change) this.change.redo(doc)
    else this.change = DocumentChange.capture(doc, () => {
      const idxA = this.insertOrFindVertex(a, this.point)
      const idxB = this.insertOrFindVertex(b, this.point)
      const bound = [...captureBoundNodes(doc, a, idxA), ...captureBoundNodes(doc, b, idxB)]
      const node = getNode(doc, bound[0]?.id) ?? createRailwayNode(this.point, 'switch')
      if (!getNode(doc, node.id)) doc.nodes.push(node)
      for (const other of bound) mergeNodes(doc, other.id, node.id)
      node.nodeType = 'switch'
      for (const link of [{ trackId: a.id, vertexIndex: idxA }, { trackId: b.id, vertexIndex: idxB }]) {
        if (!node.vertexLinks.some((l) => l.trackId === link.trackId && l.vertexIndex === link.vertexIndex)) node.vertexLinks.push(link)
      }
      doc.crossings = doc.crossings.filter((c) => !(((c.trackAId === a.id && c.trackBId === b.id) || (c.trackAId === b.id && c.trackBId === a.id)) && Math.hypot(c.point.x - this.point.x, c.point.y - this.point.y) < 1e-6))
      rebuildNodeConnectivity(doc)
    })
    this.editor.invalidate()
  }

  undo(): void {
    this.change?.undo(this.editor.document)
    this.editor.invalidate()
  }

  /** 在轨道上插入顶点（点已命中既有顶点则复用），返回顶点下标。 */
  private insertOrFindVertex(track: TrackElement, p: Point): number {
    const pts = track.points
    for (let i = 0; i < pts.length; i++) {
      if (Math.hypot(pts[i].x - p.x, pts[i].y - p.y) < 1e-6) return i
    }
    let bestI = 0
    let bestT = 0
    let bestD = Number.POSITIVE_INFINITY
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      const abx = b.x - a.x
      const aby = b.y - a.y
      const lenSq = abx * abx + aby * aby || 1
      let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq
      t = Math.max(0, Math.min(1, t))
      const proj = { x: a.x + abx * t, y: a.y + aby * t }
      const d = Math.hypot(proj.x - p.x, proj.y - p.y)
      if (d < bestD) {
        bestD = d
        bestI = i
        bestT = t
      }
    }
    const insertAt = bestI + 1
    const proj = {
      x: pts[bestI].x + (pts[bestI + 1].x - pts[bestI].x) * bestT,
      y: pts[bestI].y + (pts[bestI + 1].y - pts[bestI].y) * bestT,
    }
    if (bestT < 1e-6) return bestI
    if (bestT > 1 - 1e-6) return bestI + 1
    pts.splice(insertAt, 0, proj)
    for (const node of this.editor.document.nodes) for (const link of node.vertexLinks) {
      if (link.trackId === track.id && link.vertexIndex >= insertAt) link.vertexIndex += 1
    }
    return insertAt
  }
}

/** 平行轨道阵列：一次命令，一次撤销。 */
export class CreateParallelTracksCommand implements Command {
  readonly label = '生成平行轨道'
  private createdIds: string[] = []
  private createdNodeIds: string[] = []
  constructor(
    private editor: Editor,
    private tracks: TrackElement[],
    private nodes: RailwayNode[],
  ) {}

  execute(): void {
    for (const n of this.nodes) {
      this.editor.document.nodes.push(n)
      this.createdNodeIds.push(n.id)
    }
    for (const t of this.tracks) {
      this.editor.document.elements.push(t)
      this.createdIds.push(t.id)
    }
    rebuildNodeConnectivity(this.editor.document)
    this.editor.invalidate()
  }

  undo(): void {
    const doc = this.editor.document
    doc.elements = doc.elements.filter((e) => !this.createdIds.includes(e.id))
    doc.nodes = doc.nodes.filter((n) => !this.createdNodeIds.includes(n.id))
    rebuildNodeConnectivity(doc)
    this.editor.invalidate()
  }
}

/** 交叉转连接：精确分割两条 Track 并合并为同一个 junction node。 */
export class ConnectCrossingCommand implements Command {
  readonly label = '连接线路'
  private change?: DocumentChange
  constructor(
    private editor: Editor,
    private trackAId: string,
    private trackBId: string,
    private point: Point,
  ) {}

  execute(): void {
    const doc = this.editor.document
    const a = doc.elements.find((e): e is TrackElement => isTrack(e) && e.id === this.trackAId)
    const b = doc.elements.find((e): e is TrackElement => isTrack(e) && e.id === this.trackBId)
    if (!a || !b) return
    if (this.change) this.change.redo(doc)
    else this.change = DocumentChange.capture(doc, () => {
      doc.crossings = doc.crossings.filter((c) => !(((c.trackAId === a.id && c.trackBId === b.id) || (c.trackAId === b.id && c.trackBId === a.id)) && Math.hypot(c.point.x - this.point.x, c.point.y - this.point.y) < 1e-6))
      const splitA = splitTrackAtPoint(doc, a.id, this.point, 'junction')
      const splitB = splitTrackAtPoint(doc, b.id, this.point, 'junction')
      mergeNodes(doc, splitB.node.id, splitA.node.id)
      splitA.node.nodeType = 'junction'
      moveNodeTo(doc, splitA.node.id, this.point)
      rebuildNodeConnectivity(doc)
    })
    this.editor.invalidate()
  }

  undo(): void {
    this.change?.undo(this.editor.document)
    this.editor.invalidate()
  }
}

/** 简单四向连接转普通交叉。 */
export class DisconnectJunctionCommand implements Command {
  readonly label = '取消线路连接'
  private change?: DocumentChange
  constructor(
    private editor: Editor,
    private nodeId: string,
  ) {}

  execute(): void {
    const doc = this.editor.document
    const node = getNode(doc, this.nodeId)
    if (!node || node.connectedTrackIds.length !== 4) return
    const pairs = this.pairOpposite(doc, node)
    if (!pairs) return
    if (this.change) this.change.redo(doc)
    else this.change = DocumentChange.capture(doc, () => {
      for (const { a, b } of pairs) this.mergePair(doc, node.id, a, b)
      const idx = doc.nodes.findIndex((n) => n.id === this.nodeId)
      if (idx >= 0) doc.nodes.splice(idx, 1)
      rebuildNodeConnectivity(doc)
    })
    this.editor.invalidate()
  }

  private pairOpposite(doc: RailDocument, node: RailwayNode): { a: string; b: string }[] | null {
    const tracks = node.connectedTrackIds
      .map((id) => doc.elements.find((e): e is TrackElement => isTrack(e) && e.id === id))
      .filter((e): e is TrackElement => Boolean(e))
    if (tracks.length !== 4 || tracks.some((t) => (t.startNodeId === node.id) === (t.endNodeId === node.id))) return null
    const vec = (t: TrackElement): Point => {
      const other = t.startNodeId === node.id ? t.points[1] : t.points[t.points.length - 2]
      const len = Math.hypot(node.x - other.x, node.y - other.y) || 1
      return { x: (other.x - node.x) / len, y: (other.y - node.y) / len }
    }
    const first = tracks[0]
    const v0 = vec(first)
    let best: TrackElement | null = null
    let bestDot = Number.POSITIVE_INFINITY
    for (const t of tracks.slice(1)) {
      const v = vec(t)
      const dot = v0.x * v.x + v0.y * v.y
      if (dot < bestDot) {
        bestDot = dot
        best = t
      }
    }
    if (!best) return null
    const rest = tracks.filter((t) => t.id !== first.id && t.id !== best.id)
    return [
      { a: first.id, b: best.id },
      { a: rest[0].id, b: rest[1].id },
    ]
  }

  private mergePair(doc: RailDocument, nodeId: string, aId: string, bId: string): TrackElement | null {
    const a = doc.elements.find((e): e is TrackElement => isTrack(e) && e.id === aId)
    const b = doc.elements.find((e): e is TrackElement => isTrack(e) && e.id === bId)
    if (!a || !b) return null
    const reverseA = a.startNodeId === nodeId
    const reverseB = b.endNodeId === nodeId
    const pa = clone(a.points)
    const pb = clone(b.points)
    if (reverseA) pa.reverse()
    if (reverseB) pb.reverse()
    const merged: TrackElement = {
      ...clone(a),
      id: uuidv4(),
      points: [...pa, ...pb.slice(1)],
      startNodeId: reverseA ? a.endNodeId : a.startNodeId,
      endNodeId: reverseB ? b.startNodeId : b.endNodeId,
    }
    for (const node of doc.nodes) for (const link of node.vertexLinks) {
      if (link.trackId === a.id) {
        link.trackId = merged.id
        if (reverseA) link.vertexIndex = pa.length - 1 - link.vertexIndex
      } else if (link.trackId === b.id) {
        link.trackId = merged.id
        link.vertexIndex = pa.length - 1 + (reverseB ? pb.length - 1 - link.vertexIndex : link.vertexIndex)
      }
    }
    // Markers on the former junction cease to be endpoint annotations.
    doc.elements = doc.elements.filter((el) => {
      if (el.type !== 'direction-marker') return true
      if (el.trackId === a.id) {
        if (el.endpoint === (reverseA ? 'start' : 'end')) return false
        el.trackId = merged.id
        el.endpoint = 'start'
      } else if (el.trackId === b.id) {
        if (el.endpoint === (reverseB ? 'end' : 'start')) return false
        el.trackId = merged.id
        el.endpoint = 'end'
      }
      return true
    })
    for (const crossing of doc.crossings) {
      if (crossing.trackAId === a.id || crossing.trackAId === b.id) crossing.trackAId = merged.id
      if (crossing.trackBId === a.id || crossing.trackBId === b.id) crossing.trackBId = merged.id
    }
    doc.crossings = doc.crossings.filter((c) => c.trackAId !== c.trackBId)
    if (!merged.labelId && b.labelId) { merged.labelId = b.labelId; merged.labelText = b.labelText }
    removeElement(doc, aId)
    removeElement(doc, bId)
    doc.elements.push(merged)
    return merged
  }

  undo(): void {
    this.change?.undo(this.editor.document)
    this.editor.invalidate()
  }
}

/** 反转线路方向。 */
export class ReverseTrackCommand implements Command {
  readonly label = '反转线路方向'
  private change?: DocumentChange
  constructor(
    private editor: Editor,
    private trackId: string,
  ) {}

  execute(): void {
    const track = this.editor.document.elements.find((e): e is TrackElement => isTrack(e) && e.id === this.trackId)
    if (!track) return
    if (this.change) this.change.redo(this.editor.document)
    else this.change = DocumentChange.capture(this.editor.document, () => reverseTrack(this.editor.document, track))
    this.editor.invalidate()
  }

  undo(): void {
    this.change?.undo(this.editor.document)
    this.editor.invalidate()
  }
}

/** 删除拓扑节点及其所有直连轨道。 */
export class DeleteNodeCommand implements Command {
  readonly label = '删除节点'
  private change?: DocumentChange
  constructor(
    private editor: Editor,
    private nodeId: string,
  ) {}

  execute(): void {
    const doc = this.editor.document
    const node = getNode(doc, this.nodeId)
    if (!node) return
    if (this.change) this.change.redo(doc)
    else this.change = DocumentChange.capture(doc, () => removeElementsWithReferences(doc, node.connectedTrackIds))
    this.editor.invalidate()
  }

  undo(): void {
    this.change?.undo(this.editor.document)
    this.editor.invalidate()
  }
}
