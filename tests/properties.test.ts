import test from 'node:test'
import assert from 'node:assert/strict'
import type { DiagramElement } from '../src/types'
import { Editor } from '../src/editor/core/Editor'
import { createDocument } from '../src/editor/model/Document'
import { createPlatform } from '../src/editor/model/Platform'
import { parseDocument } from '../src/editor/serialization/serializer'

function platforms() {
  const doc = createDocument()
  const layerId = doc.layers[0]!.id
  const a = createPlatform({ layerId, start: { x: 0, y: 0 }, end: { x: 100, y: 0 } })
  const b = createPlatform({ layerId, start: { x: 300, y: 200 }, end: { x: 500, y: 200 } })
  doc.elements.push(a, b)
  return { ed: new Editor(doc), a, b }
}

test('batch platform angle edits preserve each center and length across undo and redo', () => {
  const { ed, a, b } = platforms()
  const before = ed.toJSON()
  ed.setPlatformAngle([a.id, b.id, a.id], 90)
  assert.ok(Math.abs(a.start.x - 50) < 1e-6)
  assert.ok(Math.abs(a.start.y + 50) < 1e-6)
  assert.ok(Math.abs(b.start.x - 400) < 1e-6)
  assert.ok(Math.abs(b.start.y - 100) < 1e-6)
  assert.ok(Math.abs(Math.hypot(b.end.x - b.start.x, b.end.y - b.start.y) - 200) < 1e-6)
  assert.equal(parseDocument(ed.toJSON()).ok, true)
  const after = ed.toJSON()
  ed.undo()
  assert.equal(ed.toJSON(), before)
  assert.equal(ed.commands.canUndo, false)
  ed.redo()
  assert.equal(ed.toJSON(), after)
})

test('platform angle edits reject invalid values and skip locked or out-of-bounds geometry', () => {
  const { ed, a, b } = platforms()
  b.locked = true
  const before = ed.toJSON()
  for (const value of [NaN, Infinity, -Infinity]) ed.setPlatformAngle([a.id, b.id], value)
  assert.equal(ed.toJSON(), before)
  assert.equal(ed.commands.canUndo, false)
  ed.setPlatformAngle([a.id, b.id], 90)
  assert.deepEqual(b.start, { x: 300, y: 200 })
  ed.undo()
  a.start = { x: -100, y: 1_000_000 }
  a.end = { x: 100, y: 1_000_000 }
  const boundary = ed.toJSON()
  ed.setPlatformAngle([a.id], 90)
  assert.equal(ed.toJSON(), boundary)
})

test('property numeric limits reject values outside the import boundary without adding history', () => {
  const { ed, a } = platforms()
  const before = ed.toJSON()
  const invalid: Partial<DiagramElement>[] = [
    { strokeWidth: 1001 }, { strokeWidth: NaN }, { width: 10001 }, { width: Infinity },
    { spacing: 10001 }, { cornerRadius: 10001 }, { bridgeGap: 10001 },
    { offset: 10001 }, { offset: -10001 }, { textOffset: -10001 },
    { arrowSize: 1001 }, { fontSize: 201 }, { rotation: Infinity },
  ]
  for (const patch of invalid) ed.updateElementProperties([a.id], patch)
  assert.equal(ed.toJSON(), before)
  assert.equal(ed.commands.canUndo, false)
})

test('accepted property boundaries round-trip and batch changes undo in one step', () => {
  const { ed, a, b } = platforms()
  const before = ed.toJSON()
  ed.updateElementProperties([a.id, b.id, a.id], { width: 10000 })
  assert.equal(a.width, 10000)
  assert.equal(b.width, 10000)
  assert.equal(parseDocument(ed.toJSON()).ok, true)
  ed.undo()
  assert.equal(ed.toJSON(), before)
  assert.equal(ed.commands.canUndo, false)
  b.locked = true
  ed.updateElementProperties([a.id, b.id], { width: 100 })
  assert.equal(a.width, 100)
  assert.equal(b.width, 12)
})
