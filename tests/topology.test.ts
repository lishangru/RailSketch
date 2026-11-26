import test from 'node:test'
import assert from 'node:assert/strict'
import { Editor } from '../src/editor/core/Editor'
import { createDocument, isTrack } from '../src/editor/model/Document'
import { createTrack } from '../src/editor/model/Track'
import { createRailwayNode } from '../src/editor/model/RailwayNode'
import { createDirectionMarker } from '../src/editor/model/DirectionMarker'
import { createLabel } from '../src/editor/model/Label'
import { ensureTrackEndpoints, rebuildNodeConnectivity, validateTopology, splitTrackAtPoint, cutTrackAtPoints, getNeighborNodes, mergeNodes, splitNode } from '../src/editor/topology/Topology'
import { DeleteElementCommand } from '../src/editor/commands/DeleteElementCommand'
import { DeletePointCommand } from '../src/editor/commands/DeletePointCommand'
import { EraserCommand } from '../src/editor/commands/EraserCommand'
import { CompositeCommand } from '../src/editor/commands/CompositeCommand'
import { CommandManager } from '../src/editor/commands/CommandManager'
import { UpdateElementCommand } from '../src/editor/commands/UpdateElementCommand'
import { AddTrackCommand } from '../src/editor/commands/AddTrackCommand'
import { AddElementCommand } from '../src/editor/commands/AddElementCommand'
import { MergeNodesCommand, SplitNodeCommand, ReverseTrackCommand, SplitTrackCommand, ConnectCrossingCommand, DisconnectJunctionCommand, DeleteNodeCommand, InsertVertexCommand, CrossingToSwitchCommand, AddVertexLinkCommand, MoveSegmentCommand } from '../src/editor/commands/TopologyCommands'
import type { Command } from '../src/editor/commands/Command'
import type { Point, TrackElement } from '../src/types'

globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const point = (x: number, y = 0): Point => ({ x, y })
function fixture() {
  const ed = new Editor(createDocument('topology'))
  const track = (points: Point[] = [point(0), point(10), point(20), point(30), point(40)]) => {
    const t = createTrack({ layerId: ed.document.layers[0].id, points })
    ed.document.elements.push(t)
    ensureTrackEndpoints(ed.document, t)
    return t
  }
  const link = (t: TrackElement, index: number) => {
    const n = createRailwayNode(t.points[index], 'switch')
    n.vertexLinks = [{ trackId: t.id, vertexIndex: index }]
    ed.document.nodes.push(n)
    rebuildNodeConnectivity(ed.document)
    return n
  }
  const annotations = (t: TrackElement) => {
    const start = createDirectionMarker({ trackId: t.id, endpoint: 'start', text: 'start', layerId: t.layerId })
    const end = createDirectionMarker({ trackId: t.id, endpoint: 'end', text: 'end', layerId: t.layerId })
    const label = createLabel({ x: 0, y: 0, text: 'name', layerId: t.layerId })
    t.labelId = label.id
    t.labelText = label.text
    ed.document.elements.push(start, end, label)
    return { start, end, label }
  }
  return { ed, track, link, annotations }
}
function valid(ed: Editor) {
  assert.deepEqual(validateTopology(ed.document), [])
  const ids = new Set(ed.document.nodes.map(n => n.id))
  assert.equal(ids.size, ed.document.nodes.length)
  for (const n of ed.document.nodes) for (const l of n.vertexLinks) {
    const t = ed.document.elements.find(e => e.id === l.trackId) as TrackElement
    assert.deepEqual(t.points[l.vertexIndex], point(n.x, n.y))
    assert.ok(n.connectedTrackIds.includes(l.trackId))
  }
  for (const el of ed.document.elements) {
    if (el.type === 'direction-marker') assert.ok(ed.document.elements.some(t => isTrack(t) && t.id === el.trackId))
    if (isTrack(el) && el.labelId) assert.ok(ed.document.elements.some(l => l.type === 'label' && l.id === el.labelId))
  }
  for (const c of ed.document.crossings) for (const id of [c.trackAId, c.trackBId]) assert.ok(ed.document.elements.some(t => isTrack(t) && t.id === id))
}
function roundtrip(ed: Editor, command: Command, check = () => valid(ed)) {
  const before = clone(ed.document)
  command.execute()
  check()
  const after = clone(ed.document)
  for (let i = 0; i < 3; i++) {
    command.undo()
    assert.deepEqual(clone(ed.document), before)
    valid(ed)
    command.execute()
    assert.deepEqual(clone(ed.document), after)
    check()
  }
}

