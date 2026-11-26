import test from 'node:test'
import assert from 'node:assert/strict'
import { Editor } from '../src/editor/core/Editor'
import { createDocument, isTrack } from '../src/editor/model/Document'
import { createLine } from '../src/editor/model/Line'
import { createLabel } from '../src/editor/model/Label'
import { createLayer } from '../src/editor/model/Layer'
import { GridRenderer } from '../src/editor/render/GridRenderer'
import { Camera } from '../src/editor/core/Camera'

function editor(): Editor {
  return new Editor(createDocument('regression'))
}

test('deleting multiple elements is a single undoable operation', () => {
  const ed = editor()
  const a = createLabel({ layerId: '', text: 'a', x: 0, y: 0 })
  const b = createLabel({ layerId: '', text: 'b', x: 100, y: 0 })
  ed.addElement(a)
  ed.addElement(b)
  ed.setSelection([a.id, b.id])
  ed.deleteSelection()
  assert.equal(ed.document.elements.length, 0)
  assert.equal(ed.undo(), true)
  assert.deepEqual(new Set(ed.document.elements.map((el) => el.id)), new Set([a.id, b.id]))
  ed.redo()
  assert.equal(ed.document.elements.length, 0)
})

test('multiple control points are deleted in descending index order without duplicates', () => {
  const ed = editor()
  const line = createLine({ layerId: '', points: [0, 100, 200, 300, 400].map((x) => ({ x, y: 0 })) })
  ed.addElement(line)
  ed.setSelectedPoints([{ elementId: line.id, index: 1 }, { elementId: line.id, index: 2 }, { elementId: line.id, index: 2 }])
  ed.deleteSelection()
  assert.deepEqual((ed.getElement(line.id) as typeof line).points.map((p) => p.x), [0, 300, 400])
  ed.undo()
  assert.deepEqual((ed.getElement(line.id) as typeof line).points.map((p) => p.x), [0, 100, 200, 300, 400])
})

test('hidden layers are excluded from hit testing, snapping, marquee and erasing', () => {
  const ed = editor()
  ed.commitTrack([{ x: 0, y: 0 }, { x: 100, y: 0 }])
  ed.document.layers[0]!.visible = false
  assert.equal(ed.hitTestControlPoint({ x: 0, y: 0 }), null)
  assert.equal(ed.hitTestNode({ x: 0, y: 0 }), null)
  assert.equal(ed.getAllTrackPoints().length, 0)
  assert.equal(ed.findEraserHits([{ x: 50, y: -10 }, { x: 50, y: 10 }]).spans.length, 0)
  ed.selectInRect({ x0: -10, y0: -10, x1: 110, y1: 10 }, false)
  assert.deepEqual(ed.selectionIds, [])
})

test('locked track nodes cannot be hit or joined by a newly drawn track', () => {
  const ed = editor()
  ed.commitTrack([{ x: 0, y: 0 }, { x: 100, y: 0 }])
  const track = ed.document.elements.find(isTrack)!
  track.locked = true
  assert.equal(ed.hitTestNode({ x: 0, y: 0 }), null)
  ed.commitTrack([{ x: 0, y: 0 }, { x: 0, y: 100 }])
  const next = ed.document.elements.filter(isTrack)[1]!
  assert.notEqual(next.startNodeId, track.startNodeId)
})

test('replacing a document cancels previews before swapping same-ID elements', () => {
  const ed = editor()
  const line = createLine({ layerId: '', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] })
  ed.addElement(line)
  ed.drag.beginPointDrag(line.id, 0)
  ed.drag.move({ x: 20, y: 20 })
  const next = createDocument('replacement')
  next.elements.push({ ...createLine({ layerId: '', points: [{ x: 300, y: 300 }, { x: 400, y: 300 }] }), id: line.id })
  ed.setDocument(next)
  assert.deepEqual((ed.getElement(line.id) as typeof line).points[0], { x: 300, y: 300 })
  assert.equal(ed.drag.isDragging, false)
})

