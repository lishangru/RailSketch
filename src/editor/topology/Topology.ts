import type { DiagramElement, NodeVertexLink, Point, RailDocument, RailwayNode, TrackElement } from '../../types'
import { v4 as uuidv4 } from 'uuid'
import { isDirectionMarker, isStation, isTrack } from '../model/Document'
import { createRailwayNode } from '../model/RailwayNode'
import { pointSegmentDistance } from '../geometry/Segment'
import { segmentIntersection } from '../geometry/Segment'
import { pointPolylineDistance } from '../geometry/Polyline'
import { distance } from '../geometry/Point'

export interface TrackSplitResult {
  node: RailwayNode
  trackA: TrackElement
  trackB: TrackElement
  /** P 落在原 polyline 中的段索引。 */
  segmentIndex: number
}

export function getNode(doc: RailDocument, id: string | undefined): RailwayNode | undefined {
  if (!id) return undefined
  return doc.nodes.find((n) => n.id === id)
}

export function nodeIndex(doc: RailDocument, id: string): number {
  return doc.nodes.findIndex((n) => n.id === id)
}

export function getConnectedTracks(doc: RailDocument, nodeId: string): TrackElement[] {
  const node = getNode(doc, nodeId)
  if (!node) return []
  return node.connectedTrackIds
    .map((id) => doc.elements.find((e) => isTrack(e) && e.id === id))
    .filter((e): e is TrackElement => Boolean(e))
}

export function getNeighborNodes(doc: RailDocument, nodeId: string): RailwayNode[] {
  const tracks = getConnectedTracks(doc, nodeId)
  const ids = new Set<string>()
  for (const t of tracks) {
    if (t.startNodeId && t.startNodeId !== nodeId) ids.add(t.startNodeId)
    if (t.endNodeId && t.endNodeId !== nodeId) ids.add(t.endNodeId)
  }
  const trackIds = new Set(tracks.map((t) => t.id))
  for (const n of doc.nodes) {
    if (n.id !== nodeId && n.vertexLinks.some((l) => trackIds.has(l.trackId))) ids.add(n.id)
  }
  return doc.nodes.filter((n) => ids.has(n.id))
}

