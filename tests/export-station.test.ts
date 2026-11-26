import test from 'node:test'
import assert from 'node:assert/strict'
import { Editor } from '../src/editor/core/Editor'
import { createDocument, isStation, isTrack } from '../src/editor/model/Document'
import { createStation, isStationOnTrack } from '../src/editor/model/Station'
import { migrateDocument } from '../src/editor/model/Document'
import {
  computeExportBounds,
  exportAsImage,
  exportAsPdf,
  formatBytes,
  MAX_EXPORT_DIMENSION,
  MAX_EXPORT_PIXELS,
  renderDocumentToCanvas,
} from '../src/editor/export/Exporter'

/** 最小 canvas 桩：记录 2D 调用，并按需产出 JPEG 字节。 */
function stubCanvas(options: { failToBlob?: boolean } = {}) {
  const calls = { fill: 0, stroke: 0, fillText: 0, arcs: 0 }
  const state = { width: 0, height: 0 }
  const ctx2d: Record<string, unknown> = {
    canvas: null,
    measureText: (t: string) => ({ width: t.length * 14 }),
    save() {}, restore() {}, translate() {}, rotate() {}, setTransform() {}, transform() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arcTo() {}, rect() {}, clearRect() {},
    setLineDash() {}, fillRect() {},
    fill: () => { calls.fill++ },
    stroke: () => { calls.stroke++ },
    arc: () => { calls.arcs++ },
    fillText: () => { calls.fillText++ },
  }
  const make = (): unknown => ({
    get width() { return state.width },
    set width(v: number) { state.width = v },
    get height() { return state.height },
    set height(v: number) { state.height = v },
    getContext: () => ctx2d,
    toBlob: (cb: (b: Blob | null) => void, type?: string) => {
      if (options.failToBlob) { cb(null); return }
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3, 0xff, 0xd9])
      cb(new Blob([bytes], { type: type ?? 'application/octet-stream' }))
    },
  })
  return { calls, state, make }
}

function withStubbedDom<T>(make: () => unknown, fn: () => T): T {
  const globals = globalThis as { document?: unknown }
  const had = 'document' in globals
  const prev = globals.document
  globals.document = { createElement: () => make() }
  try {
    return fn()
  } finally {
    if (had) globals.document = prev
    else delete globals.document
  }
}

function demoDoc() {
  const doc = createDocument('导出测试')
  const layerId = doc.layers[0]!.id
  doc.elements.push({
    id: 't1', type: 'track', layerId, visible: true, locked: false,
    points: [{ x: 100, y: 100 }, { x: 400, y: 100 }, { x: 400, y: 300 }],
    trackStyle: 'single', strokeWidth: 6, spacing: 8, color: '#2563eb', cornerRadius: 0, bridgeGap: 20,
  })
  doc.elements.push(createStation({ x: 250, y: 100, layerId, name: '中间站', trackIds: ['t1'] }))
  doc.elements.push({ id: 'lb1', type: 'label', layerId, visible: true, locked: false, text: '站名', x: 250, y: 80, rotation: 0, fontSize: 14 })
  return migrateDocument(doc)
}

// ─────────── 选中 / 拖动 / 编辑 ───────────

test('stations are selectable and draggable like other point elements', () => {
  const ed = new Editor(demoDoc())
  const station = ed.document.elements.find(isStation)!
  // 拖动会就地修改元素，先快照原始坐标。
  const origin = { x: station.x, y: station.y }
  const hit = ed.hitTest(origin)
  assert.ok(hit)
  assert.equal(hit.element.type, 'station', '点击站点中心应命中站点而非线路')
  // 拖动白名单必须包含 station，否则无法拖动。
  ed.drag.beginElementDrag(station.id, origin)
  assert.equal(ed.drag.isDragging, true)
  ed.drag.move({ x: origin.x + 30, y: origin.y })
  const preview = ed.getElement(station.id)
  assert.ok(preview && isStation(preview))
  assert.notDeepEqual({ x: preview.x, y: preview.y }, origin, '拖动中应实时预览新位置')
  ed.drag.finish()
  const after = ed.getElement(station.id)
  assert.ok(after && isStation(after))
  assert.notDeepEqual({ x: after.x, y: after.y }, origin, '松手后位置应被提交')
  ed.undo()
  const back = ed.getElement(station.id)
  assert.ok(back && isStation(back))
  assert.deepEqual({ x: back.x, y: back.y }, origin, '撤销应回到原位置')
})

