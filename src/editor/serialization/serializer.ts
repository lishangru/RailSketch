import type { DiagramElement, Point, RailDocument } from '../../types'
import {
  DEFAULT_CANVAS_HEIGHT,
  DEFAULT_CANVAS_WIDTH,
  DEFAULT_GRID_SIZE,
  DOCUMENT_VERSION,
  isTrack,
  migrateDocument,
} from '../model/Document'

// Shared with File.size checks: enforce the same UTF-8 limit before JSON.parse,
// including autosave/string callers that do not go through a FileReader.
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
export const MAX_DOCUMENT_ELEMENTS = 5000
export const MAX_DOCUMENT_POINTS = 20000
export const MAX_POLYLINE_POINTS = 10000
export const MAX_DOCUMENT_NODES = 10000
export const MAX_DOCUMENT_LINKS = 20000
export const MAX_DOCUMENT_LAYERS = 1000
export const MAX_DOCUMENT_CROSSINGS = 5000
export const MAX_COORDINATE = 1_000_000
export const MAX_TEXT_LENGTH = 16384
export const MAX_TOTAL_TEXT_LENGTH = 1_000_000
// CrossingRenderer tests every pair of track segments and searches the pair's
// crossing records at each intersection. Byte/count limits alone do not bound
// that work; both segment tests and per-intersection record scans are budgeted.
export const MAX_INTERSECTION_WORK = 2_000_000

export interface ParseResult {
  ok: boolean
  document?: RailDocument
  error?: string
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function fail(message: string): never {
  throw new Error(message)
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!isObject(value)) fail(`${path} 必须是对象`)
  return value
}

function array(value: unknown, path: string, max: number, optional = false): unknown[] {
  if (value === undefined && optional) return []
  if (!Array.isArray(value)) fail(`${path} 必须是数组`)
  if (value.length > max) fail(`${path} 数量超过上限 ${max}`)
  return value
}

function number(value: unknown, fallback: number, path: string, min: number, max: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(`${path} 必须是 ${min} 至 ${max} 之间的有限数值`)
  }
  return value
}

function string(value: unknown, fallback: string, path: string, max = MAX_TEXT_LENGTH): string {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || value.length > max) fail(`${path} 必须是长度不超过 ${max} 的字符串`)
  return value
}

function optionalString(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : string(value, '', path)
}

function reference(value: unknown, path: string): string | undefined {
  const id = string(value, '', path, 256)
  return id || undefined
}

function boolean(value: unknown, fallback: boolean, path: string): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') fail(`${path} 必须是布尔值`)
  return value
}

function choice<T extends string>(value: unknown, choices: readonly T[], fallback: T): T {
  // Do not coerce untrusted objects with String(value)/toString.
  return typeof value === 'string' && choices.includes(value as T) ? value as T : fallback
}

function point(value: unknown, fallback: Point | undefined, path: string): Point {
  if (value === undefined && fallback) return { ...fallback }
  const p = record(value, path)
  if (p.x === undefined || p.y === undefined) fail(`${path} 缺少坐标`)
  return {
    x: number(p.x, 0, `${path}.x`, -MAX_COORDINATE, MAX_COORDINATE),
    y: number(p.y, 0, `${path}.y`, -MAX_COORDINATE, MAX_COORDINATE),
  }
}

/** Count UTF-8 bytes without allocating another file-sized buffer. */
function withinByteLimit(text: string): boolean {
  if (text.length > MAX_DOCUMENT_BYTES) return false
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x80) bytes++
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
      bytes += 4
      i++
    } else bytes += 3
    if (bytes > MAX_DOCUMENT_BYTES) return false
  }
  return true
}