export function isConnected(doc: RailDocument, nodeA: string, nodeB: string): boolean {
  const seen = new Set<string>([nodeA])
  const queue = [nodeA]
  while (queue.length) {
    const id = queue.shift()!
    for (const next of getNeighborNodes(doc, id).map((n) => n.id)) {
      if (next === nodeB) return true
      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }
  return false
}

export function findNodeNear(doc: RailDocument, p: Point, radius: number, excludeId?: string): RailwayNode | undefined {
  let best: RailwayNode | undefined
  let bestD = radius
  for (const n of doc.nodes) {
    if (n.id === excludeId) continue
    const d = distance(p, n)
    if (d <= bestD) {
      bestD = d
      best = n
    }
  }
  return best
}

export function trackEndpointNodeIds(track: TrackElement): { startNodeId?: string; endNodeId?: string } {
  return { startNodeId: track.startNodeId, endNodeId: track.endNodeId }
}

/**
 * 维护 node.connectedTrackIds 与 track 端点引用、vertexLinks 的双向一致。
 * vertexLinks 只在目标轨道存在且下标合法时生效；引用失效时清理。
 */
export function rebuildNodeConnectivity(doc: RailDocument): void {
  for (const node of doc.nodes) {
    node.vertexLinks = (node.vertexLinks ?? []).filter((l) => {
      const t = doc.elements.find((e): e is TrackElement => isTrack(e) && e.id === l.trackId)
      return !!t && Number.isInteger(l.vertexIndex) && l.vertexIndex >= 0 && l.vertexIndex < t.points.length
    })
    node.connectedTrackIds = []
  }
  for (const el of doc.elements) {
    if (!isTrack(el)) continue
    for (const id of [el.startNodeId, el.endNodeId]) {
      if (!id) continue
      const node = getNode(doc, id)
      if (node && !node.connectedTrackIds.includes(el.id)) node.connectedTrackIds.push(el.id)
    }
  }
  for (const node of doc.nodes) {
    for (const l of node.vertexLinks) {
      if (!node.connectedTrackIds.includes(l.trackId)) node.connectedTrackIds.push(l.trackId)
    }
  }
  // 清理没有轨道连接的孤立节点。
  doc.nodes = doc.nodes.filter((n) => n.connectedTrackIds.length > 0)
}

/** 创建或复用轨道端点节点，并把端点坐标吸附到节点坐标。 */
export function ensureTrackEndpoints(doc: RailDocument, track: TrackElement): { startNode: RailwayNode; endNode: RailwayNode } {
  const p0 = track.points[0]
  const p1 = track.points[track.points.length - 1]
  let start = track.startNodeId ? getNode(doc, track.startNodeId) : undefined
  if (!start) {
    start = createRailwayNode(p0, 'endpoint', [track.id])
    doc.nodes.push(start)
    track.startNodeId = start.id
  }
  let end = track.endNodeId ? getNode(doc, track.endNodeId) : undefined
  if (!end) {
    end = createRailwayNode(p1, 'endpoint', [track.id])
    doc.nodes.push(end)
    track.endNodeId = end.id
  }
  // 坐标与几何保持一致。
  track.points[0] = { x: start.x, y: start.y }
  track.points[track.points.length - 1] = { x: end.x, y: end.y }
  for (const n of [start, end]) {
    n.x = n === start ? track.points[0].x : track.points[track.points.length - 1].x
    n.y = n === start ? track.points[0].y : track.points[track.points.length - 1].y
    if (!n.connectedTrackIds.includes(track.id)) n.connectedTrackIds.push(track.id)
  }
  return { startNode: start, endNode: end }
}

/**
 * 通用底层能力：在轨道上的点 P 处拆分 Track。
 * 若 P 在内部折点上，则使用该折点；若在段中间，则插入新控制点。
 * 同时创建 / 复用 topology node。
 */
export function splitTrackAtPoint(doc: RailDocument, trackId: string, p: Point, nodeType: RailwayNode['nodeType'] = 'junction', nodeId?: string): TrackSplitResult {
  const track = doc.elements.find((e): e is TrackElement => isTrack(e) && e.id === trackId)
  if (!track) throw new Error(`Track not found: ${trackId}`)
  const pts = track.points
  if (pts.length < 2) throw new Error('Track has fewer than 2 points')

  // 找到最近段及插值点。
  let bestIndex = 0
  let bestPoint = { ...p }
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
    const d = distance(p, proj)
    if (d < bestD) {
      bestD = d
      bestIndex = i
      bestT = t
      bestPoint = proj
    }
  }

  // 如果点击的就是已有端点，不重复拆。
  if (bestIndex === 0 && bestT < 1e-6) {
    const existing = track.startNodeId ? getNode(doc, track.startNodeId) : undefined
    const node = existing ?? createRailwayNode(pts[0], 'junction', [track.id])
    if (!existing) {
      doc.nodes.push(node)
      track.startNodeId = node.id
    }
    return { node, trackA: track, trackB: track, segmentIndex: 0 }
  }
  if (bestIndex === pts.length - 2 && bestT > 1 - 1e-6) {
    const existing = track.endNodeId ? getNode(doc, track.endNodeId) : undefined
    const node = existing ?? createRailwayNode(pts[pts.length - 1], 'junction', [track.id])
    if (!existing) {
      doc.nodes.push(node)
      track.endNodeId = node.id
    }
    return { node, trackA: track, trackB: track, segmentIndex: bestIndex }
  }

  const vertexIndex = bestT < 1e-6 ? bestIndex : bestT > 1 - 1e-6 ? bestIndex + 1 : -1
  const leftPoints = vertexIndex >= 0 ? pts.slice(0, vertexIndex + 1) : [...pts.slice(0, bestIndex + 1), { ...bestPoint }]
  const rightPoints = vertexIndex >= 0 ? pts.slice(vertexIndex) : [{ ...bestPoint }, ...pts.slice(bestIndex + 1)]

  const existing = getNode(doc, nodeId) ?? doc.nodes.find((n) => n.vertexLinks.some((l) => l.trackId === track.id && l.vertexIndex === vertexIndex))
  const node = existing ?? createRailwayNode(bestPoint, nodeType)
  if (!existing) {
    if (nodeId) node.id = nodeId
    doc.nodes.push(node)
  }
  leftPoints[leftPoints.length - 1] = { x: node.x, y: node.y }
  rightPoints[0] = { x: node.x, y: node.y }

  const trackA: TrackElement = {
    ...JSON.parse(JSON.stringify(track)),
    id: uuidv4(),
    points: leftPoints,
    startNodeId: track.startNodeId,
    endNodeId: node.id,
  }
  const trackB: TrackElement = {
    ...JSON.parse(JSON.stringify(track)),
    id: uuidv4(),
    points: rightPoints,
    startNodeId: node.id,
    endNodeId: track.endNodeId,
  }

  for (const n of doc.nodes) {
    n.vertexLinks = n.vertexLinks.flatMap((l) => {
      if (l.trackId !== track.id) return [l]
      const links: NodeVertexLink[] = []
      if (l.vertexIndex <= (vertexIndex >= 0 ? vertexIndex : bestIndex)) links.push({ trackId: trackA.id, vertexIndex: l.vertexIndex })
      if (l.vertexIndex >= (vertexIndex >= 0 ? vertexIndex : bestIndex + 1)) links.push({ trackId: trackB.id, vertexIndex: l.vertexIndex - (vertexIndex >= 0 ? vertexIndex : bestIndex) })
      return links
    })
  }
  remapTrackReferences(doc, track, [trackA, trackB])
  const idx = doc.elements.findIndex((e) => e.id === trackId)
  doc.elements.splice(idx, 1, trackA, trackB)
  node.connectedTrackIds = [trackA.id, trackB.id]
  rebuildNodeConnectivity(doc)
  return { node, trackA, trackB, segmentIndex: bestIndex }
}

