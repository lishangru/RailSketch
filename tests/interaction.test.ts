import test from 'node:test'
import assert from 'node:assert/strict'
import type { DiagramElement, Point, RailDocument, RailwayNode, TrackElement } from '../src/types'
import type { Editor } from '../src/editor/core/Editor'
import { EditorState } from '../src/editor/core/EditorState'
import { CommandManager } from '../src/editor/commands/CommandManager'
import { MergeNodesCommand } from '../src/editor/commands/TopologyCommands'
import type { Command } from '../src/editor/commands/Command'
import { createDocument } from '../src/editor/model/Document'
import { createTrack } from '../src/editor/model/Track'
import { createLine } from '../src/editor/model/Line'
import { createPlatform } from '../src/editor/model/Platform'
import { createLabel } from '../src/editor/model/Label'
import { createRailwayNode } from '../src/editor/model/RailwayNode'
import { ensureTrackEndpoints, moveNodeTo, rebuildNodeConnectivity, validateTopology } from '../src/editor/topology/Topology'
import { DragController } from '../src/editor/interaction/DragController'
import { NodeController } from '../src/editor/interaction/NodeController'
import { SegmentController } from '../src/editor/interaction/SegmentController'
import { PointerController } from '../src/editor/interaction/PointerController'
import { PanController } from '../src/editor/interaction/PanController'
import { DrawTrackController } from '../src/editor/interaction/DrawTrackController'
import { SelectionController } from '../src/editor/interaction/SelectionController'
import { SwitchController } from '../src/editor/interaction/SwitchController'
import { EraserController } from '../src/editor/interaction/EraserController'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

/** A DOM-free Editor host: use the real controllers and command stack. */
function makeEditor(document: RailDocument) {
  const host = {
    document,
    state: new EditorState(),
    commands: new CommandManager(),
    camera: { zoom: 1 },
    spacePan: false,
    isAngleSnapActive: false,
    snapPoint: null,
    alignmentGuide: null,
    drawPreview: [] as Point[],
    switchDraft: null,
    marqueeRect: null,
    hoverControl: null,
    eraserStroke: [] as Point[],
    eraserHitIds: [] as string[],
    eraserSpans: [],
    erased: 0,
    rectSelections: 0,
    cursor: 'default',
    invalidate() {},
    setCursor(cursor: string) { this.cursor = cursor },
    setMouseScreen(_point: Point) {},
    screenToWorld(point: Point) { return point },
    panBy(_dx: number, _dy: number) {},
    updateHover(_point: Point) {},
    getElement(id: string) { return this.document.elements.find((el) => el.id === id) },
    isSelectable(el: DiagramElement) {
      const layer = this.document.layers.find((item) => item.id === el.layerId)
      return el.visible && !el.locked && layer?.visible !== false && layer?.locked !== true
    },
    isNodeEditable(node: RailwayNode) {
      return node.connectedTrackIds.length > 0 && node.connectedTrackIds.every((id) => {
        const track = this.getElement(id)
        return !!track && this.isSelectable(track)
      })
    },
    findEditableNodeNear(point: Point, radius: number, excludeId?: string) {
      let best: RailwayNode | undefined
      for (const node of this.document.nodes) {
        const distance = Math.hypot(point.x - node.x, point.y - node.y)
        if (node.id !== excludeId && this.isNodeEditable(node) && distance <= radius) {
          best = node
          radius = distance
        }
      }
      return best
    },
    setSelection(ids: string[]) { this.state.setSelection(ids) },
    clearSelection() { this.state.setSelection([]) },
    setSelectedPoints(points: { elementId: string; index: number }[]) { this.state.selectedPoints = points },
    getSnapPoint(point: Point) { return { point: { ...point } } },
    moveBoundNode(id: string, point: Point) { moveNodeTo(this.document, id, point) },
    executeCommand(command: Command) { this.commands.execute(command) },
    mergeNodesCommand(source: string, target: string) {
      this.executeCommand(new MergeNodesCommand(editor, source, target))
    },
    hitTestNode: (_point: Point): RailwayNode | null => null,
    hitTestSegment: (_point: Point): { track: TrackElement; index: number } | null => null,
    hitTestMarkerLabel: (_point: Point): DiagramElement | null => null,
    hitTestControlPoint: (_point: Point): { element: TrackElement; index: number } | null => null,
    hitTestPlatformEndpoint: (_point: Point) => null,
    hitTest: (_point: Point) => null,
    findEraserHits: (_stroke: Point[]) => ({ spans: [], deleteIds: [] }),
    executeEraser(_stroke: Point[]) { this.erased += 1 },
    selectInRect() { this.rectSelections += 1 },
  }
  const editor = host as unknown as Editor
  return Object.assign(host, {
    drag: new DragController(editor),
    nodeController: new NodeController(editor),
    segmentController: new SegmentController(editor),
    pointer: new PointerController(editor),
    pan: new PanController(editor),
    drawTrack: new DrawTrackController(editor),
    selectionController: new SelectionController(editor),
    switchController: new SwitchController(editor),
    eraser: new EraserController(editor),
  })
}