test('dragging a station snaps it onto the track centreline', () => {
  const ed = new Editor(demoDoc())
  const station = ed.document.elements.find(isStation)!
  ed.state.snapGrid = true
  // 吸附容差随缩放变化，按实际 zoom 推算拖动距离。
  const tol = 10 / ed.camera.zoom
  assert.ok(tol > 0, '吸附容差应为正')
  ed.drag.beginElementDrag(station.id, { x: station.x, y: station.y })
  ed.drag.move({ x: station.x, y: station.y + tol * 0.8 })
  ed.drag.finish()
  const moved = ed.getElement(station.id)
  assert.ok(moved && isStation(moved))
  assert.ok(Math.abs(moved.y - 100) < 0.5, `站点应吸附到线路上，实际 y=${moved.y}`)
})

test('dragging beyond the snap tolerance leaves the station where it is dropped', () => {
  const ed = new Editor(demoDoc())
  const station = ed.document.elements.find(isStation)!
  const origin = { x: station.x, y: station.y }
  ed.state.snapGrid = true
  ed.drag.beginElementDrag(station.id, origin)
  // 远超容差：不应被强行拉回线路。
  ed.drag.move({ x: origin.x, y: origin.y + 120 })
  ed.drag.finish()
  const moved = ed.getElement(station.id)
  assert.ok(moved && isStation(moved))
  assert.ok(Math.abs(moved.y - (origin.y + 120)) < 0.5, `超出容差不应吸附，实际 y=${moved.y}`)
})

test('station placement snaps to the nearest track', () => {
  const ed = new Editor(demoDoc())
  ed.state.snapGrid = true
  // 站点工具下落在线路附近，SelectionController 使用 useLineSnap=true。
  const snapped = ed.getSnapPoint({ x: 300, y: 108 }, false, undefined, true)
  assert.equal(snapped.snapped, true)
  assert.ok(Math.abs(snapped.point.y - 100) < 0.5, `应吸附到 y=100，实际 ${snapped.point.y}`)
})

// ─────────── 线路关联 ───────────

test('placing a station on a line auto-links that line', () => {
  const ed = new Editor(demoDoc())
  const near = ed.findTracksNear({ x: 250, y: 100 }, Editor.STATION_LINK_TOLERANCE)
  assert.deepEqual(near, ['t1'])
  ed.commitStation({ x: 250, y: 100 })
  const created = ed.document.elements.filter(isStation).at(-1)!
  assert.deepEqual(created.trackIds, ['t1'])
  assert.equal(created.kind, 'station')
  assert.equal(ed.getStationTracks(created.id).length, 1)
})

test('a station on two lines becomes a transfer station linked to both', () => {
  const doc = demoDoc()
  const layerId = doc.layers[0]!.id
  doc.elements.push({
    id: 't2', type: 'track', layerId, visible: true, locked: false,
    points: [{ x: 100, y: 100 }, { x: 400, y: 100 }],
    trackStyle: 'single', strokeWidth: 6, spacing: 8, color: '#dc2626', cornerRadius: 0, bridgeGap: 20,
  })
  const ed = new Editor(migrateDocument(doc))
  assert.equal(ed.findTracksNear({ x: 300, y: 100 }, Editor.STATION_LINK_TOLERANCE).length, 2)
  ed.commitStation({ x: 300, y: 100 })
  const created = ed.document.elements.filter(isStation).at(-1)!
  assert.equal(created.kind, 'transfer', '跨两条线路应自动升级为换乘站')
  assert.equal(created.trackIds.length, 2)
  assert.ok(created.innerRadius > 0)
})

