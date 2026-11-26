import test from 'node:test'
import assert from 'node:assert/strict'
import { Editor } from '../src/editor/core/Editor'
import { createDocument, isStation } from '../src/editor/model/Document'
import { createStation, stationDefaults, DEFAULT_STATION_RADIUS, DEFAULT_TRANSFER_RADIUS } from '../src/editor/model/Station'
import { parseDocument, serializeDocument } from '../src/editor/serialization/serializer'
import { ensureTrackEndpoints, splitTrackAtPoint, validateTopology } from '../src/editor/topology/Topology'
import { createTrack } from '../src/editor/model/Track'
import { hitTest } from '../src/editor/geometry/HitTest'
import { StationRenderer } from '../src/editor/render/StationRenderer'

function fixture() {
  const doc = createDocument()
  return { ed: new Editor(doc), layerId: doc.layers[0]!.id }
}

/** 记录 fill/stroke 次数的最小上下文。 */
function countingCtx() {
  const counts = { fill: 0, stroke: 0, arcs: 0 }
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_, key: string) => {
      if (key === 'fill') return () => { counts.fill++ }
      if (key === 'stroke') return () => { counts.stroke++ }
      if (key === 'arc') return () => { counts.arcs++ }
      return () => {}
    },
    set: () => true,
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, counts }
}

test('station factory applies distinct defaults for the two icon kinds', () => {
  const normal = createStation({ x: 10, y: 20, layerId: 'L' })
  const transfer = createStation({ x: 10, y: 20, layerId: 'L', kind: 'transfer' })
  assert.equal(normal.kind, 'station')
  assert.equal(transfer.kind, 'transfer')
  assert.equal(normal.radius, DEFAULT_STATION_RADIUS)
  assert.equal(transfer.radius, DEFAULT_TRANSFER_RADIUS)
  assert.ok(transfer.radius > normal.radius, '换乘站圆圈应更大')
  assert.equal(normal.innerRadius, 0, '普通站不应有内环')
  assert.ok(transfer.innerRadius > 0, '换乘站应有内环')
  assert.deepEqual(stationDefaults('station').innerRadius, 0)
  assert.ok(stationDefaults('transfer').innerRadius > 0)
  // 未知 kind 归一化为普通站，避免脏数据产生第三种外观。
  assert.equal(createStation({ x: 0, y: 0, layerId: 'L', kind: 'weird' as never }).kind, 'station')
})

test('station tool places a station on click and is undoable', () => {
  const { ed, layerId } = fixture()
  ed.setTool('station')
  ed.commitStation({ x: 120, y: 80 })
  const stations = ed.document.elements.filter(isStation)
  assert.equal(stations.length, 1)
  assert.deepEqual({ x: stations[0]!.x, y: stations[0]!.y }, { x: 120, y: 80 })
  assert.equal(stations[0]!.layerId, layerId)
  assert.deepEqual(validateTopology(ed.document), [])
  ed.undo()
  assert.equal(ed.document.elements.filter(isStation).length, 0)
  ed.redo()
  assert.equal(ed.document.elements.filter(isStation).length, 1)
})

test('commitStation remembers the last used kind for the tool', () => {
  const { ed } = fixture()
  ed.commitStation({ x: 0, y: 0 }, 'transfer')
  assert.equal(ed.state.stationKind, 'transfer')
  ed.commitStation({ x: 50, y: 0 })
  const stations = ed.document.elements.filter(isStation)
  assert.equal(stations[1]!.kind, 'transfer', '应沿用上一次选择的换乘站类型')
})

test('M shortcut selects the station tool', () => {
  const { ed } = fixture()
  // handleKeyDown 是私有箭头属性；与 rendering.test.ts 一样直接取用做断言。
  // isTypingTarget 只读取 document.activeElement，Node 环境补一个最小桩即可。
  const globals = globalThis as { document?: { activeElement: unknown } }
  const hadDocument = 'document' in globals
  const previous = globals.document
  globals.document = { activeElement: null }
  try {
    const handler = (ed as unknown as { handleKeyDown: (e: KeyboardEvent) => void }).handleKeyDown
    handler.call(ed, { key: 'm', preventDefault() {} } as unknown as KeyboardEvent)
    assert.equal(ed.state.tool, 'station')
    handler.call(ed, { key: 'v', preventDefault() {} } as unknown as KeyboardEvent)
    assert.equal(ed.state.tool, 'select')
  } finally {
    if (hadDocument) globals.document = previous
    else delete globals.document
  }
})

