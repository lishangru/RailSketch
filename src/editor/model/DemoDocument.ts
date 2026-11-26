import type { DirectionMarkerElement, LabelElement, PlatformElement, RailDocument, TrackElement } from '../../types'
import { v4 as uuidv4 } from 'uuid'
import { createLayer } from './Layer'
import { createRailwayNode } from './RailwayNode'
import { migrateDocument } from './Document'
import { synchronizeNodeCoordinates } from '../topology/Topology'
import { mergeNodes, splitTrackAtPoint } from '../topology/Topology'

/**
 * v2 示例枢纽：双线高铁 + 12 条站场股道 + 6 座站台 +
 * 多处 45° 道岔拓扑 + 一个四向 Junction + 方向标识。
 */
export function createDemoDocument(): RailDocument {
  const main = createLayer('高铁通道')
  const yard = createLayer('站场股道')
  const link = createLayer('联络线')
  const stations = createLayer('客运设施')
  const textLayer = createLayer('文字标注')

  const tr = (
    over: Partial<TrackElement> & { points: TrackElement['points']; layerId: string },
  ): TrackElement => {
    const { points, layerId, ...rest } = over
    return {
      id: uuidv4(),
      type: 'track',
      layerId,
      visible: true,
      locked: false,
      trackStyle: 'single',
      strokeWidth: 3,
      spacing: 8,
      color: '#1f2933',
      cornerRadius: 0,
      bridgeGap: 24,
      points,
      ...rest,
    }
  }

  const pl = (
    over: Partial<PlatformElement> & { start: { x: number; y: number }; end: { x: number; y: number }; layerId: string },
  ): PlatformElement => {
    const { start, end, layerId, ...rest } = over
    return {
      id: uuidv4(),
      type: 'platform',
      layerId,
      visible: true,
      locked: false,
      width: 20,
      color: '#f8fafc',
      textColor: '#475569',
      start,
      end,
      ...rest,
    }
  }

  const lb = (
    over: Partial<LabelElement> & { text: string; x: number; y: number; layerId: string },
  ): LabelElement => {
    const { text, x, y, layerId, ...rest } = over
    return { id: uuidv4(), type: 'label', layerId, visible: true, locked: false, rotation: 0, fontSize: 15, text, x, y, ...rest }
  }

  const mk = (trackId: string, endpoint: 'start' | 'end', text: string): DirectionMarkerElement => ({
    id: uuidv4(),
    type: 'direction-marker',
    layerId: textLayer.id,
    visible: true,
    locked: false,
    trackId,
    endpoint,
    text,
    arrow: 'outward',
    offset: 12,
    textOffset: 18,
    textOrientation: 'follow',
    fontSize: 13,
    arrowSize: 10,
    strokeWidth: 2,
  })

  const topMain = tr({
    points: [ { x: 440, y: 260 }, { x: 2160, y: 260 } ],
    layerId: main.id, trackStyle: 'double', spacing: 16, strokeWidth: 4, name: '京沪高速铁路',
  })
  const bottomMain = tr({
    points: [ { x: 440, y: 2020 }, { x: 2160, y: 2020 } ],
    layerId: main.id, trackStyle: 'double', spacing: 16, strokeWidth: 4, name: '宁杭高速铁路',
  })
  const link1 = tr({ points: [ { x: 1520, y: 260 }, { x: 2060, y: 2020 } ], layerId: link.id, color: '#2563eb', name: '上行联络线' })
  const link2 = tr({ points: [ { x: 1640, y: 260 }, { x: 2180, y: 2020 } ], layerId: link.id, color: '#2563eb' })
  const link3 = tr({ points: [ { x: 1000, y: 2020 }, { x: 1300, y: 260 } ], layerId: link.id, color: '#dc2626', name: '下行联络线' })
  const link4 = tr({ points: [ { x: 880, y: 2020 }, { x: 1180, y: 260 } ], layerId: link.id, color: '#dc2626' })

  // 12 条站场股道。
  const yardTracks: TrackElement[] = []
  const ys = [680, 760, 840, 920, 1000, 1080, 1240, 1320, 1400, 1480, 1560, 1640]
  for (const y of ys) {
    yardTracks.push(tr({ points: [ { x: 560, y }, { x: 2000, y } ], layerId: yard.id, color: '#334155' }))
  }

  // 6 座站台，夹在股道之间。
  const platforms: PlatformElement[] = [720, 880, 1040, 1280, 1440, 1600].map((y, i) =>
    pl({ start: { x: 620, y }, end: { x: 1940, y }, layerId: stations.id, label: `${i + 1} 站台` }),
  )

  // 一个真正的四向 Junction：四个端点节点 + 一个共享 junction 节点。
  const jid = uuidv4()
  const jx = 1300
  const jy = 1160
  const jLeft = createRailwayNode({ x: 1180, y: jy }, 'endpoint')
  const jRight = createRailwayNode({ x: 1420, y: jy }, 'endpoint')
  const jTop = createRailwayNode({ x: jx, y: 1040 }, 'endpoint')
  const jBottom = createRailwayNode({ x: jx, y: 1280 }, 'endpoint')
  const jNode = createRailwayNode({ x: jx, y: jy }, 'junction')
  const junctionTracks: TrackElement[] = [
    tr({ points: [ { x: 1180, y: jy }, { x: jx, y: jy } ], layerId: link.id, color: '#0f766e', startNodeId: jLeft.id, endNodeId: jNode.id }),
    tr({ points: [ { x: jx, y: jy }, { x: 1420, y: jy } ], layerId: link.id, color: '#0f766e', startNodeId: jNode.id, endNodeId: jRight.id }),
    tr({ points: [ { x: jx, y: 1040 }, { x: jx, y: jy } ], layerId: link.id, color: '#0f766e', startNodeId: jTop.id, endNodeId: jNode.id }),
    tr({ points: [ { x: jx, y: jy }, { x: jx, y: 1280 } ], layerId: link.id, color: '#0f766e', startNodeId: jNode.id, endNodeId: jBottom.id }),
  ]
  jLeft.connectedTrackIds = [junctionTracks[0].id]
  jRight.connectedTrackIds = [junctionTracks[1].id]
  jTop.connectedTrackIds = [junctionTracks[2].id]
  jBottom.connectedTrackIds = [junctionTracks[3].id]
  jNode.connectedTrackIds = junctionTracks.map((t) => t.id)

  const labels: LabelElement[] = [
    lb({ text: '示例南站', x: 1240, y: 2000, fontSize: 34, layerId: textLayer.id }),
    lb({ text: '南京方向', x: 300, y: 240, fontSize: 13, layerId: textLayer.id }),
    lb({ text: '上海方向', x: 2200, y: 240, fontSize: 13, layerId: textLayer.id }),
    lb({ text: '合肥方向', x: 300, y: 2000, fontSize: 13, layerId: textLayer.id }),
    lb({ text: '杭州方向', x: 2200, y: 2000, fontSize: 13, layerId: textLayer.id }),
  ]

  const doc: RailDocument = {
    id: uuidv4(),
    name: '示例南站铁路枢纽配线图',
    version: 2,
    canvas: { width: 2600, height: 2320, gridSize: 20 },
    layers: [main, yard, link, stations, textLayer],
    elements: [topMain, bottomMain, link1, link2, link3, link4, ...yardTracks, ...junctionTracks, ...platforms, ...labels],
    nodes: [jLeft, jRight, jTop, jBottom, jNode],
    crossings: [],
  }

  // 迁移创建端点节点。
  migrateDocument(doc)

  // 联络线两端与正线的接点升级为 switch 节点。
  const switches: { main: TrackElement; link: TrackElement; p: { x: number; y: number } }[] = [
    { main: topMain, link: link1, p: { x: 1520, y: 260 } },
    { main: topMain, link: link2, p: { x: 1640, y: 260 } },
    { main: topMain, link: link3, p: { x: 1300, y: 260 } },
    { main: topMain, link: link4, p: { x: 1180, y: 260 } },
    { main: bottomMain, link: link1, p: { x: 2060, y: 2020 } },
    { main: bottomMain, link: link2, p: { x: 2180, y: 2020 } },
    { main: bottomMain, link: link3, p: { x: 1000, y: 2020 } },
    { main: bottomMain, link: link4, p: { x: 880, y: 2020 } },
  ]
  const findTrackAt = (p: { x: number; y: number }, layerId: string): TrackElement | undefined => {
    let best: TrackElement | undefined
    let bestD = 1
    for (const el of doc.elements) {
      if (el.type !== 'track' || el.layerId !== layerId) continue
      for (let i = 0; i < el.points.length - 1; i++) {
        const a = el.points[i]
        const b = el.points[i + 1]
        const abx = b.x - a.x
        const aby = b.y - a.y
        const lenSq = abx * abx + aby * aby || 1
        let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq
        t = Math.max(0, Math.min(1, t))
        const d = Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t))
        if (d < bestD) {
          bestD = d
          best = el
        }
      }
    }
    return best
  }

  for (const s of switches) {
    try {
      // 前一次拆分后原正线 ID 已改变，按坐标重新找到当前包含该点的 Track。
      const currentMain = findTrackAt(s.p, main.id)
      if (!currentMain) continue
      const split = splitTrackAtPoint(doc, currentMain.id, s.p, 'switch')
      const linkNodeId = s.link.points[0].x === s.p.x && s.link.points[0].y === s.p.y ? s.link.startNodeId : s.link.endNodeId
      if (linkNodeId) mergeNodes(doc, linkNodeId, split.node.id)
    } catch {
      // 单点拆分失败时保留现有几何，不阻断 Demo 加载。
    }
  }

  // 方向标识：绑定正线端点，自动跟随线路。
  const markers: DirectionMarkerElement[] = [
    mk(topMain.id, 'start', '北京'),
    mk(topMain.id, 'end', '上海'),
    mk(bottomMain.id, 'start', '合肥'),
    mk(bottomMain.id, 'end', '杭州'),
  ]
  doc.elements.push(...markers)

  // 示例立体交叉：上行联络线与下行联络线平面相交，但 A 跨越 B。
  doc.crossings.push({
    id: uuidv4(),
    trackAId: link1.id,
    trackBId: link3.id,
    point: { x: 1630, y: 1130 },
    mode: 'bridge-a-over-b',
  })

  // 创建四向 junction 的显式节点。
  const junctionNode = doc.nodes.find((n) => n.id === jid)
  if (junctionNode) {
    junctionNode.nodeType = 'junction'
    junctionNode.connectedTrackIds = junctionTracks.map((t) => t.id)
  }

  synchronizeNodeCoordinates(doc)
  return doc
}
