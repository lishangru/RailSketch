import test from 'node:test'
import assert from 'node:assert/strict'
import { Editor } from '../src/editor/core/Editor'
import { createDocument, isTrack } from '../src/editor/model/Document'
import { createTrack } from '../src/editor/model/Track'
import { CrossingRenderer } from '../src/editor/render/CrossingRenderer'

function fixture() {
  const doc = createDocument()
  const layerId = doc.layers[0]!.id
  const a = createTrack({ layerId, points: [{ x: 0, y: 50 }, { x: 200, y: 50 }] })
  const b = createTrack({ layerId, points: [{ x: 50, y: 0 }, { x: 50, y: 100 }, { x: 150, y: 100 }, { x: 150, y: 0 }] })
  doc.elements.push(a, b)
  return { ed: new Editor(doc), a, b }
}

test('crossing styles are independent for multiple intersections and undoable', () => {
  const { ed, a, b } = fixture()
  ed.setCrossingMode(a.id, b.id, { x: 50, y: 50 }, 'bridge-a-over-b')
  ed.setCrossingMode(a.id, b.id, { x: 150, y: 50 }, 'bridge-b-over-a')
  assert.equal(ed.document.crossings.length, 2)
  ed.undo()
  assert.equal(ed.document.crossings.length, 1)
  ed.redo()
  assert.equal(ed.document.crossings.length, 2)
  ed.setCrossingMode(b.id, a.id, { x: 50, y: 50 }, 'bridge-a-over-b')
  assert.equal(ed.document.crossings[0]!.mode, 'bridge-b-over-a')
})

test('crossing renderer honors record orientation rather than array order', () => {
  const { ed, a, b } = fixture()
  ed.setCrossingMode(b.id, a.id, { x: 50, y: 50 }, 'bridge-a-over-b')
  const calls: { point: { x: number; y: number }; lower: typeof a }[] = []
  const renderer = new CrossingRenderer()
  Object.assign(renderer, { drawLowerGap: (_ctx: unknown, point: { x: number; y: number }, lower: typeof a) => calls.push({ point, lower }) })
  const ctx = new Proxy({}, { get: () => () => {}, set: () => true }) as CanvasRenderingContext2D
  renderer.render(ctx, ed.camera, ed.document, ed.state)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.lower.id, a.id)
})

test('hidden tracks do not produce crossing marks or gaps', () => {
  const { ed, a, b } = fixture()
  ed.setCrossingMode(a.id, b.id, { x: 50, y: 50 }, 'bridge-a-over-b')
  ed.document.elements.find((el) => el.id === a.id)!.visible = false
  let marks = 0
  const ctx = new Proxy({}, { get: (_, key) => key === 'stroke' ? () => { marks++ } : () => {}, set: () => true }) as CanvasRenderingContext2D
  new CrossingRenderer().render(ctx, ed.camera, ed.document, ed.state)
  assert.equal(marks, 0)
})

test('angle edits preserve node geometry and independent batch track locations', () => {
  const ed = new Editor(createDocument())
  ed.commitTrack([{ x: 0, y: 0 }, { x: 100, y: 0 }])
  ed.commitTrack([{ x: 300, y: 200 }, { x: 400, y: 200 }])
  const tracks = ed.document.elements.filter(isTrack)
  const before = ed.toJSON()
  ed.setTrackAngle(tracks.map((track) => track.id), 90)
  assert.equal(ed.getTopologyIssues().length, 0)
  assert.ok(Math.abs(tracks[0]!.points[0]!.x - 50) < 1e-6)
  assert.ok(Math.abs(tracks[1]!.points[0]!.x - 350) < 1e-6)
  ed.undo()
  assert.equal(ed.toJSON(), before)
  ed.redo()
  assert.equal(ed.getTopologyIssues().length, 0)
})