function track(doc: RailDocument, id: string, points: Point[]): TrackElement {
  const value = createTrack({ layerId: doc.layers[0].id, points })
  value.id = id
  doc.elements.push(value)
  return value
}

function sharedFixture(internal = false) {
  const doc = createDocument()
  const main = track(doc, 'main', internal
    ? [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }]
    : [{ x: 0, y: 0 }, { x: 100, y: 0 }])
  const anchor = { x: internal ? 50 : 0, y: 0 }
  const branch = track(doc, 'branch', [anchor, { x: anchor.x, y: 100 }])
  const node = createRailwayNode(anchor, 'switch')
  node.id = 'shared'
  branch.startNodeId = node.id
  if (internal) node.vertexLinks = [{ trackId: main.id, vertexIndex: 1 }]
  else main.startNodeId = node.id
  doc.nodes.push(node)
  for (const item of [main, branch]) ensureTrackEndpoints(doc, item)
  rebuildNodeConnectivity(doc)
  return { doc, main, branch, node, editor: makeEditor(doc) }
}

function assertGeometry(doc: RailDocument): void {
  assert.deepEqual(validateTopology(doc), [])
  for (const node of doc.nodes) {
    for (const link of node.vertexLinks) {
      const item = doc.elements.find((el): el is TrackElement => el.type === 'track' && el.id === link.trackId)
      assert.ok(item)
      assert.deepEqual(item.points[link.vertexIndex], { x: node.x, y: node.y })
    }
  }
}