/** Reserve supplied IDs before synthesizing missing legacy IDs. */
function recordsWithIds(values: unknown[], path: string, prefix: string): Array<Record<string, unknown> & { id: string }> {
  const records = values.map((v, i) => record(v, `${path}[${i}]`))
  const ids = new Set<string>()
  for (const [i, value] of records.entries()) {
    if (value.id === undefined) continue
    const id = string(value.id, '', `${path}[${i}].id`, 256)
    if (!id) fail(`${path}[${i}].id 不能为空`)
    if (ids.has(id)) fail(`${path} 中存在重复 ID：${id}`)
    ids.add(id)
  }
  let nextId = 0
  return records.map((value) => {
    if (typeof value.id === 'string') return { ...value, id: value.id }
    let id: string
    do { id = `${prefix}-${nextId++}` } while (ids.has(id))
    ids.add(id)
    return { ...value, id }
  })
}

interface Budget {
  points: number
  links: number
  text: number
}

function addLinks(budget: Budget, count: number): void {
  budget.links += count
  if (budget.links > MAX_DOCUMENT_LINKS) fail(`拓扑引用总数超过上限 ${MAX_DOCUMENT_LINKS}`)
}

function polyline(value: unknown, path: string, budget: Budget): Point[] {
  const values = array(value, path, MAX_POLYLINE_POINTS)
  if (values.length < 2) fail(`${path} 至少需要两个点`)
  budget.points += values.length
  if (budget.points > MAX_DOCUMENT_POINTS) fail(`折线点总数超过上限 ${MAX_DOCUMENT_POINTS}`)
  // Never silently filter a bad vertex: doing so changes vertexLinks indices.
  return values.map((v, i) => point(v, undefined, `${path}[${i}]`))
}

/** Serialize document to JSON, not HTML/SVG; callers must not embed it as markup. */
export function serializeDocument(doc: RailDocument): string {
  return JSON.stringify(doc, null, 2)
}

/** Parse an untrusted .rail.json atomically, then migrate only validated data. */
export function parseDocument(json: string): ParseResult {
  if (typeof json !== 'string' || !withinByteLimit(json)) {
    return { ok: false, error: `项目文件超过 ${MAX_DOCUMENT_BYTES / 1024 / 1024} MiB 上限或不是文本` }
  }
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch (e) {
    return { ok: false, error: `JSON 解析失败：${e instanceof Error ? e.message : String(e)}` }
  }
  try {
    return { ok: true, document: normalizeDocument(record(data, '文件根节点')) }
  } catch (e) {
    return { ok: false, error: `项目校验失败：${e instanceof Error ? e.message : String(e)}` }
  }
}