test('a station on three or more lines is also treated as a transfer', () => {
  const doc = demoDoc()
  const layerId = doc.layers[0]!.id
  for (const [id, color] of [['t2', '#dc2626'], ['t3', '#16a34a']] as const) {
    doc.elements.push({
      id, type: 'track', layerId, visible: true, locked: false,
      points: [{ x: 100, y: 100 }, { x: 400, y: 100 }],
      trackStyle: 'single', strokeWidth: 6, spacing: 8, color, cornerRadius: 0, bridgeGap: 20,
    })
  }
  const ed = new Editor(migrateDocument(doc))
  ed.commitStation({ x: 300, y: 100 })
  const created = ed.document.elements.filter(isStation).at(-1)!
  assert.equal(created.trackIds.length, 3)
  assert.equal(created.kind, 'transfer')
})

test('a station far from any line links to nothing', () => {
  const ed = new Editor(demoDoc())
  assert.deepEqual(ed.findTracksNear({ x: 250, y: 600 }, Editor.STATION_LINK_TOLERANCE), [])
  ed.commitStation({ x: 250, y: 600 })
  const created = ed.document.elements.filter(isStation).at(-1)!
  assert.deepEqual(created.trackIds, [])
})

test('toggling a line link is undoable and demotes transfer when below two lines', () => {
  const doc = demoDoc()
  const layerId = doc.layers[0]!.id
  doc.elements.push({
    id: 't2', type: 'track', layerId, visible: true, locked: false,
    points: [{ x: 100, y: 100 }, { x: 400, y: 100 }],
    trackStyle: 'single', strokeWidth: 6, spacing: 8, color: '#dc2626', cornerRadius: 0, bridgeGap: 20,
  })
  const ed = new Editor(migrateDocument(doc))
  const station = ed.document.elements.find(isStation)!
  station.trackIds = ['t1', 't2']
  station.kind = 'transfer'

  assert.equal(ed.toggleStationTrackLink(station.id, 't2'), true)
  let s = ed.getElement(station.id)
  assert.ok(s && isStation(s))
  assert.deepEqual(s.trackIds, ['t1'])
  ed.undo()
  s = ed.getElement(station.id)
  assert.ok(s && isStation(s))
  assert.deepEqual(s.trackIds, ['t1', 't2'], '撤销应恢复关联')

  assert.equal(ed.toggleStationTrackLink(station.id, 't1'), true)
  s = ed.getElement(station.id)
  assert.ok(s && isStation(s))
  assert.deepEqual(s.trackIds, ['t2'])
  // 无关线路 id 不会被接受。
  assert.equal(ed.toggleStationTrackLink(station.id, 'nope'), false)
})

test('deleting a line drops the station reference instead of leaving a dangling id', () => {
  const ed = new Editor(demoDoc())
  const station = ed.document.elements.find(isStation)!
  assert.deepEqual(station.trackIds, ['t1'])
  const track = ed.document.elements.find(isTrack)!
  ed.setSelection([track.id])
  ed.deleteSelection()
  const after = ed.document.elements.find(isStation)
  assert.ok(after && isStation(after))
  assert.deepEqual(after.trackIds, [], '线路删除后不应残留悬空引用')
})

test('isStationOnTrack measures distance to the polyline, not to vertices', () => {
  const track = { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }
  assert.equal(isStationOnTrack(track, { x: 50, y: 5 }, 6), true, '线段中段应命中')
  assert.equal(isStationOnTrack(track, { x: 50, y: 20 }, 6), false)
  assert.equal(isStationOnTrack(track, { x: 0, y: 0 }, 0), true, '端点应命中')
})

// ─────────── 导出 ───────────

test('export bounds cover every visible element and honour padding', () => {
  const doc = demoDoc()
  const b = computeExportBounds(doc, 0)
  assert.ok(b.minX <= 100 && b.maxX >= 400)
  assert.ok(b.minY <= 80 && b.maxY >= 300)
  const padded = computeExportBounds(doc, 20)
  assert.ok(padded.minX < b.minX && padded.maxX > b.maxX)
})