test('stations are clickable and win over the track underneath', () => {
  const { ed, layerId } = fixture()
  ed.commitTrack([{ x: 0, y: 100 }, { x: 400, y: 100 }])
  ed.commitStation({ x: 200, y: 100 })
  const hit = hitTest({ x: 200, y: 100 }, ed.document.elements, { maxDistance: 8 })
  assert.ok(hit)
  assert.equal(hit.element.type, 'station')
  void layerId
  // 圆圈之外不应命中车站。
  const far = hitTest({ x: 200, y: 100 + 60 }, ed.document.elements, { maxDistance: 8 })
  assert.notEqual(far?.element.type, 'station')
})

test('station circles render above tracks and transfers draw an inner ring', () => {
  const { ed } = fixture()
  ed.commitStation({ x: 0, y: 0 })
  ed.commitStation({ x: 100, y: 0 }, 'transfer')
  const { ctx, counts } = countingCtx()
  new StationRenderer().render(ctx, ed.camera, ed.document)
  assert.equal(counts.arcs, 3, '两个外圈 + 一个换乘站内环')
  assert.equal(counts.fill, 3)
  assert.equal(counts.stroke, 2, '普通站与换乘站各描边一次')
})

test('station elements survive save and load with every field intact', () => {
  const { ed } = fixture()
  ed.commitStation({ x: 33, y: 44 }, 'transfer')
  const source = ed.document.elements.find(isStation)!
  source.name = '新街口'
  source.radius = 12
  source.color = '#ff0000'
  source.borderColor = '#00ff00'
  source.borderWidth = 5
  const json = serializeDocument(ed.document)
  const result = parseDocument(json)
  assert.equal(result.ok, true, result.error)
  const loaded = result.document!.elements.find(isStation)
  assert.ok(loaded)
  assert.deepEqual(loaded, { ...source, name: '新街口' })
})

test('malformed station fields are rejected or normalized, never trusted', () => {
  const base = { name: '旧版项目', layers: [], elements: [], nodes: [], crossings: [] }
  const bad = parseDocument(JSON.stringify({
    ...base,
    elements: [{ type: 'station', x: 'nope', y: 0 }],
  }))
  assert.equal(bad.ok, false)
  // 缺失的可选样式回落到安全默认值。
  const ok = parseDocument(JSON.stringify({ ...base, elements: [{ type: 'station', x: 5, y: 6 }] }))
  assert.equal(ok.ok, true, ok.error)
  const el = ok.document!.elements[0]
  assert.ok(el.type === 'station')
  assert.equal(el.kind, 'station')
  assert.equal(el.radius, 7)
  assert.equal(el.innerRadius, 0)
  // 未知 kind 归一化，不产生第三种图标。
  const weird = parseDocument(JSON.stringify({ ...base, elements: [{ type: 'station', x: 0, y: 0, kind: { toString: {} } }] }))
  assert.equal(weird.ok, true, weird.error)
  const w = weird.document!.elements[0]
  assert.ok(w.type === 'station' && w.kind === 'station')
})

test('eraser removes whole station circles and undo restores them', () => {
  const { ed } = fixture()
  ed.commitStation({ x: 200, y: 200 })
  assert.equal(ed.document.elements.filter(isStation).length, 1)
  const hits = ed.findEraserHits([{ x: 195, y: 195 }, { x: 205, y: 205 }])
  assert.equal(hits.deleteIds.length, 1)
  ed.executeEraser([{ x: 195, y: 195 }, { x: 205, y: 205 }])
  assert.equal(ed.document.elements.filter(isStation).length, 0)
  ed.undo()
  assert.equal(ed.document.elements.filter(isStation).length, 1)
})

test('transfer ring never uses a negative radius when the border is wider than the circle', () => {
  const { ed } = fixture()
  ed.commitStation({ x: 0, y: 0 }, 'transfer')
  const station = ed.document.elements.find(isStation)!
  station.radius = 3
  station.borderWidth = 10
  const radii: number[] = []
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_, key: string) => key === 'arc'
      ? (_x: number, _y: number, r: number) => { radii.push(r) }
      : () => {},
    set: () => true,
  }) as unknown as CanvasRenderingContext2D
  new StationRenderer().render(ctx, ed.camera, ed.document)
  assert.ok(radii.length > 0 && radii.every((r) => r >= 0), 'ctx.arc 抛 IndexSizeError 会中断整帧渲染')
})

test('splitting a track relinks a station to the piece nearest to it', () => {
  const { ed, layerId } = fixture()
  const track = createTrack({ layerId, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }] })
  ed.document.elements.push(track)
  ensureTrackEndpoints(ed.document, track)
  ed.commitStation({ x: 180, y: 0 })
  const station = ed.document.elements.find(isStation)!
  assert.deepEqual(station.trackIds, [track.id])
  const { trackA, trackB } = splitTrackAtPoint(ed.document, track.id, { x: 100, y: 0 }, 'junction')
  assert.notEqual(trackA.id, trackB.id)
  assert.deepEqual(station.trackIds, [trackB.id], '车站在右半段，应关联右半段')
})