test('editing an existing track label also updates its cached text', () => {
  const ed = editor()
  ed.commitTrack([{ x: 0, y: 0 }, { x: 100, y: 0 }])
  const track = ed.document.elements.find(isTrack)!
  ed.setTrackLabel(track.id, 'old')
  ed.setTrackLabel(track.id, 'new')
  assert.equal(ed.getElement(track.id)?.type, 'track')
  assert.equal((ed.getElement(track.id) as typeof track).labelText, 'new')
  ed.undo()
  assert.equal((ed.getElement(track.id) as typeof track).labelText, 'old')
})

test('deleting a layer restores the layer and all memberships in one undo', () => {
  const ed = editor()
  const layer = ed.document.layers[0]!
  const next = createLayer('next')
  ed.document.layers.push(next)
  const a = createLabel({ x: 0, y: 0, layerId: layer.id, text: 'a' })
  const b = createLabel({ x: 0, y: 0, layerId: layer.id, text: 'b' })
  ed.addElement(a)
  ed.addElement(b)
  ed.state.activeLayerId = layer.id
  ed.removeLayer(layer.id)
  assert.equal(ed.document.layers.length, 1)
  assert.ok(ed.document.elements.every((el) => el.layerId === next.id))
  ed.undo()
  assert.equal(ed.document.layers.length, 2)
  assert.ok(ed.document.elements.every((el) => el.layerId === layer.id))
  assert.equal(ed.state.activeLayerId, layer.id)
  ed.redo()
  assert.equal(ed.document.layers.length, 1)
})

test('new geometry cannot be created on a hidden or locked active layer', () => {
  const ed = editor()
  ed.state.activeLayerId = ed.document.layers[0]!.id
  ed.document.layers[0]!.locked = true
  ed.commitTrack([{ x: 0, y: 0 }, { x: 100, y: 0 }])
  ed.commitLine([{ x: 0, y: 0 }, { x: 100, y: 0 }])
  ed.commitLabel('hidden', { x: 0, y: 0 })
  ed.commitPlatform({ x: 0, y: 0 }, { x: 100, y: 0 })
  assert.equal(ed.document.elements.length, 0)
})

test('non-finite and oversized creation inputs cannot mutate the document', () => {
  const ed = editor()
  ed.commitTrack([{ x: NaN, y: 0 }, { x: 100, y: 0 }])
  ed.commitLine([{ x: 0, y: Infinity }, { x: 100, y: 0 }])
  ed.commitPlatform({ x: 0, y: 0 }, { x: Infinity, y: 0 })
  assert.equal(ed.document.elements.length, 0)
  ed.commitTrack([{ x: 0, y: 0 }, { x: 100, y: 0 }])
  const track = ed.document.elements.find(isTrack)!
  const before = ed.toJSON()
  assert.equal(ed.createParallelTracks(track.id, Infinity, 20, 'right'), 0)
  assert.equal(ed.createParallelTracks(track.id, 1, NaN, 'right'), 0)
  ed.createBatchLayout([{ type: 'tracks', count: Infinity }], { length: 100, rowSpacing: 80, trackSpacing: 24, platformWidth: 16 })
  assert.equal(ed.toJSON(), before)
})

test('camera rejects non-finite transforms', () => {
  const camera = new Camera()
  const before = { ...camera }
  camera.setTransform(NaN, 0, 0)
  camera.zoomAt({ x: 10, y: 10 }, NaN)
  camera.panBy(Infinity, 0)
  assert.deepEqual({ ...camera }, before)
})

test('grid rendering stays bounded for extreme world coordinates', () => {
  const camera = new Camera()
  camera.offsetX = 1e30
  camera.offsetY = 1e30
  let lines = 0
  const ctx = new Proxy({}, { get: (_, key) => key === 'moveTo' ? () => { if (++lines > 10000) throw new Error('unbounded grid') } : () => {}, set: () => true }) as CanvasRenderingContext2D
  new GridRenderer().render(ctx, camera, 800, 600, 20)
  assert.ok(lines <= 10000)
})