test('hidden elements and hidden layers are excluded from export bounds', () => {
  const doc = demoDoc()
  const before = computeExportBounds(doc, 0)
  // 全部隐藏时回退到画布尺寸，范围应与内容范围不同。
  doc.layers[0]!.visible = false
  const after = computeExportBounds(doc, 0)
  assert.deepEqual(after, { minX: 0, minY: 0, maxX: doc.canvas.width, maxY: doc.canvas.height })
  assert.notDeepEqual(after, before, '隐藏后范围应变化')
  // 隐藏单个元素时范围应收缩。
  doc.layers[0]!.visible = true
  const label = doc.elements.find((e) => e.type === 'label')!
  label.visible = false
  const shrunk = computeExportBounds(doc, 0)
  assert.ok(shrunk.minY > before.minY, '隐藏顶部文字后上边界应下移')
})

test('rotated labels keep their corners inside the export bounds', () => {
  const doc = createDocument('旋转文字')
  const layerId = doc.layers[0]!.id
  doc.elements.push({ id: 'l', type: 'label', layerId, visible: true, locked: false, text: '长文字标签', x: 100, y: 100, rotation: 90, fontSize: 20 })
  const b = computeExportBounds(doc, 0)
  // 90° 旋转后文字沿 y 展开，maxY 必须明显超过 100。
  assert.ok(b.maxY > 110, `旋转文字应扩展 y 范围，实际 ${b.maxY}`)
  assert.ok(b.maxX - b.minX > 5, '旋转文字应保留 x 方向厚度')
})

test('empty documents fall back to the canvas size instead of producing NaN', () => {
  const b = computeExportBounds(createDocument('空'), 0)
  assert.ok(Number.isFinite(b.minX) && Number.isFinite(b.maxY))
  assert.ok(b.maxX > 0 && b.maxY > 0)
})

test('rendering to canvas draws the document at the requested scale', () => {
  const stub = stubCanvas()
  const doc = demoDoc()
  withStubbedDom(stub.make, () => {
    const canvas = renderDocumentToCanvas(doc, { format: 'png', scale: 2, padding: 10 }) as unknown as { width: number; height: number }
    const b = computeExportBounds(doc, 10)
    assert.equal(canvas.width, Math.round((b.maxX - b.minX) * 2))
    assert.equal(canvas.height, Math.round((b.maxY - b.minY) * 2))
    assert.ok(stub.calls.fill > 0, '应绘制底色')
    assert.ok(stub.calls.stroke > 0, '应绘制线路')
    assert.ok(stub.calls.arcs > 0, '应绘制站点圆圈')
    assert.ok(stub.calls.fillText > 0, '应绘制文字')
  })
})

test('oversized exports are rejected before allocating a huge canvas', () => {
  const doc = demoDoc()
  // scale 被钳制在 16 以内，小文档不应误报超限。
  const stub = stubCanvas()
  withStubbedDom(stub.make, () => {
    assert.doesNotThrow(() => renderDocumentToCanvas(doc, { format: 'png', scale: 16, padding: 0 }))
    assert.equal(stub.state.width, Math.round((computeExportBounds(doc, 0).maxX - computeExportBounds(doc, 0).minX) * 16))
  })
  // 超限判定不需要真实 canvas：必须在分配之前就抛出。
  assert.throws(
    () => renderDocumentToCanvas(doc, { format: 'png', scale: 1, padding: 0, bounds: { minX: 0, minY: 0, maxX: MAX_EXPORT_DIMENSION + 1, maxY: 10 } }),
    /导出尺寸过大/,
  )
  assert.throws(
    () => renderDocumentToCanvas(doc, { format: 'png', scale: 1, padding: 0, bounds: { minX: 0, minY: 0, maxX: MAX_EXPORT_DIMENSION, maxY: MAX_EXPORT_DIMENSION } }),
    /导出尺寸过大/,
  )
  assert.ok(MAX_EXPORT_PIXELS > 0)
})

test('PNG and JPG export produce correctly typed blobs and file names', async () => {
  const doc = demoDoc()
  for (const format of ['png', 'jpg'] as const) {
    const stub = stubCanvas()
    const result = await withStubbedDom(stub.make, () => exportAsImage(doc, { format, scale: 1 }))
    assert.equal(result.blob.type, format === 'jpg' ? 'image/jpeg' : 'image/png')
    assert.ok(result.blob.size > 0)
    assert.ok(result.fileName.endsWith(format === 'jpg' ? '.jpg' : '.png'))
    assert.ok(result.width > 0 && result.height > 0)
  }
})