/** Delete dependent markers / owned labels, and clear references to explicitly deleted labels. */
export function removeElementsWithReferences(doc: RailDocument, ids: string[]): void {
  const removed = new Set(ids)
  const tracks = doc.elements.filter(isTrack)
  for (const track of tracks) {
    if (!removed.has(track.id) || !track.labelId) continue
    if (!tracks.some((t) => !removed.has(t.id) && t.labelId === track.labelId)) removed.add(track.labelId)
  }
  doc.elements = doc.elements.filter((el) => !removed.has(el.id) && !(isDirectionMarker(el) && removed.has(el.trackId)))
  for (const track of doc.elements.filter(isTrack)) {
    if (track.labelId && removed.has(track.labelId)) {
      delete track.labelId
      delete track.labelText
    }
  }
  doc.crossings = doc.crossings.filter((c) => !removed.has(c.trackAId) && !removed.has(c.trackBId))
  // 车站关联的线路被删除后，剔除悬空引用（线路被拆分重映射的情况由 remapTrackReferences 处理）。
  for (const el of doc.elements) {
    if (!isStation(el) || !el.trackIds.length) continue
    const seen = new Set<string>()
    el.trackIds = el.trackIds.filter((id) => {
      if (removed.has(id) || seen.has(id)) return false
      seen.add(id)
      return true
    })
    // 只剩一条关联时不再视为换乘站。
    if (el.trackIds.length < 2 && el.kind === 'transfer') {
      el.kind = 'station'
      el.innerRadius = 0
    }
  }
  rebuildNodeConnectivity(doc)
}