class FakeCanvas {
  private listeners = new Map<string, Set<(event: PointerEvent) => void>>()
  captures = new Set<number>()
  addEventListener(type: string, listener: (event: PointerEvent) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(listener)
  }
  removeEventListener(type: string, listener: (event: PointerEvent) => void) { this.listeners.get(type)?.delete(listener) }
  contains(target: unknown) { return target === this }
  focus() {}
  getBoundingClientRect() { return { left: 0, top: 0 } }
  setPointerCapture(id: number) { this.captures.add(id) }
  hasPointerCapture(id: number) { return this.captures.has(id) }
  releasePointerCapture(id: number) { this.captures.delete(id) }
  emit(type: string, x = 0, y = 0, pointerId = 1) {
    const event = { clientX: x, clientY: y, pointerId, button: 0, target: this, ctrlKey: false, metaKey: false, preventDefault() {} } as unknown as PointerEvent
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

function bindPointer(editor: ReturnType<typeof makeEditor>): FakeCanvas {
  const canvas = new FakeCanvas()
  editor.pointer.bind(canvas as unknown as HTMLCanvasElement)
  return canvas
}

test('node merge undo restores geometry from before the drag, including redo cycles', () => {
  const { doc, main, editor } = sharedFixture()
  const before = clone(doc)
  const source = doc.nodes.find((node) => node.id === main.endNodeId)!
  const target = doc.nodes.find((node) => node.id === main.startNodeId)!
  editor.hitTestNode = () => source
  editor.nodeController.pointerDown(source)
  editor.nodeController.move(target)
  editor.nodeController.finish()
  assertGeometry(doc)
  assert.equal(editor.commands.undo(), true)
  assert.deepEqual(clone(doc.elements), before.elements)
  assert.deepEqual(doc.nodes.find((node) => node.id === source.id), before.nodes.find((node) => node.id === source.id))
  assertGeometry(doc)
  editor.commands.redo()
  editor.commands.undo()
  assert.deepEqual(clone(doc.elements), before.elements)
})

test('segment cancel restores shared endpoint coordinates and all connected tracks', () => {
  const { doc, main, editor } = sharedFixture()
  const before = clone(doc)
  editor.hitTestSegment = () => ({ track: main, index: 0 })
  editor.segmentController.pointerDown({ x: 50, y: 0 })
  editor.segmentController.move({ x: 50, y: 20 })
  editor.segmentController.cancel()
  assert.deepEqual(clone(doc), before)
  assert.equal(editor.commands.canUndo, false)
  assertGeometry(doc)
})

test('segment drag synchronizes internal vertexLinks and cancel restores them', () => {
  const { doc, main, branch, node, editor } = sharedFixture(true)
  const before = clone(doc)
  editor.hitTestSegment = () => ({ track: main, index: 0 })
  editor.segmentController.pointerDown({ x: 25, y: 0 })
  editor.segmentController.move({ x: 25, y: 20 })
  assert.equal(node.y, 20)
  assert.equal(branch.points[0].y, 20)
  assertGeometry(doc)
  editor.segmentController.cancel()
  assert.deepEqual(clone(doc), before)
})

test('segment finish does not apply the preview delta twice and remains undoable', () => {
  const { doc, main, editor } = sharedFixture(true)
  const before = clone(doc)
  editor.hitTestSegment = () => ({ track: main, index: 0 })
  editor.segmentController.pointerDown({ x: 25, y: 0 })
  editor.segmentController.move({ x: 25, y: 20 })
  const preview = clone(doc)
  editor.segmentController.finish()
  assert.deepEqual(clone(doc), preview)
  assertGeometry(doc)
  editor.commands.undo()
  assert.deepEqual(clone(doc), before)
  editor.commands.redo()
  assert.deepEqual(clone(doc), preview)
  assertGeometry(doc)
})

test('batch drag with an unselected shared endpoint keeps preview and history topology consistent', () => {
  const { doc, main, branch, editor } = sharedFixture()
  const before = clone(doc)
  editor.drag.beginBatchDrag([main.id], { x: 0, y: 0 })
  editor.drag.move({ x: 20, y: 20 })
  assert.deepEqual(branch.points[0], { x: 0, y: 0 })
  assertGeometry(doc)
  editor.drag.finish()
  assertGeometry(doc)
  editor.commands.undo()
  assert.deepEqual(clone(doc), before)
  editor.commands.redo()
  assertGeometry(doc)
})

test('pointercancel cancels eraser instead of committing pointerup', () => {
  const editor = makeEditor(createDocument())
  const canvas = bindPointer(editor)
  editor.state.tool = 'eraser'
  canvas.emit('pointerdown')
  canvas.emit('pointermove', 20, 20)
  canvas.emit('pointercancel', 20, 20)
  assert.equal(editor.erased, 0)
  assert.equal(editor.eraser.isErasing, false)
  assert.equal(editor.pointer.isDown, false)
  assert.equal(canvas.captures.size, 0)
})

test('line draft keeps previewing while the pointer is idle', () => {
  const editor = makeEditor(createDocument())
  const canvas = bindPointer(editor)
  editor.state.tool = 'line'
  canvas.emit('pointerdown')
  canvas.emit('pointerup')
  canvas.emit('click')
  canvas.emit('pointermove', 30, 40)
  assert.deepEqual(editor.drawPreview, [{ x: 0, y: 0 }, { x: 30, y: 40 }])
})

for (const internal of [false, true]) {
  for (const batch of [false, true]) {
    test(`${batch ? 'batch' : 'single'} element drag restores ${internal ? 'internal' : 'endpoint'} shared-node preview on cancel`, () => {
      const { doc, main, branch, editor } = sharedFixture(internal)
      const before = clone(doc)
      if (batch) editor.drag.beginBatchDrag([main.id], { x: 0, y: 0 })
      else editor.drag.beginElementDrag(main.id, { x: 0, y: 0 })
      editor.drag.move({ x: 20, y: 30 })
      assertGeometry(doc)
      assert.equal(branch.points[0].y, internal ? 30 : 0)
      editor.drag.move({ x: 40, y: 50 })
      assertGeometry(doc)
      editor.drag.cancel()
      assert.deepEqual(clone(doc), before)
      assert.equal(editor.commands.canUndo, false)
    })
  }

  test(`batch drag of all tracks moves the shared ${internal ? 'vertexLink' : 'endpoint'} once across history cycles`, () => {
    const { doc, main, branch, editor } = sharedFixture(internal)
    const before = clone(doc)
    editor.drag.beginBatchDrag([main.id, branch.id, main.id], { x: 0, y: 0 })
    editor.drag.move({ x: 20, y: 30 })
    const after = clone(doc)
    assertGeometry(doc)
    editor.drag.finish()
    assert.deepEqual(clone(doc), after)
    for (let i = 0; i < 3; i++) {
      assert.equal(editor.commands.undo(), true)
      assert.deepEqual(clone(doc), before)
      assert.equal(editor.commands.canUndo, false)
      assert.equal(editor.commands.redo(), true)
      assert.deepEqual(clone(doc), after)
      assertGeometry(doc)
    }
  })

  test(`single track drag with shared ${internal ? 'vertexLink' : 'endpoint'} is undoable after subsequent cancelled drags`, () => {
    const { doc, main, editor } = sharedFixture(internal)
    const before = clone(doc)
    editor.drag.beginElementDrag(main.id, { x: 0, y: 0 })
    editor.drag.move({ x: 20, y: 30 })
    editor.drag.finish()
    const after = clone(doc)
    for (let i = 0; i < 3; i++) {
      editor.commands.undo()
      assert.deepEqual(clone(doc), before)
      editor.drag.beginElementDrag(main.id, { x: 0, y: 0 })
      editor.drag.move({ x: 100, y: 100 })
      editor.drag.cancel()
      assert.deepEqual(clone(doc), before)
      editor.commands.redo()
      assert.deepEqual(clone(doc), after)
      assertGeometry(doc)
    }
  })
}

test('point drag moves shared vertexLinks and supports cancel and undo/redo', () => {
  const { doc, main, editor } = sharedFixture(true)
  const before = clone(doc)
  editor.drag.beginPointDrag(main.id, 1)
  editor.drag.move({ x: 70, y: 30 })
  assertGeometry(doc)
  editor.drag.cancel()
  assert.deepEqual(clone(doc), before)
  editor.drag.beginPointDrag(main.id, 1)
  editor.drag.move({ x: 70, y: 30 })
  const after = clone(doc)
  editor.drag.finish()
  assert.deepEqual(clone(doc), after)
  editor.commands.undo()
  assert.deepEqual(clone(doc), before)
  editor.commands.redo()
  assert.deepEqual(clone(doc), after)
})

test('multiple selected points on a shared node translate once and undo together', () => {
  const { doc, main, branch, editor } = sharedFixture(true)
  const before = clone(doc)
  editor.drag.beginPointsDrag([
    { elementId: main.id, index: 1 }, { elementId: branch.id, index: 0 },
    { elementId: main.id, index: 1 }, { elementId: main.id, index: 2 },
  ], { x: 0, y: 0 })
  editor.drag.move({ x: 20, y: 30 })
  assert.deepEqual(main.points[1], { x: 70, y: 30 })
  const after = clone(doc)
  assertGeometry(doc)
  editor.drag.finish()
  assert.deepEqual(clone(doc), after)
  editor.commands.undo()
  assert.deepEqual(clone(doc), before)
  assert.equal(editor.commands.canUndo, false)
  editor.commands.redo()
  assert.deepEqual(clone(doc), after)
})

test('no displacement, including a drag returning to its origin, creates no history or detach', () => {
  const { doc, main, editor } = sharedFixture()
  const before = clone(doc)
  editor.drag.beginBatchDrag([main.id], { x: 0, y: 0 })
  editor.drag.move({ x: 0, y: 0 })
  editor.drag.finish()
  assert.deepEqual(clone(doc), before)
  assert.equal(editor.commands.canUndo, false)
  editor.drag.beginElementDrag(main.id, { x: 0, y: 0 })
  editor.drag.move({ x: 20, y: 30 })
  editor.drag.move({ x: 0, y: 0 })
  editor.drag.finish()
  assert.deepEqual(clone(doc), before)
  assert.equal(editor.commands.canUndo, false)
})

for (const restriction of ['element locked', 'element hidden', 'layer locked', 'layer hidden'] as const) {
  test(`all direct drag entry points reject ${restriction} elements and their shared nodes`, () => {
    const { doc, main, branch, node, editor } = sharedFixture(true)
    const platform = createPlatform({ layerId: doc.layers[0].id, start: { x: 200, y: 0 }, end: { x: 300, y: 0 } })
    doc.elements.push(platform)
    if (restriction === 'element locked') { main.locked = true; platform.locked = true }
    if (restriction === 'element hidden') { main.visible = false; platform.visible = false }
    if (restriction === 'layer locked') doc.layers[0].locked = true
    if (restriction === 'layer hidden') doc.layers[0].visible = false
    const before = clone(doc)
    editor.drag.beginPointDrag(main.id, 1)
    assert.equal(editor.drag.isDragging, false)
    editor.drag.beginPointDrag(branch.id, 0)
    assert.equal(editor.drag.isDragging, false)
    editor.drag.beginPointsDrag([{ elementId: main.id, index: 1 }, { elementId: branch.id, index: 0 }], { x: 0, y: 0 })
    assert.equal(editor.drag.isDragging, false)
    editor.drag.beginElementDrag(main.id, { x: 0, y: 0 })
    assert.equal(editor.drag.isDragging, false)
    editor.drag.beginElementDrag(branch.id, { x: 0, y: 0 })
    assert.equal(editor.drag.isDragging, false)
    editor.drag.beginBatchDrag([main.id, branch.id], { x: 0, y: 0 })
    assert.equal(editor.drag.isDragging, false)
    editor.drag.beginPlatformEndpointDrag(platform.id, 'start')
    assert.equal(editor.drag.isDragging, false)
    editor.hitTestNode = () => node
    editor.nodeController.pointerDown(node)
    assert.equal(editor.nodeController.isDragging, false)
    editor.hitTestSegment = () => ({ track: branch, index: 0 })
    editor.segmentController.pointerDown({ x: 50, y: 50 })
    assert.equal(editor.segmentController.isDragging, false)
    assert.deepEqual(clone(doc), before)
    assert.equal(editor.commands.canUndo, false)
  })
}

test('batch drag filters stale locked selection while preserving independent editable elements', () => {
  const doc = createDocument()
  const locked = createLine({ layerId: doc.layers[0].id, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] })
  locked.locked = true
  const editable = createLabel({ layerId: doc.layers[0].id, text: 'move', x: 200, y: 0 })
  doc.elements.push(locked, editable)
  const editor = makeEditor(doc)
  const before = clone(doc)
  editor.drag.beginBatchDrag([locked.id, editable.id], { x: 0, y: 0 })
  editor.drag.move({ x: 20, y: 30 })
  assert.deepEqual(locked.points, before.elements[0].type === 'line' ? before.elements[0].points : [])
  assert.equal(editable.x, 220)
  editor.drag.finish()
  editor.commands.undo()
  assert.deepEqual(clone(doc), before)
})

test('node merge candidates exclude locked nodes', () => {
  const { doc, main, branch, editor } = sharedFixture()
  branch.locked = true
  const source = doc.nodes.find((node) => node.id === main.endNodeId)!
  editor.hitTestNode = () => source
  editor.nodeController.pointerDown(source)
  editor.nodeController.move({ x: 0, y: 0 })
  assert.equal(editor.snapPoint, null)
  editor.nodeController.finish()
  assert.ok(doc.nodes.some((node) => node.id === source.id))
  assert.equal(main.endNodeId, source.id)
  assertGeometry(doc)
})

test('platform endpoint rotation cancels cleanly and uses a single undoable command', () => {
  const doc = createDocument()
  const platform = createPlatform({ layerId: doc.layers[0].id, start: { x: 0, y: 0 }, end: { x: 100, y: 0 } })
  doc.elements.push(platform)
  const editor = makeEditor(doc)
  const before = clone(doc)
  editor.drag.beginPlatformEndpointDrag(platform.id, 'end')
  editor.drag.move({ x: 0, y: 100 })
  editor.drag.cancel()
  assert.deepEqual(clone(doc), before)
  editor.drag.beginPlatformEndpointDrag(platform.id, 'end')
  editor.drag.move({ x: 0, y: 100 })
  const after = clone(doc)
  editor.drag.finish()
  assert.deepEqual(clone(doc), after)
  editor.commands.undo()
  assert.deepEqual(clone(doc), before)
  editor.commands.redo()
  assert.deepEqual(clone(doc), after)
})

test('line, label and platform translate together and undo as a batch', () => {
  const doc = createDocument()
  doc.elements.push(
    createLine({ layerId: doc.layers[0].id, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }),
    createLabel({ layerId: doc.layers[0].id, text: 'move', x: 20, y: 30 }),
    createPlatform({ layerId: doc.layers[0].id, start: { x: 0, y: 0 }, end: { x: 100, y: 0 } }),
  )
  const editor = makeEditor(doc)
  const before = clone(doc)
  editor.drag.beginBatchDrag(doc.elements.map((el) => el.id), { x: 0, y: 0 })
  editor.drag.move({ x: 20, y: 30 })
  const after = clone(doc)
  editor.drag.finish()
  assert.deepEqual(clone(doc), after)
  editor.commands.undo()
  assert.deepEqual(clone(doc), before)
  assert.equal(editor.commands.canUndo, false)
  editor.commands.redo()
  assert.deepEqual(clone(doc), after)
})

test('segment normal constraint and no-op finish preserve history', () => {
  const { doc, main, editor } = sharedFixture()
  editor.isAngleSnapActive = true
  editor.hitTestSegment = () => ({ track: main, index: 0 })
  const before = clone(doc)
  editor.segmentController.pointerDown({ x: 50, y: 0 })
  editor.segmentController.move({ x: 70, y: 20 })
  assert.deepEqual(main.points[0], { x: 0, y: 20 })
  assertGeometry(doc)
  editor.segmentController.cancel()
  assert.deepEqual(clone(doc), before)
  editor.segmentController.pointerDown({ x: 50, y: 0 })
  editor.segmentController.move({ x: 70, y: 0 })
  editor.segmentController.finish()
  assert.deepEqual(clone(doc), before)
  assert.equal(editor.commands.canUndo, false)
})

for (const tool of ['node', 'segment'] as const) {
  test(`public pointer.cancel restores live ${tool} editing even without a pointerdown event`, () => {
    const { doc, main, node, editor } = sharedFixture()
    const before = clone(doc)
    editor.state.tool = tool
    if (tool === 'node') {
      editor.hitTestNode = () => node
      editor.nodeController.pointerDown(node)
      editor.nodeController.move({ x: 20, y: 30 })
    } else {
      editor.hitTestSegment = () => ({ track: main, index: 0 })
      editor.segmentController.pointerDown({ x: 50, y: 0 })
      editor.segmentController.move({ x: 50, y: 30 })
    }
    editor.pointer.cancel()
    assert.deepEqual(clone(doc), before)
    assert.equal(editor.nodeController.isDragging, false)
    assert.equal(editor.segmentController.isDragging, false)
    assert.equal(editor.commands.canUndo, false)
  })
}

test('invalid selected point indices do not start a drag', () => {
  const { main, editor } = sharedFixture()
  for (const index of [-1, NaN, Infinity, 1.5, main.points.length]) {
    editor.drag.beginPointDrag(main.id, index)
    assert.equal(editor.drag.isDragging, false)
    editor.drag.beginPointsDrag([{ elementId: main.id, index }], { x: 0, y: 0 })
    assert.equal(editor.drag.isDragging, false)
  }
})

for (const event of ['pointercancel', 'lostpointercapture']) {
  test(`${event} restores a live point drag without adding history`, () => {
    const { doc, main, editor } = sharedFixture()
    const before = clone(doc)
    const canvas = bindPointer(editor)
    editor.hitTestControlPoint = () => ({ element: main, index: 0 })
    canvas.emit('pointerdown')
    canvas.emit('pointermove', 20, 30)
    assert.notDeepEqual(clone(doc), before)
    canvas.emit(event, 20, 30)
    assert.deepEqual(clone(doc), before)
    assert.equal(editor.drag.isDragging, false)
    assert.equal(editor.pointer.isDown, false)
    assert.equal(editor.commands.canUndo, false)
    canvas.emit('pointerup', 20, 30)
    assert.deepEqual(clone(doc), before)
  })
}

test('pointer cancellation discards marquee instead of selecting its contents', () => {
  const editor = makeEditor(createDocument())
  const canvas = bindPointer(editor)
  canvas.emit('pointerdown')
  canvas.emit('pointermove', 50, 50)
  assert.notEqual(editor.marqueeRect, null)
  canvas.emit('pointercancel', 50, 50)
  assert.equal(editor.marqueeRect, null)
  assert.equal(editor.rectSelections, 0)
  assert.equal(editor.pointer.downDragDistance, 0)
})

test('public pointer.cancel clears idle drafts and allows the next gesture', () => {
  const editor = makeEditor(createDocument())
  const canvas = bindPointer(editor)
  editor.state.tool = 'line'
  canvas.emit('pointerdown')
  canvas.emit('pointerup')
  canvas.emit('click')
  assert.equal(editor.drawTrack.isDrawing, true)
  editor.pointer.cancel()
  assert.equal(editor.drawTrack.isDrawing, false)
  assert.deepEqual(editor.drawPreview, [])
  canvas.emit('click', 20, 20)
  assert.equal(editor.drawTrack.isDrawing, false)
  canvas.emit('pointerdown', 30, 30)
  canvas.emit('pointerup', 30, 30)
  canvas.emit('click', 30, 30)
  assert.deepEqual(editor.drawPreview, [{ x: 30, y: 30 }])
  editor.selectionController.draftPlatform.active = true
  editor.pan.begin({ x: 0, y: 0 })
  editor.pointer.cancel()
  assert.equal(editor.selectionController.draftPlatform.active, false)
  assert.equal(editor.pan.isPanning, false)
})

test('unbinding cancels previews and removes event listeners', () => {
  const { doc, main, editor } = sharedFixture()
  const before = clone(doc)
  const canvas = bindPointer(editor)
  editor.hitTestControlPoint = () => ({ element: main, index: 0 })
  canvas.emit('pointerdown')
  canvas.emit('pointermove', 20, 30)
  editor.pointer.unbind()
  assert.deepEqual(clone(doc), before)
  assert.equal(canvas.captures.size, 0)
  canvas.emit('pointerup', 20, 30)
  canvas.emit('pointerdown')
  assert.equal(editor.commands.canUndo, false)
  assert.equal(editor.pointer.isDown, false)
})

test('a second pointer cannot move, commit or cancel the active gesture', () => {
  const { doc, main, editor } = sharedFixture()
  const canvas = bindPointer(editor)
  editor.hitTestControlPoint = () => ({ element: main, index: 0 })
  canvas.emit('pointerdown', 0, 0, 1)
  canvas.emit('pointermove', 20, 30, 1)
  const preview = clone(doc)
  canvas.emit('pointerdown', 100, 100, 2)
  canvas.emit('pointermove', 100, 100, 2)
  canvas.emit('pointerup', 100, 100, 2)
  canvas.emit('pointercancel', 100, 100, 2)
  assert.deepEqual(clone(doc), preview)
  assert.equal(editor.pointer.isDown, true)
  assert.equal(editor.commands.canUndo, false)
  canvas.emit('pointerup', 20, 30, 1)
  assert.equal(editor.commands.canUndo, true)
  assert.equal(canvas.captures.size, 0)
})