function normalizeDocument(data: Record<string, unknown>): RailDocument {
  if (typeof data.name !== 'string') fail('缺少有效的项目名称')
  const version = number(data.version, 1, 'version', 1, DOCUMENT_VERSION)
  if (!Number.isInteger(version)) fail('version 必须是整数')
  const canvas = data.canvas === undefined ? {} : record(data.canvas, 'canvas')
  const budget: Budget = { points: 0, links: 0, text: 0 }
  const layers = recordsWithIds(array(data.layers, 'layers', MAX_DOCUMENT_LAYERS), 'layers', 'layer').map((l) => ({
    id: l.id,
    name: string(l.name, '图层', 'layer.name'),
    visible: boolean(l.visible, true, 'layer.visible'),
    locked: boolean(l.locked, false, 'layer.locked'),
  }))
  const elements = recordsWithIds(array(data.elements, 'elements', MAX_DOCUMENT_ELEMENTS), 'elements', 'el')
    .map((el) => normalizeElement(el, budget))
  const rawNodes = recordsWithIds(array(data.nodes, 'nodes', MAX_DOCUMENT_NODES, true), 'nodes', 'node')
  const nodes = rawNodes.map((n) => {
    const connected = array(n.connectedTrackIds, 'node.connectedTrackIds', MAX_DOCUMENT_LINKS, true)
    const links = array(n.vertexLinks, 'node.vertexLinks', MAX_DOCUMENT_LINKS, true)
    addLinks(budget, connected.length + links.length)
    return {
      id: n.id,
      x: number(n.x, 0, 'node.x', -MAX_COORDINATE, MAX_COORDINATE),
      y: number(n.y, 0, 'node.y', -MAX_COORDINATE, MAX_COORDINATE),
      nodeType: choice(n.nodeType, ['endpoint', 'junction', 'switch', 'crossing'], 'endpoint'),
      connectedTrackIds: connected.map((id) => string(id, '', 'node.connectedTrackIds[]', 256)),
      name: optionalString(n.name, 'node.name'),
      vertexLinks: links.map((value) => {
        const link = record(value, 'node.vertexLinks[]')
        const index = number(link.vertexIndex, -1, 'vertexLink.vertexIndex', -1, Number.MAX_SAFE_INTEGER)
        if (!Number.isInteger(index)) fail('vertexLink.vertexIndex 必须是整数')
        return { trackId: string(link.trackId, '', 'vertexLink.trackId', 256), vertexIndex: index }
      }),
    }
  })
  const crossings = recordsWithIds(array(data.crossings, 'crossings', MAX_DOCUMENT_CROSSINGS, true), 'crossings', 'crossing').map((c) => ({
    id: c.id,
    trackAId: string(c.trackAId, '', 'crossing.trackAId', 256),
    trackBId: string(c.trackBId, '', 'crossing.trackBId', 256),
    point: point(c.point, { x: 0, y: 0 }, 'crossing.point'),
    mode: choice(c.mode, ['plain', 'bridge-a-over-b', 'bridge-b-over-a'], 'plain'),
  }))

  const doc: RailDocument = {
    id: string(data.id, 'doc-imported', 'id', 256),
    name: string(data.name, '', 'name'),
    version,
    canvas: {
      width: number(canvas.width, DEFAULT_CANVAS_WIDTH, 'canvas.width', 1, MAX_COORDINATE),
      height: number(canvas.height, DEFAULT_CANVAS_HEIGHT, 'canvas.height', 1, MAX_COORDINATE),
      gridSize: number(canvas.gridSize, DEFAULT_GRID_SIZE, 'canvas.gridSize', 1, 10000),
      // 缺省不写入，保持旧项目序列化结果逐字节一致。
      ...(canvas.showCrossings === undefined ? {} : { showCrossings: boolean(canvas.showCrossings, true, 'canvas.showCrossings') }),
    },
    layers,
    elements,
    nodes,
    crossings,
  }
  const tracks = new Map(elements.filter(isTrack).map((t) => [t.id, t]))
  const nodeMap = new Map(nodes.map((n, i) => [n.id, { node: n, raw: rawNodes[i], bound: false }]))
  const bindNode = (id: string | undefined, p: Point): void => {
    const entry = id ? nodeMap.get(id) : undefined
    if (!entry) return
    const { node, raw } = entry
    // Legacy missing coordinates can be recovered from geometry, but explicit
    // conflicting coordinates must not silently move a track or corrupt links.
    if (!entry.bound) {
      if (raw.x === undefined) node.x = p.x
      if (raw.y === undefined) node.y = p.y
      entry.bound = true
    }
    if (Math.abs(node.x - p.x) > 0.01 || Math.abs(node.y - p.y) > 0.01) {
      fail(`节点 ${node.id} 坐标与绑定轨道顶点不一致`)
    }
  }
  for (const t of tracks.values()) {
    bindNode(t.startNodeId, t.points[0])
    bindNode(t.endNodeId, t.points[t.points.length - 1])
  }
  for (const n of nodes) {
    for (const link of n.vertexLinks) {
      const p = tracks.get(link.trackId)?.points[link.vertexIndex]
      if (p) bindNode(n.id, p)
    }
  }

  let segments = 0
  let work = 0
  for (const t of tracks.values()) {
    work += segments * (t.points.length - 1)
    if (work > MAX_INTERSECTION_WORK) fail('轨道交叉计算量超过安全上限，请拆分项目')
    segments += t.points.length - 1
  }
  for (const c of crossings) {
    const a = tracks.get(c.trackAId)
    const b = tracks.get(c.trackBId)
    if (!a || !b || a === b) continue
    work += (a.points.length - 1) * (b.points.length - 1)
    if (work > MAX_INTERSECTION_WORK) fail('轨道交叉计算量超过安全上限，请拆分项目')
  }
  migrateDocument(doc)
  if (doc.nodes.length > MAX_DOCUMENT_NODES) fail(`迁移后的节点数量超过上限 ${MAX_DOCUMENT_NODES}`)
  const migratedLinks = doc.nodes.reduce((sum, n) => sum + n.connectedTrackIds.length + n.vertexLinks.length, 0)
  if (migratedLinks > MAX_DOCUMENT_LINKS) fail(`迁移后的拓扑引用总数超过上限 ${MAX_DOCUMENT_LINKS}`)
  // Sum strings on the shallow, allowlisted output only. Include generated
  // nodes so a successful import is still within this budget after saving.
  // Unrecognized nested JSON is neither walked recursively nor retained.
  for (const item of [doc, ...doc.layers, ...doc.elements, ...doc.nodes]) {
    for (const value of Object.values(item)) {
      if (typeof value === 'string') budget.text += value.length
    }
  }
  if (budget.text > MAX_TOTAL_TEXT_LENGTH) fail(`文本总长度超过上限 ${MAX_TOTAL_TEXT_LENGTH}`)
  return doc
}