/** Remap references when a track is replaced, including station line links. */
export function remapTrackReferences(doc: RailDocument, original: TrackElement, pieces: TrackElement[]): void {
  // 拆分线路后，站点的关联应指向离它最近的那一段；线路整体消失时去掉关联，避免悬空 id。
  for (const el of doc.elements) {
    if (!isStation(el) || !el.trackIds.includes(original.id)) continue
    let kept: TrackElement | undefined
    let best = Number.POSITIVE_INFINITY
    for (const piece of pieces) {
      const d = pointPolylineDistance({ x: el.x, y: el.y }, piece.points)
      if (d < best) {
        best = d
        kept = piece
      }
    }
    const seen = new Set<string>()
    el.trackIds = el.trackIds.flatMap((id) => (id === original.id ? (kept ? [kept.id] : []) : [id])).filter((id) => {
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
  }
  const at = (a: Point, b: Point) => distance(a, b) < 1e-6
  /** End markers stay on surviving original endpoints. */
  doc.elements = doc.elements.filter((el) => {
    if (!isDirectionMarker(el) || el.trackId !== original.id) return true
    const p = el.endpoint === 'start' ? original.points[0] : original.points[original.points.length - 1]
    const piece = pieces.find((t) => at(el.endpoint === 'start' ? t.points[0] : t.points[t.points.length - 1], p))
    if (!piece) return false
    el.trackId = piece.id
    return true
  })
  doc.crossings = doc.crossings.filter((c) => {
    if (c.trackAId !== original.id && c.trackBId !== original.id) return true
    const piece = pieces.find((t) => pointPolylineDistance(c.point, t.points) < 1e-6)
    if (!piece) return false
    if (c.trackAId === original.id) c.trackAId = piece.id
    if (c.trackBId === original.id) c.trackBId = piece.id
    return true
  })
  // An independent label remains owned by one piece, never by multiple new tracks.
  for (let i = 1; i < pieces.length; i++) {
    delete pieces[i].labelId
    delete pieces[i].labelText
  }
  if (!pieces.length && original.labelId && !doc.elements.some((e) => isTrack(e) && e.id !== original.id && e.labelId === original.labelId)) {
    doc.elements = doc.elements.filter((e) => e.id !== original.labelId)
  }
}

/** 合并 sourceNode 到 targetNode。 */
export function mergeNodes(doc: RailDocument, sourceNodeId: string, targetNodeId: string): void {
  const source = getNode(doc, sourceNodeId)
  const target = getNode(doc, targetNodeId)
  if (!source || !target || source.id === target.id) return
  for (const link of source.vertexLinks) {
    if (!target.vertexLinks.some((l) => l.trackId === link.trackId && l.vertexIndex === link.vertexIndex)) target.vertexLinks.push({ ...link })
  }
  for (const el of doc.elements) {
    if (!isTrack(el)) continue
    if (el.startNodeId === source.id) {
      el.startNodeId = target.id
      el.points[0] = { x: target.x, y: target.y }
    }
    if (el.endNodeId === source.id) {
      el.endNodeId = target.id
      el.points[el.points.length - 1] = { x: target.x, y: target.y }
    }
  }
  doc.nodes.splice(nodeIndex(doc, source.id), 1)
  moveNodeTo(doc, target.id, target)
  rebuildNodeConnectivity(doc)
}

/** 移动节点，并同步所有直连 Track 的端点坐标与 vertexLinks 指向的内部顶点。 */
export function moveNodeTo(doc: RailDocument, nodeId: string, p: Point): void {
  const node = getNode(doc, nodeId)
  if (!node) return
  node.x = p.x
  node.y = p.y
  for (const el of doc.elements) {
    if (!isTrack(el)) continue
    if (el.startNodeId === node.id) el.points[0] = { x: p.x, y: p.y }
    if (el.endNodeId === node.id) el.points[el.points.length - 1] = { x: p.x, y: p.y }
    for (const l of node.vertexLinks) {
      if (l.trackId === el.id && l.vertexIndex >= 0 && l.vertexIndex < el.points.length) el.points[l.vertexIndex] = { x: p.x, y: p.y }
    }
  }
}

/**
 * 拆分节点：keepTrackIds 留在原节点，其余轨道转移到新节点。
 * 两个节点初始坐标相同。
 */
export function splitNode(doc: RailDocument, nodeId: string, keepTrackIds: string[]): RailwayNode | undefined {
  const source = getNode(doc, nodeId)
  if (!source) return undefined
  const movedIds = source.connectedTrackIds.filter((id) => !keepTrackIds.includes(id))
  if (movedIds.length === 0) return undefined
  const newNode = createRailwayNode({ x: source.x, y: source.y }, source.nodeType, movedIds)
  doc.nodes.push(newNode)
  for (const el of doc.elements) {
    if (!isTrack(el)) continue
    if (el.startNodeId === source.id && movedIds.includes(el.id)) el.startNodeId = newNode.id
    if (el.endNodeId === source.id && movedIds.includes(el.id)) el.endNodeId = newNode.id
  }
  newNode.vertexLinks = source.vertexLinks.filter((l) => movedIds.includes(l.trackId))
  source.vertexLinks = source.vertexLinks.filter((l) => !movedIds.includes(l.trackId))
  rebuildNodeConnectivity(doc)
  return newNode
}

/** 反转线路：几何与拓扑端点互换，同时修正节点 vertexLinks 的顶点下标。 */
export function reverseTrack(doc: RailDocument, track: TrackElement): void {
  const n = track.points.length
  track.points.reverse()
  const s = track.startNodeId
  track.startNodeId = track.endNodeId
  track.endNodeId = s
  for (const el of doc.elements) {
    if (isDirectionMarker(el) && el.trackId === track.id) el.endpoint = el.endpoint === 'start' ? 'end' : 'start'
  }
  for (const node of doc.nodes) {
    for (const l of node.vertexLinks) {
      if (l.trackId === track.id) l.vertexIndex = n - 1 - l.vertexIndex
    }
  }
}

// ─────────── 橡皮擦切割 ───────────

interface CutInfo {
  /** 切点所在段下标（规范化后 t ∈ [0,1)）。 */
  index: number
  t: number
  point: Point
  /** 沿折线的弧长参数。 */
  param: number
}

/** 点投影到折线最近段，返回规范化切点信息。 */
function projectOnPolyline(pts: Point[], p: Point): CutInfo {
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
  // 规范化：t≈1 归入下一顶点。
  if (bestT > 1 - 1e-9 && bestIndex < pts.length - 2) {
    bestT = 0
    bestIndex += 1
  }
  const a = pts[Math.min(bestIndex, pts.length - 2)]
  const b = pts[Math.min(bestIndex, pts.length - 2) + 1]
  const point = {
    x: a.x + (b.x - a.x) * bestT,
    y: a.y + (b.y - a.y) * bestT,
  }
  let param = 0
  for (let i = 0; i < bestIndex; i++) param += distance(pts[i], pts[i + 1])
  param += distance(pts[Math.min(bestIndex, pts.length - 2)], point)
  return { index: Math.min(bestIndex, pts.length - 2), t: bestT, point, param }
}

export interface PolylineCutResult {
  /** 起点 → 第一个切点（可能为 null：该段为空）。 */
  a: Point[] | null
  /** 最后一个切点 → 终点（可能为 null：该段为空）。 */
  b: Point[] | null
}

/**
 * 按切点分割折线：删除第一个与最后一个切点之间的部分。
 * 单切点（位于中间）只断开不删除；切点在端点 / 无有效切点时返回 null（不切割）。
 * 两端都被删除时返回 { a: null, b: null }（整条删除）。
 */
export function splitPolylineAtCuts(pts: Point[], cuts: Point[]): PolylineCutResult | null {
  if (pts.length < 2 || cuts.length === 0) return null
  const infos = cuts.map((c) => projectOnPolyline(pts, c)).sort((x, y) => x.param - y.param)
  const uniq: CutInfo[] = []
  for (const c of infos) {
    if (!uniq.some((u) => Math.hypot(u.point.x - c.point.x, u.point.y - c.point.y) < 1e-6)) uniq.push(c)
  }
  if (uniq.length === 0) return null
  const first = uniq[0]
  const last = uniq[uniq.length - 1]
  let totalParam = 0
  for (let i = 0; i < pts.length - 1; i++) totalParam += distance(pts[i], pts[i + 1])
  if (uniq.length === 1 && (first.param < 1e-6 || first.param > totalParam - 1e-6)) return null

  const a: Point[] = []
  for (let i = 0; i <= first.index; i++) a.push({ ...pts[i] })
  a.push({ ...first.point })
  const b: Point[] = []
  b.push({ ...last.point })
  for (let i = last.index + 1; i < pts.length; i++) b.push({ ...pts[i] })

  const dedupe = (arr: Point[]): Point[] => {
    const out: Point[] = []
    for (const p of arr) {
      const lastPt = out[out.length - 1]
      if (!lastPt || Math.hypot(lastPt.x - p.x, lastPt.y - p.y) > 1e-6) out.push(p)
    }
    return out
  }
  const da = dedupe(a)
  const db = dedupe(b)
  return { a: da.length >= 2 ? da : null, b: db.length >= 2 ? db : null }
}

export interface TrackCutResult {
  pieces: TrackElement[]
  createdNodes: RailwayNode[]
}

export interface SegmentSpan {
  /** 被擦除的段区间（折点下标范围，含端点折点）。 */
  from: number
  to: number
}

/**
 * 计算橡皮擦笔画穿过的段区间：
 * 1. 笔画线段与折线段的真实交点；
 * 2. 笔画上所有贴近折线的点（沿线路拖动时覆盖整段扫过的范围，而不是只擦一小段）。
 * 返回 null 表示未命中。切割边界取折点（不是交点投影），保证端点干净。
 */
export function computeSegmentSpan(pts: Point[], stroke: Point[], tolerance = 8): SegmentSpan | null {
  if (pts.length < 2 || stroke.length < 2) return null
  const positions: { seg: number; param: number }[] = []
  for (let i = 0; i < stroke.length - 1; i++) {
    for (let j = 0; j < pts.length - 1; j++) {
      const r = segmentIntersection(stroke[i], stroke[i + 1], pts[j], pts[j + 1])
      if (r.intersects && r.point) {
        const info = projectOnPolyline(pts, r.point)
        positions.push({ seg: info.index, param: info.param })
      }
    }
  }
  for (const sp of stroke) {
    if (pointPolylineDistance(sp, pts) <= tolerance) {
      const info = projectOnPolyline(pts, sp)
      positions.push({ seg: info.index, param: info.param })
    }
  }
  if (positions.length === 0) return null
  positions.sort((a, b) => a.param - b.param)
  return { from: positions[0].seg, to: positions[positions.length - 1].seg }
}

/**
 * 按段区间切割折线：先切断（边界折点保留），再删除中间的段。
 * 删除段 from..to（不含边界折点本身），两边保留为独立折线。
 * 返回 { a, b }，某段不足两个折点时为 null。
 */
export function cutPolylineBySegmentSpan(pts: Point[], span: SegmentSpan): { a: Point[] | null; b: Point[] | null } {
  const s0 = Math.max(0, Math.min(span.from, pts.length - 2))
  const s1 = Math.max(s0, Math.min(span.to, pts.length - 2))
  // A = P0..P_{s0}（保留边界折点 P_{s0}），B = P_{s1+1}..（保留边界折点 P_{s1+1}）
  const a = pts.slice(0, s0 + 1)
  const b = pts.slice(s1 + 1)
  return {
    a: a.length >= 2 ? a.map((p) => ({ ...p })) : null,
    b: b.length >= 2 ? b.map((p) => ({ ...p })) : null,
  }
}

/**
 * 橡皮擦切割轨道（先切断再删除中间段）：删除段 from..to（边界折点保留）。
 * 保留部分的 vertexLinks 重映射到新轨道，删除区间的链接清理；边界折点处复用 / 新建节点。
 */
export function cutTrackBySegmentSpan(doc: RailDocument, track: TrackElement, span: SegmentSpan): TrackCutResult {
  const result = cutPolylineBySegmentSpan(track.points, span)
  const createdNodes: RailwayNode[] = []
  if (!result.a && !result.b) {
    for (const n of doc.nodes) n.vertexLinks = n.vertexLinks.filter((l) => l.trackId !== track.id)
    remapTrackReferences(doc, track, [])
    return { pieces: [], createdNodes: [] }
  }
  const idA = result.a ? uuidv4() : null
  const idB = result.b ? uuidv4() : null
  const s0 = Math.max(0, Math.min(span.from, track.points.length - 2))
  const s1 = Math.max(s0, Math.min(span.to, track.points.length - 2))
  // vertexLinks 重映射：下标 ≤ s0 归 A（下标不变）；≥ s1+1 归 B（下标 - (s1+1)）；中间的删除。
  const shift = s1 + 1
  for (const node of doc.nodes) {
    const links = node.vertexLinks.filter((l) => l.trackId === track.id)
    if (links.length === 0) continue
    const remaining: NodeVertexLink[] = []
    for (const l of links) {
      if (l.vertexIndex <= s0 && idA) remaining.push({ trackId: idA, vertexIndex: l.vertexIndex })
      else if (l.vertexIndex >= s1 + 1 && idB) remaining.push({ trackId: idB, vertexIndex: l.vertexIndex - shift })
    }
    node.vertexLinks = [...node.vertexLinks.filter((l) => l.trackId !== track.id), ...remaining]
  }
  const nodeAt = (p: Point, pieceId: string, index: number): RailwayNode => {
    const existing = doc.nodes.find((n) => n.vertexLinks.some((l) => l.trackId === pieceId && l.vertexIndex === index))
    if (existing) return existing
    const node = createRailwayNode(p, 'endpoint')
    doc.nodes.push(node)
    createdNodes.push(node)
    return node
  }
  const pieces: TrackElement[] = []
  if (result.a && idA) {
    const endP = result.a[result.a.length - 1]
    pieces.push({
      ...JSON.parse(JSON.stringify(track)),
      id: idA,
      points: result.a,
      startNodeId: track.startNodeId,
      endNodeId: nodeAt(endP, idA, result.a.length - 1).id,
    })
  }
  if (result.b && idB) {
    const startP = result.b[0]
    pieces.push({
      ...JSON.parse(JSON.stringify(track)),
      id: idB,
      points: result.b,
      startNodeId: nodeAt(startP, idB, 0).id,
      endNodeId: track.endNodeId,
    })
  }
  remapTrackReferences(doc, track, pieces)
  return { pieces, createdNodes }
}

/**
 * 橡皮擦切割轨道：按切点断开 / 删除中间部分。
 * 生成的每段为独立 Track，端点绑定节点（切点处新建 / 复用 endpoint 节点）。
 */
export function cutTrackAtPoints(doc: RailDocument, track: TrackElement, cuts: Point[]): TrackCutResult {
  const result = splitPolylineAtCuts(track.points, cuts)
  const createdNodes: RailwayNode[] = []
  if (!result) return { pieces: [track], createdNodes: [] }
  const { a, b } = result
  const infos = cuts.map((c) => projectOnPolyline(track.points, c)).sort((x, y) => x.param - y.param)
  const first = infos[0]
  const last = infos[infos.length - 1]
  const nodeAt = (info: CutInfo): RailwayNode => {
    const vertexIndex = info.t < 1e-6 ? info.index : info.t > 1 - 1e-6 ? info.index + 1 : -1
    const existing = doc.nodes.find((n) => n.vertexLinks.some((l) => l.trackId === track.id && l.vertexIndex === vertexIndex))
      ?? createdNodes.find((n) => distance(n, info.point) < 1e-6)
    if (existing) return existing
    const node = createRailwayNode(info.point, 'endpoint')
    doc.nodes.push(node)
    createdNodes.push(node)
    return node
  }
  const pieces: TrackElement[] = []
  if (a) {
    pieces.push({
      ...JSON.parse(JSON.stringify(track)),
      id: uuidv4(),
      points: a,
      startNodeId: track.startNodeId,
      endNodeId: nodeAt(first).id,
    })
  }
  if (b) {
    pieces.push({
      ...JSON.parse(JSON.stringify(track)),
      id: uuidv4(),
      points: b,
      startNodeId: nodeAt(last).id,
      endNodeId: track.endNodeId,
    })
  }
  let param = 0
  const params = track.points.map((p, i) => {
    if (i > 0) param += distance(track.points[i - 1], p)
    return param
  })
  for (const node of doc.nodes) {
    node.vertexLinks = node.vertexLinks.flatMap((l) => {
      if (l.trackId !== track.id) return [l]
      const links: NodeVertexLink[] = []
      for (const piece of pieces) {
        const isA = piece.points === a
        if (isA ? params[l.vertexIndex] > first.param + 1e-6 : params[l.vertexIndex] < last.param - 1e-6) continue
        const index = piece.points.findIndex((p) => distance(p, track.points[l.vertexIndex]) < 1e-6)
        if (index >= 0) links.push({ trackId: piece.id, vertexIndex: index })
      }
      return links
    })
  }
  remapTrackReferences(doc, track, pieces)
  return { pieces, createdNodes }
}

export interface TopologyIssue {
  code: string
  message: string
}

/** 拓扑一致性检查。 */
export function validateTopology(doc: RailDocument): TopologyIssue[] {
  const issues: TopologyIssue[] = []
  const nodeIds = new Set(doc.nodes.map((n) => n.id))
  const trackIds = new Set(doc.elements.filter(isTrack).map((t) => t.id))
  for (const n of doc.nodes) {
    for (const id of n.connectedTrackIds) {
      if (!trackIds.has(id)) issues.push({ code: 'node-track-missing', message: `Node ${n.id} 引用了不存在的 Track ${id}` })
    }
    if (new Set(n.connectedTrackIds).size !== n.connectedTrackIds.length) issues.push({ code: 'node-track-duplicate', message: `Node ${n.id} 存在重复连接引用` })
    for (const l of n.vertexLinks ?? []) {
      const t = doc.elements.find((e): e is TrackElement => isTrack(e) && e.id === l.trackId)
      if (!t) issues.push({ code: 'node-link-missing', message: `Node ${n.id} 的 vertexLink 引用了不存在的 Track ${l.trackId}` })
      else if (!Number.isInteger(l.vertexIndex) || l.vertexIndex < 0 || l.vertexIndex >= t.points.length) {
        issues.push({ code: 'node-link-index', message: `Node ${n.id} 的 vertexLink 顶点下标越界（track ${l.trackId}）` })
      }
    }
  }
  for (const t of doc.elements.filter(isTrack)) {
    for (const nid of [t.startNodeId, t.endNodeId]) {
      if (nid && !nodeIds.has(nid)) issues.push({ code: 'track-node-missing', message: `Track ${t.id} 引用了不存在的 Node ${nid}` })
    }
    if (t.startNodeId) {
      const n = getNode(doc, t.startNodeId)
      if (n && !n.connectedTrackIds.includes(t.id)) issues.push({ code: 'node-track-mismatch', message: `Track ${t.id} 与 startNode 双向引用不一致` })
    }
    if (t.endNodeId) {
      const n = getNode(doc, t.endNodeId)
      if (n && !n.connectedTrackIds.includes(t.id)) issues.push({ code: 'node-track-mismatch', message: `Track ${t.id} 与 endNode 双向引用不一致` })
    }
    if (t.startNodeId) {
      const n = getNode(doc, t.startNodeId)
      if (n && (Math.abs(n.x - t.points[0].x) > 0.01 || Math.abs(n.y - t.points[0].y) > 0.01)) {
        issues.push({ code: 'endpoint-position', message: `Track ${t.id} 起点与节点坐标不一致` })
      }
    }
    if (t.endNodeId) {
      const n = getNode(doc, t.endNodeId)
      const last = t.points[t.points.length - 1]
      if (n && (Math.abs(n.x - last.x) > 0.01 || Math.abs(n.y - last.y) > 0.01)) {
        issues.push({ code: 'endpoint-position', message: `Track ${t.id} 终点与节点坐标不一致` })
      }
    }
  }
  return issues
}

/** 让所有 Track 端点坐标与绑定 Node 对齐。 */
export function synchronizeNodeCoordinates(doc: RailDocument): void {
  for (const el of doc.elements) {
    if (!isTrack(el)) continue
    if (el.startNodeId) {
      const n = getNode(doc, el.startNodeId)
      if (n) el.points[0] = { x: n.x, y: n.y }
    }
    if (el.endNodeId) {
      const n = getNode(doc, el.endNodeId)
      if (n) el.points[el.points.length - 1] = { x: n.x, y: n.y }
    }
  }
}

/** 开发模式下打印拓扑问题。 */
export function warnTopologyIssues(doc: RailDocument): void {
  if (!import.meta.env.DEV) return
  const issues = validateTopology(doc)
  if (issues.length) console.warn('[RailSketch topology]', issues)
}