test('file names strip characters that are illegal in paths', async () => {
  const doc = demoDoc()
  doc.name = 'a/b:c*d?e"f<g>h|i'
  const stub = stubCanvas()
  const result = await withStubbedDom(stub.make, () => exportAsImage(doc, { format: 'png', scale: 1 }))
  assert.ok(!/[\\/:*?"<>|]/.test(result.fileName), `文件名仍含非法字符：${result.fileName}`)
})

test('PDF export emits a structurally valid single-image document', async () => {
  const stub = stubCanvas()
  const result = await withStubbedDom(stub.make, () => exportAsPdf(demoDoc(), { format: 'pdf', scale: 1 }))
  assert.equal(result.blob.type, 'application/pdf')
  assert.ok(result.fileName.endsWith('.pdf'))
  const text = Buffer.from(await result.blob.arrayBuffer()).toString('latin1')
  assert.ok(text.startsWith('%PDF-1.4'), 'PDF 头')
  assert.ok(text.trimEnd().endsWith('%%EOF'), 'PDF 尾')
  assert.ok(text.includes('/Type /Catalog'))
  assert.ok(text.includes('/Type /Page '))
  assert.ok(text.includes('/Subtype /Image'))
  assert.ok(text.includes('/Filter /DCTDecode'), '应内嵌 JPEG')
  assert.ok(text.includes('xref'))
  assert.ok(text.includes('startxref'))
  // startxref 必须指向 xref 表；xref 中每个偏移必须指向对应的 "N 0 obj"。
  const startxref = Number(text.slice(text.lastIndexOf('startxref') + 9).trim().split(/\s/)[0])
  assert.ok(text.startsWith('xref', startxref), `startxref 未指向 xref：${text.slice(startxref, startxref + 10)}`)
  const xrefBody = text.slice(startxref)
  const entries = [...xrefBody.matchAll(/^(\d{10}) 00000 n /gm)].map((m) => Number(m[1]))
  assert.equal(entries.length, 5, '应有 5 个对象')
  entries.forEach((offset, i) => {
    const at = text.slice(offset, offset + 24)
    assert.ok(at.startsWith(`${i + 1} 0 obj`), `对象 ${i + 1} 偏移错误，指向：${JSON.stringify(at)}`)
  })
})

test('a blob encoding failure surfaces as a rejected export, not a silent empty file', async () => {
  const stub = stubCanvas({ failToBlob: true })
  await assert.rejects(
    () => withStubbedDom(stub.make, () => exportAsImage(demoDoc(), { format: 'png', scale: 1 })),
    /画布编码失败/,
  )
})

test('formatBytes renders human readable sizes', () => {
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(2048), '2.0 KB')
  assert.equal(formatBytes(5 * 1024 * 1024), '5.00 MB')
})

test('a station-and-track document exports without error in all three formats', async () => {
  const { createDocument } = await import('../src/editor/model/Document')
  const { createStation } = await import('../src/editor/model/Station')
  const { createTrack } = await import('../src/editor/model/Track')
  const document = createDocument('export-all')
  const layerId = document.layers[0]!.id
  document.elements.push(createTrack({ layerId, points: [{ x: 0, y: 0 }, { x: 600, y: 0 }] }))
  document.elements.push(createStation({ x: 300, y: 0, layerId, kind: 'transfer' }))
  for (const format of ['png', 'jpg', 'pdf'] as const) {
    const stub = stubCanvas()
    const result = format === 'pdf'
      ? await withStubbedDom(stub.make, () => exportAsPdf(document, { format, scale: 1 }))
      : await withStubbedDom(stub.make, () => exportAsImage(document, { format, scale: 1 }))
    assert.ok(result.blob.size > 0, `${format} 导出为空`)
    assert.ok(result.width > 100 && result.height > 10, `${format} 尺寸异常 ${result.width}x${result.height}`)
    if (format === 'pdf') {
      const text = Buffer.from(await result.blob.arrayBuffer()).toString('latin1')
      assert.ok(text.includes('/Subtype /Image'), 'PDF 应内嵌图像')
    }
  }
})