test('delete track/node preserves dependent references and undo restores record order', () => {
  for (const node of [false, true]) {
    const { ed, track, link, annotations } = fixture()
    const t = track(); link(t, 2)
    const other = track([point(20, -10), point(20, 10)])
    const { start, end, label } = annotations(t)
    ed.document.crossings.push({ id: 'cross', trackAId: t.id, trackBId: other.id, point: point(20), mode: 'bridge-a-over-b' })
    roundtrip(ed, node ? new DeleteNodeCommand(ed, t.startNodeId!) : new DeleteElementCommand(ed, t.id), () => {
      valid(ed)
      for (const id of [t.id, start.id, end.id, label.id]) assert.equal(ed.getElement(id), undefined)
      assert.ok(ed.getElement(other.id))
      assert.equal(ed.document.crossings.length, 0)
    })
  }
})

test('deleting a label clears track reference reversibly', () => {
  const { ed, track, annotations } = fixture(); const t = track(); const { label } = annotations(t)
  roundtrip(ed, new DeleteElementCommand(ed, label.id), () => {
    assert.equal((ed.getElement(t.id) as TrackElement).labelId, undefined)
    valid(ed)
  })
})

test('deleting an endpoint restores pruned node and remains symmetric after repeated redo', () => {
  const { ed, track, link } = fixture(); const t = track(); link(t, 3)
  roundtrip(ed, new DeletePointCommand(ed, t.id, 0))
})

test('erase middle remaps references without duplicate nodes and preserves geometry-only crossings', () => {
  const { ed, track, link, annotations } = fixture(); const t = track(); link(t, 1); link(t, 3)
  const unrelated = track([point(10, -10), point(10, 10)])
  const { start, end, label } = annotations(t)
  ed.document.crossings.push({ id: 'cross', trackAId: t.id, trackBId: unrelated.id, point: point(10), mode: 'bridge-a-over-b' })
  const host = { document: ed.document, invalidate() {}, findEraserHits: () => ({ spans: [{ elementId: t.id, from: 1, to: 2 }], deleteIds: [] }) }
  roundtrip(ed, new EraserCommand(host, []), () => {
    valid(ed)
    assert.equal(ed.document.elements.filter(isTrack).length, 3)
    assert.ok(ed.getElement(start.id)); assert.ok(ed.getElement(end.id)); assert.ok(ed.getElement(label.id))
    assert.equal(ed.document.elements.filter(isTrack).filter(t => t.labelId === label.id).length, 1)
    assert.equal(ed.document.crossings.length, 1)
  })
})

test('reverse remaps vertex links and keeps markers at the same physical endpoint', () => {
  const { ed, track, link, annotations } = fixture(); const t = track(); const n = link(t, 1); const { start } = annotations(t)
  roundtrip(ed, new ReverseTrackCommand(ed, t.id), () => {
    valid(ed)
    assert.equal(ed.document.nodes.find(x => x.id === n.id)!.vertexLinks[0].vertexIndex, 3)
    assert.equal((ed.getElement(start.id) as typeof start).endpoint, 'end')
  })
})

test('split at existing vertex has no duplicate segment and remaps links and annotations', () => {
  const { ed, track, link, annotations } = fixture(); const t = track(); link(t, 1); link(t, 3); annotations(t)
  roundtrip(ed, new SplitTrackCommand(ed, t.id, point(20)), () => {
    valid(ed)
    const tracks = ed.document.elements.filter(isTrack)
    assert.deepEqual(tracks.map(t => t.points), [[point(0), point(10), point(20)], [point(20), point(30), point(40)]])
  })
})

