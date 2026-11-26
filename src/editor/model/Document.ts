import { v4 as uuidv4 } from 'uuid'
import type {
  DiagramElement,
  DirectionMarkerElement,
  Layer,
  LabelElement,
  LineElement,
  PlatformElement,
  RailDocument,
  StationElement,
  TrackElement,
} from '../../types'
import { createLayer } from './Layer'
import { createRailwayNode } from './RailwayNode'

export const DEFAULT_CANVAS_WIDTH = 4000
export const DEFAULT_CANVAS_HEIGHT = 3000
export const DEFAULT_GRID_SIZE = 20
export const DOCUMENT_VERSION = 3

export function createDocument(name = '未命名项目'): RailDocument {
  const layer = createLayer('默认图层')
  return {
    id: uuidv4(),
    name,
    version: DOCUMENT_VERSION,
    canvas: {
      width: DEFAULT_CANVAS_WIDTH,
      height: DEFAULT_CANVAS_HEIGHT,
      gridSize: DEFAULT_GRID_SIZE,
    },
    layers: [layer],
    elements: [],
    nodes: [],
    crossings: [],
  }
}

export function isTrack(el: DiagramElement): el is TrackElement {
  return el.type === 'track'
}

export function isPlatform(el: DiagramElement): el is PlatformElement {
  return el.type === 'platform'
}

export function isStation(el: DiagramElement): el is StationElement {
  return el.type === 'station'
}

export function isLabel(el: DiagramElement): el is LabelElement {
  return el.type === 'label'
}

export function isDirectionMarker(el: DiagramElement): el is DirectionMarkerElement {
  return el.type === 'direction-marker'
}

export function isLine(el: DiagramElement): el is LineElement {
  return el.type === 'line'
}

export function getLayer(doc: RailDocument, layerId: string): Layer | undefined {
  return doc.layers.find((l) => l.id === layerId)
}

export function cloneDocument(source: RailDocument): RailDocument {
  return JSON.parse(JSON.stringify(source)) as RailDocument
}

/**
 * v1 -> v2 -> v3 迁移：
 * - v1：旧项目没有 topology，为每条 Track 的两个端点自动创建 endpoint RailwayNode。
 * - v3：RailwayNode 新增 vertexLinks（道岔不拆线的内部顶点连接），旧节点补空数组。
 */
export function migrateDocument(doc: RailDocument): RailDocument {
  // This is an in-place migration for model callers, not the untrusted JSON
  // boundary. parseDocument validates types, numeric limits and budgets first.
  if (doc.version !== undefined && (!Number.isInteger(doc.version) || doc.version < 1 || doc.version > DOCUMENT_VERSION)) {
    throw new Error('不支持的项目版本')
  }
  if (!Array.isArray(doc.nodes)) doc.nodes = []
  if (!Array.isArray(doc.crossings)) doc.crossings = []
  for (const [name, items] of [['layers', doc.layers], ['elements', doc.elements], ['nodes', doc.nodes], ['crossings', doc.crossings]] as const) {
    const ids = new Set<string>()
    for (const item of items) {
      if (!item.id || ids.has(item.id)) throw new Error(`${name} 中存在空 ID 或重复 ID`)
      ids.add(item.id)
    }
  }

  const tracks = new Map(doc.elements.filter(isTrack).map((t) => [t.id, t]))
  for (const t of tracks.values()) {
    if (t.points.length < 2) throw new Error('轨道至少需要两个点')
  }
  const nodes = new Map(doc.nodes.map((n) => [n.id, n]))
  const connected = new Map(doc.nodes.map((n) => [n.id, new Set<string>()]))
  for (const t of tracks.values()) {
    for (const endpoint of ['start', 'end'] as const) {
      const currentId = endpoint === 'start' ? t.startNodeId : t.endNodeId
      let node = currentId ? nodes.get(currentId) : undefined
      if (!node) {
        const p = endpoint === 'start' ? t.points[0] : t.points[t.points.length - 1]
        node = createRailwayNode(p, 'endpoint')
        doc.nodes.push(node)
        nodes.set(node.id, node)
        connected.set(node.id, new Set())
      }
      if (endpoint === 'start') t.startNodeId = node.id
      else t.endNodeId = node.id
      connected.get(node.id)!.add(t.id)
    }
  }
  // Rebuild, rather than trust connectedTrackIds from a file. Maps/Sets avoid
  // repeated whole-document scans and deduplicate even high-degree nodes.
  for (const n of doc.nodes) {
    const seen = new Map<string, Set<number>>()
    n.vertexLinks = (Array.isArray(n.vertexLinks) ? n.vertexLinks : []).filter((link) => {
      if (!link) return false
      const t = tracks.get(link.trackId)
      if (!t || !Number.isInteger(link.vertexIndex) || link.vertexIndex < 0 || link.vertexIndex >= t.points.length) return false
      let indices = seen.get(link.trackId)
      if (!indices) seen.set(link.trackId, indices = new Set())
      if (indices.has(link.vertexIndex)) return false
      indices.add(link.vertexIndex)
      connected.get(n.id)!.add(t.id)
      return true
    })
    n.connectedTrackIds = [...connected.get(n.id)!]
  }
  doc.nodes = doc.nodes.filter((n) => n.connectedTrackIds.length > 0)

  // 剔除车站关联线路中的悬空引用（线路被删除后不留残缺 id）。
  for (const el of doc.elements) {
    if (isStation(el) && el.trackIds.length) {
      const seen = new Set<string>()
      el.trackIds = el.trackIds.filter((id) => {
        if (!tracks.has(id) || seen.has(id)) return false
        seen.add(id)
        return true
      })
    }
  }

  const layerIds = new Set(doc.layers.map((l) => l.id))
  const labelIds = new Set(doc.elements.filter(isLabel).map((l) => l.id))
  for (const el of doc.elements) {
    // Zero layers / deleted layers are an intentional supported state.
    if (!layerIds.has(el.layerId)) el.layerId = ''
    if (isTrack(el) && el.labelId && !labelIds.has(el.labelId)) delete el.labelId
  }
  doc.elements = doc.elements.filter((el) => !isDirectionMarker(el) || tracks.has(el.trackId))
  const crossingPoints = new Set<string>()
  doc.crossings = doc.crossings.filter((c) => {
    if (c.trackAId === c.trackBId || !tracks.has(c.trackAId) || !tracks.has(c.trackBId)) return false
    // The same track pair can intersect more than once. Only deduplicate an
    // identical location, and use a structured key (IDs may contain delimiters).
    const key = JSON.stringify([[c.trackAId, c.trackBId].sort(), c.point.x, c.point.y])
    if (crossingPoints.has(key)) return false
    crossingPoints.add(key)
    return true
  })
  doc.version = DOCUMENT_VERSION
  return doc
}