function normalizeElement(el: Record<string, unknown> & { id: string }, budget: Budget): DiagramElement {
  const base = {
    id: el.id,
    layerId: string(el.layerId, '', 'element.layerId', 256),
    visible: boolean(el.visible, true, 'element.visible'),
    locked: boolean(el.locked, false, 'element.locked'),
  }

  if (el.type === 'track') {
    return {
      ...base,
      type: 'track',
      name: optionalString(el.name, 'track.name'),
      points: polyline(el.points, 'track.points', budget),
      trackStyle: el.trackStyle === 'double' ? 'double' : 'single',
      strokeWidth: number(el.strokeWidth, 3, 'track.strokeWidth', 0, 1000),
      spacing: number(el.spacing, 8, 'track.spacing', 0, 10000),
      color: string(el.color, '#1f2933', 'track.color', 128),
      cornerRadius: number(el.cornerRadius, 0, 'track.cornerRadius', 0, 10000),
      bridgeGap: number(el.bridgeGap, 20, 'track.bridgeGap', 0, 10000),
      startNodeId: reference(el.startNodeId, 'track.startNodeId'),
      endNodeId: reference(el.endNodeId, 'track.endNodeId'),
      labelText: optionalString(el.labelText, 'track.labelText'),
      labelId: reference(el.labelId, 'track.labelId'),
    }
  }

  if (el.type === 'platform') {
    return {
      ...base,
      type: 'platform',
      start: point(el.start, { x: 0, y: 0 }, 'platform.start'),
      end: point(el.end, { x: 100, y: 0 }, 'platform.end'),
      width: number(el.width, 12, 'platform.width', 0, 10000),
      label: optionalString(el.label, 'platform.label'),
      color: string(el.color, '#f8fafc', 'platform.color', 128),
      textColor: string(el.textColor, '#475569', 'platform.textColor', 128),
    }
  }

  if (el.type === 'station') {
    // 关联线路：引用已存在的轨道 id，悬空引用在迁移阶段剔除。
    const stationTrackIds = array(el.trackIds, 'station.trackIds', MAX_DOCUMENT_LINKS, true)
    addLinks(budget, stationTrackIds.length)
    return {
      ...base,
      type: 'station',
      kind: el.kind === 'transfer' ? 'transfer' : 'station',
      name: optionalString(el.name, 'station.name'),
      x: number(el.x, 0, 'station.x', -MAX_COORDINATE, MAX_COORDINATE),
      y: number(el.y, 0, 'station.y', -MAX_COORDINATE, MAX_COORDINATE),
      radius: number(el.radius, 7, 'station.radius', 0, MAX_COORDINATE),
      color: string(el.color, '#ffffff', 'station.color', 128),
      borderColor: string(el.borderColor, '#1f2933', 'station.borderColor', 128),
      borderWidth: number(el.borderWidth, 3, 'station.borderWidth', 0, MAX_COORDINATE),
      innerRadius: number(el.innerRadius, 0, 'station.innerRadius', 0, MAX_COORDINATE),
      // 缺省写空数组，保持序列化结果稳定。
      trackIds: stationTrackIds.map((id) => string(id, '', 'station.trackIds[]', 256)).filter((id) => id.length > 0),
    }
  }

  if (el.type === 'label') {
    return {
      ...base,
      type: 'label',
      text: string(el.text, '', 'label.text'),
      x: number(el.x, 0, 'label.x', -MAX_COORDINATE, MAX_COORDINATE),
      y: number(el.y, 0, 'label.y', -MAX_COORDINATE, MAX_COORDINATE),
      rotation: number(el.rotation, 0, 'label.rotation', -360000, 360000),
      fontSize: number(el.fontSize, 14, 'label.fontSize', 1, 1000),
      // 缺省字段保持 undefined，使旧项目序列化结果与新增前完全一致。
      ...(el.align === undefined ? {} : { align: choice(el.align, ['left', 'center', 'right'], 'left') as 'left' | 'center' | 'right' }),
      ...(el.color === undefined ? {} : { color: string(el.color, '#111827', 'label.color', 128) }),
      ...(el.bold === undefined ? {} : { bold: boolean(el.bold, false, 'label.bold') }),
      ...(el.background === undefined ? {} : { background: string(el.background, '', 'label.background', 128) }),
      ...(el.backgroundWidth === undefined ? {} : { backgroundWidth: number(el.backgroundWidth, 0, 'label.backgroundWidth', 0, MAX_COORDINATE) }),
      ...(el.backgroundHeight === undefined ? {} : { backgroundHeight: number(el.backgroundHeight, 0, 'label.backgroundHeight', 0, MAX_COORDINATE) }),
      ...(el.backgroundRadius === undefined ? {} : { backgroundRadius: number(el.backgroundRadius, 0, 'label.backgroundRadius', 0, MAX_COORDINATE) }),
    }
  }

  if (el.type === 'direction-marker') {
    return {
      ...base,
      type: 'direction-marker',
      trackId: string(el.trackId, '', 'direction-marker.trackId', 256),
      endpoint: el.endpoint === 'start' ? 'start' : 'end',
      text: string(el.text, '', 'direction-marker.text'),
      arrow: choice(el.arrow, ['outward', 'inward', 'none'], 'outward'),
      offset: number(el.offset, 12, 'direction-marker.offset', -10000, 10000),
      textOffset: number(el.textOffset, 18, 'direction-marker.textOffset', -10000, 10000),
      textOrientation: el.textOrientation === 'horizontal' ? 'horizontal' : 'follow',
      fontSize: number(el.fontSize, 13, 'direction-marker.fontSize', 1, 1000),
      arrowSize: number(el.arrowSize, 10, 'direction-marker.arrowSize', 0, 1000),
      strokeWidth: number(el.strokeWidth, 2, 'direction-marker.strokeWidth', 0, 1000),
    }
  }

  if (el.type === 'line') {
    return {
      ...base,
      type: 'line',
      name: optionalString(el.name, 'line.name'),
      points: polyline(el.points, 'line.points', budget),
      dashed: boolean(el.dashed, false, 'line.dashed'),
      arrowStart: boolean(el.arrowStart, false, 'line.arrowStart'),
      arrowEnd: boolean(el.arrowEnd, false, 'line.arrowEnd'),
      color: string(el.color, '#475569', 'line.color', 128),
      strokeWidth: number(el.strokeWidth, 2, 'line.strokeWidth', 0, 1000),
    }
  }

  return fail('不支持的图元类型')
}