test('cut suffix binds shortened endpoint to the actual cut point', () => {
  const { ed, track, link, annotations } = fixture(); const t = track(); link(t, 1); annotations(t)
  const { pieces } = cutTrackAtPoints(ed.document, t, [point(15), point(40)])
  ed.document.elements = ed.document.elements.filter(e => e.id !== t.id).concat(pieces)
  rebuildNodeConnectivity(ed.document)
  assert.deepEqual(pieces[0].points, [point(0), point(10), point(15)])
  valid(ed)
})

test('neighbors include internal vertex-linked nodes in both directions', () => {
  const { ed, track, link } = fixture(); const t = track(); const n = link(t, 2)
  assert.ok(getNeighborNodes(ed.document, t.startNodeId!).some(x => x.id === n.id))
  assert.ok(getNeighborNodes(ed.document, n.id).some(x => x.id === t.startNodeId))
})

test('merge and split nodes transfer internal links and self merge is a no-op', () => {
  const { ed, track, link } = fixture(); const a = track(); const b = track(); const n = link(a, 2); const m = link(b, 2)
  mergeNodes(ed.document, n.id, m.id)
  assert.equal(m.vertexLinks.length, 2)
  valid(ed)
  const split = splitNode(ed.document, m.id, [a.id])!
  assert.deepEqual(split.vertexLinks, [{ trackId: b.id, vertexIndex: 2 }])
  valid(ed)
  const before = clone(ed.document)
  mergeNodes(ed.document, m.id, m.id)
  assert.deepEqual(clone(ed.document), before)
})

test('insert reuses existing vertex without shifting existing links', () => {
  const { ed, track, link } = fixture(); const t = track(); const n = link(t, 3)
  roundtrip(ed, new InsertVertexCommand(ed, t.id, point(20)), () => {
    valid(ed)
    assert.equal(ed.document.nodes.find(x => x.id === n.id)!.vertexLinks[0].vertexIndex, 3)
    assert.equal((ed.getElement(t.id) as TrackElement).points.length, 5)
  })
})

test('adding an existing vertex link is undo-safe', () => {
  const { ed, track, link } = fixture(); const t = track(); const n = link(t, 2)
  roundtrip(ed, new AddVertexLinkCommand(ed, n.id, t.id, 2))
})

test('crossing-to-switch shifts pre-existing vertex links and removes only the chosen crossing', () => {
  const { ed, track, link } = fixture(); const a = track(); link(a, 3)
  const b = track([point(15, -10), point(15, 10), point(35, 10), point(35, -10)])
  ed.document.crossings.push({ id: 'first', trackAId: a.id, trackBId: b.id, point: point(15), mode: 'plain' }, { id: 'second', trackAId: a.id, trackBId: b.id, point: point(35), mode: 'bridge-b-over-a' })
  roundtrip(ed, new CrossingToSwitchCommand(ed, a.id, b.id, point(15)), () => { valid(ed); assert.deepEqual(ed.document.crossings.map(c => c.id), ['second']) })
})

test('connect crossing undo does not remove unrelated tracks and redo has stable IDs', () => {
  const { ed, track, link, annotations } = fixture(); const a = track(); link(a, 1); annotations(a)
  const b = track([point(20, -10), point(20, 10)]); const other = track([point(50), point(60)])
  roundtrip(ed, new ConnectCrossingCommand(ed, a.id, b.id, point(20)), () => { valid(ed); assert.ok(ed.getElement(other.id)) })
})

test('disconnect junction preserves unrelated tracks, geometry, links and undo', () => {
  const { ed, track, link, annotations } = fixture()
  const a = track([point(0, 10), point(10, 10), point(20, 20)])
  const b = track([point(10, 0), point(10, 10), point(0, 20)])
  const other = track([point(50), point(60)]); annotations(a); link(a, 0)
  const connection = new ConnectCrossingCommand(ed, a.id, b.id, point(10, 10)); connection.execute()
  const junction = ed.document.nodes.find(n => n.connectedTrackIds.length === 4)!
  roundtrip(ed, new DisconnectJunctionCommand(ed, junction.id), () => {
    valid(ed); assert.ok(ed.getElement(other.id))
    assert.ok(ed.document.elements.filter(isTrack).filter(t => t.id !== other.id).every(t => t.points.some(p => p.x === 10 && p.y === 10)))
  })
})

test('segment movement follows internal node links and undo restores neighbor geometry', () => {
  const { ed, track, link } = fixture(); const a = track(); const n = link(a, 2)
  track([point(20), point(20, 20)]).startNodeId = n.id
  rebuildNodeConnectivity(ed.document)
  roundtrip(ed, new MoveSegmentCommand(ed, a.id, 1, point(0, 5)))
})

test('property patch snapshots are independent from live drag mutations', () => {
  const { ed, track } = fixture(); const t = track(); const before = clone(t.points)
  const target = [point(1), point(11), point(21), point(31), point(41)]
  const cmd = new UpdateElementCommand(ed, t.id, { points: target })
  cmd.execute(); t.points[0].x = 200; cmd.undo()
  assert.deepEqual(t.points, before)
  t.points[0].x = 300; cmd.execute()
  assert.deepEqual(t.points, target)
  cmd.undo(); assert.deepEqual(t.points, before)
})

test('node merge/split commands preserve order and stable redo references', () => {
  const { ed, track, link } = fixture(); const a = track(); const b = track(); const n = link(a, 2); const m = link(b, 2)
  roundtrip(ed, new MergeNodesCommand(ed, n.id, m.id))
  roundtrip(ed, new SplitNodeCommand(ed, m.id, [a.id]))
})

test('creation commands do not share stored snapshots with live elements', () => {
  const { ed } = fixture()
  const t = createTrack({ points: [point(0), point(10)], layerId: ed.document.layers[0].id })
  const command = new AddTrackCommand(ed, t)
  command.execute(); (ed.getElement(t.id) as TrackElement).points[0].x = 99
  command.undo(); command.execute()
  assert.deepEqual((ed.getElement(t.id) as TrackElement).points, [point(0), point(10)])
  const label = createLabel({ x: 0, y: 0, text: 'original', layerId: t.layerId })
  const add = new AddElementCommand(ed, label)
  add.execute(); (ed.getElement(label.id) as typeof label).text = 'changed'
  add.undo(); add.execute()
  assert.equal((ed.getElement(label.id) as typeof label).text, 'original')
})

test('composite execute rolls back completed children and keeps command history', () => {
  const state: number[] = []
  const first = { label: 'first', execute() { state.push(1) }, undo() { state.pop() } }
  const fail = { label: 'failure', execute() { throw new Error('execute failed') }, undo() {} }
  const manager = new CommandManager()
  assert.throws(() => manager.execute(new CompositeCommand('transaction', [first, fail])), /execute failed/)
  assert.deepEqual(state, [])
  assert.equal(manager.canUndo, false)
})

test('composite undo rolls forward completed children and failed undo/redo retain history', () => {
  const state: number[] = []
  let failUndo = true; let failRedo = false
  const a = { label: 'a', execute() { if (failRedo) throw new Error('redo failed'); state.push(1) }, undo() { if (failUndo) throw new Error('undo failed'); state.pop() } }
  const b = { label: 'b', execute() { state.push(2) }, undo() { state.pop() } }
  const manager = new CommandManager(); manager.execute(new CompositeCommand('transaction', [a, b]))
  assert.throws(() => manager.undo(), /undo failed/); assert.deepEqual(state, [1, 2]); assert.equal(manager.canUndo, true)
  failUndo = false; manager.undo(); assert.deepEqual(state, [])
  failRedo = true; assert.throws(() => manager.redo(), /redo failed/); assert.equal(manager.canRedo, true)
  failRedo = false; manager.redo(); assert.deepEqual(state, [1, 2])
})
