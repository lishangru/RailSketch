import test from 'node:test'
import assert from 'node:assert/strict'
import { Editor } from '../src/editor/core/Editor'
import { createDocument, isLabel, isStation, migrateDocument } from '../src/editor/model/Document'
import { createLabel } from '../src/editor/model/Label'
import { createStation } from '../src/editor/model/Station'
import { distance } from '../src/editor/geometry/Point'

class FakeCanvas {
  private listeners = new Map<string, Set<(e: PointerEvent) => void>>()
  captures = new Set<number>()
  style: Record<string, string> = {}
  width = 800
  height = 600
  getContext() { return null }
  addEventListener(t: string, l: (e: PointerEvent) => void) {
    if (!this.listeners.has(t)) this.listeners.set(t, new Set())
    this.listeners.get(t)!.add(l)
  }
  removeEventListener(t: string, l: (e: PointerEvent) => void) { this.listeners.get(t)?.delete(l) }
  contains(t: unknown) { return t === this }
  focus() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 } }
  setPointerCapture(id: number) { this.captures.add(id) }
  hasPointerCapture(id: number) { return this.captures.has(id) }
  releasePointerCapture(id: number) { this.captures.delete(id) }
  emit(type: string, x = 0, y = 0, pointerId = 1, ctrlKey = false) {
    const ev = {
      clientX: x, clientY: y, pointerId, button: 0, target: this,
      ctrlKey, metaKey: false, shiftKey: false, preventDefault() {},
    } as unknown as PointerEvent
    for (const l of this.listeners.get(type) ?? []) l(ev)
  }
}

/** 绑定真实 PointerController 的编辑器（补齐浏览器 API 桩）。 */
function bindEditor(doc: ReturnType<typeof createDocument>) {
  const g = globalThis as Record<string, unknown>
  const saved = { ro: g.ResizeObserver, raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame, win: g.window, doc: g.document }
  g.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
  g.requestAnimationFrame ??= () => 1
  g.cancelAnimationFrame ??= () => {}
  g.window ??= { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} }
  g.document ??= { activeElement: null, addEventListener() {}, removeEventListener() {} }
  const editor = new Editor(doc)
  const canvas = new FakeCanvas()
  editor.attach(canvas as unknown as HTMLCanvasElement, {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  } as unknown as HTMLElement)
  const restore = (): void => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete g[k]
      else g[k] = v
    }
  }
  return { editor, canvas, restore }
}

/** 站点落在密集轨道顶点上的场景：一条直线被切成很多短段。 */
function denseTrackDoc() {
  const doc = createDocument('密集顶点')
  const layerId = doc.layers[0]!.id
  const points = []
  for (let i = 0; i <= 40; i++) points.push({ x: 100 + i * 20, y: 300 })
  doc.elements.push({
    id: 't1', type: 'track', layerId, visible: true, locked: false,
    points, trackStyle: 'single', strokeWidth: 4, spacing: 8, color: '#2563eb', cornerRadius: 0, bridgeGap: 20,
  })
  // 三个站点各自压在顶点上。
  for (const [i, id] of [[10, 's1'], [20, 's2'], [30, 's3']] as const) {
    doc.elements.push(createStation({ x: 100 + i * 20, y: 300, layerId, name: id, trackIds: ['t1'] }))
  }
  return migrateDocument(doc)
}

test('a station sitting on a track vertex is hit instead of the vertex', () => {
  const { editor, restore } = bindEditor(denseTrackDoc())
  try {
    const station = editor.document.elements.find(isStation)!
    const hit = editor.hitTest({ x: station.x, y: station.y })
    assert.ok(hit)
    assert.equal(hit.element.type, 'station', '站点应优先于同位置的轨道顶点')
  } finally {
    restore()
  }
})

test('ctrl-clicking several stations accumulates a multi-selection', () => {
  const { editor, canvas, restore } = bindEditor(denseTrackDoc())
  try {
    const stations = editor.document.elements.filter(isStation)
    const screen = (p: { x: number; y: number }) => editor.camera.worldToScreen(p)
    for (const st of stations) {
      const s = screen(st)
      canvas.emit('pointerdown', s.x, s.y, 1, true)
      canvas.emit('pointerup', s.x, s.y, 1)
    }
    assert.equal(editor.state.selectionIds.length, stations.length, `应累加选中 ${stations.length} 个站点`)
  } finally {
    restore()
  }
})

test('dragging one of several selected stations moves all of them and keeps the selection', () => {
  const { editor, canvas, restore } = bindEditor(denseTrackDoc())
  try {
    const stations = editor.document.elements.filter(isStation)
    const screen = (p: { x: number; y: number }) => editor.camera.worldToScreen(p)
    for (const st of stations) {
      const s = screen(st)
      canvas.emit('pointerdown', s.x, s.y, 1, true)
      canvas.emit('pointerup', s.x, s.y, 1)
    }
    assert.equal(editor.state.selectionIds.length, 3)
    const before = stations.map((s) => ({ x: s.x, y: s.y }))

    // 从中间那个站点按下并拖动
    const from = screen(stations[1]!)
    canvas.emit('pointerdown', from.x, from.y, 1)
    assert.equal(editor.state.selectionIds.length, 3, '按下时不得收窄选择')
    assert.equal(editor.drag.isDragging, true, '应进入整批拖动')
    canvas.emit('pointermove', from.x + 60, from.y, 1)
    canvas.emit('pointerup', from.x + 60, from.y, 1)

    assert.equal(editor.state.selectionIds.length, 3, '松手后选择应保持')
    const after = editor.document.elements.filter(isStation).map((s) => ({ x: s.x, y: s.y }))
    // 三个站点位移一致
    const deltas = after.map((a, i) => a.x - before[i]!.x)
    assert.ok(Math.abs(deltas[0]! - deltas[1]!) < 0.01, `位移应一致：${deltas.join(',')}`)
    assert.ok(Math.abs(deltas[1]! - deltas[2]!) < 0.01)
    assert.ok(Math.abs(deltas[0]!) > 1, `整体应真的移动了，实际位移 ${deltas[0]}`)
  } finally {
    restore()
  }
})

test('a batch drag of mixed element types moves every one of them', () => {
  const doc = createDocument('混合多选')
  const layerId = doc.layers[0]!.id
  doc.elements.push(createStation({ x: 100, y: 100, layerId, name: 'A' }))
  doc.elements.push(createStation({ x: 200, y: 100, layerId, name: 'B' }))
  doc.elements.push(createLabel({ text: '站名', x: 300, y: 100, layerId }))
  const { editor, restore } = bindEditor(migrateDocument(doc))
  try {
    const els = editor.document.elements
    const before = els.map((e) => ({ x: (e as { x: number }).x, y: (e as { y: number }).y }))
    editor.setSelection(els.map((e) => e.id))
    editor.drag.beginBatchDrag(els.map((e) => e.id), { x: 0, y: 0 })
    editor.drag.move({ x: 40, y: 25 })
    editor.drag.finish()
    for (const [i, el] of editor.document.elements.entries()) {
      const p = el as { x: number; y: number }
      assert.ok(Math.abs(p.x - (before[i]!.x + 40)) < 0.01, `${el.type}#${i} x 未移动`)
      assert.ok(Math.abs(p.y - (before[i]!.y + 25)) < 0.01, `${el.type}#${i} y 未移动`)
    }
  } finally {
    restore()
  }
})

test('clicking empty space still clears the selection', () => {
  const { editor, canvas, restore } = bindEditor(denseTrackDoc())
  try {
    const stations = editor.document.elements.filter(isStation)
    const screen = (p: { x: number; y: number }) => editor.camera.worldToScreen(p)
    for (const st of stations) {
      const s = screen(st)
      canvas.emit('pointerdown', s.x, s.y, 1, true)
      canvas.emit('pointerup', s.x, s.y, 1)
    }
    assert.equal(editor.state.selectionIds.length, 3)
    // 点在所有图元之外的空白处
    canvas.emit('pointerdown', 20, 560, 1)
    canvas.emit('pointerup', 20, 560, 1)
    assert.equal(editor.state.selectionIds.length, 0, '空白单击应清空选择')
  } finally {
    restore()
  }
})

test('clicking an unselected element outside the current selection replaces it', () => {
  const { editor, canvas, restore } = bindEditor(denseTrackDoc())
  try {
    const stations = editor.document.elements.filter(isStation)
    const screen = (p: { x: number; y: number }) => editor.camera.worldToScreen(p)
    const first = screen(stations[0]!)
    canvas.emit('pointerdown', first.x, first.y, 1)
    canvas.emit('pointerup', first.x, first.y, 1)
    assert.deepEqual(editor.state.selectionIds, [stations[0]!.id])

    const second = screen(stations[2]!)
    canvas.emit('pointerdown', second.x, second.y, 1)
    canvas.emit('pointerup', second.x, second.y, 1)
    assert.deepEqual(editor.state.selectionIds, [stations[2]!.id], '点未选中的对象应替换选择')
  } finally {
    restore()
  }
})

test('an isolated track vertex is still selectable when nothing else is nearby', () => {
  const { editor, restore } = bindEditor(denseTrackDoc())
  try {
    const track = editor.document.elements.find((e) => e.type === 'track')!
    const first = (track as { points: { x: number; y: number }[] }).points[0]!
    const hit = editor.hitTestControlPoint({ x: first.x, y: first.y })
    assert.ok(hit, '孤立顶点应可被拾取')
    assert.equal(hit.index, 0)
  } finally {
    restore()
  }
})

test('hitTestSelected only reports elements inside the current selection', () => {
  const { editor, restore } = bindEditor(denseTrackDoc())
  try {
    const stations = editor.document.elements.filter(isStation)
    assert.equal(editor.hitTestSelected({ x: stations[0]!.x, y: stations[0]!.y }), null, '无选择时返回 null')
    editor.setSelection([stations[0]!.id, stations[1]!.id])
    const inside = editor.hitTestSelected({ x: stations[0]!.x, y: stations[0]!.y })
    assert.ok(inside)
    assert.ok(editor.state.selectionIds.includes(inside.element.id))
    // 未选中的第三个站点不应被 hitTestSelected 命中
    const outside = editor.hitTestSelected({ x: stations[2]!.x + 40, y: stations[2]!.y })
    assert.equal(outside, null, '选区外的对象不应被命中')
  } finally {
    restore()
  }
})

test('station labels are clickable even when a track vertex sits at the same place', () => {
  const doc = createDocument('文字与顶点')
  const layerId = doc.layers[0]!.id
  doc.elements.push({
    id: 't1', type: 'track', layerId, visible: true, locked: false,
    points: [{ x: 100, y: 300 }, { x: 200, y: 300 }],
    trackStyle: 'single', strokeWidth: 4, spacing: 8, color: '#2563eb', cornerRadius: 0, bridgeGap: 20,
  })
  // 文字底板压在轨道端点上方
  doc.elements.push({
    id: 'l1', type: 'label', layerId, visible: true, locked: false,
    text: '1', x: 100, y: 300, rotation: 0, fontSize: 17,
    align: 'center', background: '#00ABE1', backgroundWidth: 26, backgroundHeight: 26, backgroundRadius: 13,
  })
  const { editor, canvas, restore } = bindEditor(migrateDocument(doc))
  try {
    const s = editor.camera.worldToScreen({ x: 100, y: 300 })
    canvas.emit('pointerdown', s.x, s.y, 1)
    canvas.emit('pointerup', s.x, s.y, 1)
    assert.equal(editor.state.selectionIds.length, 1)
    assert.equal(editor.state.selectionIds[0], 'l1', '应选中文字而不是轨道顶点')
  } finally {
    restore()
  }
})

test('clicking a station name label selects the label, not the station', () => {
  const doc = denseTrackDoc()
  doc.elements.push(createLabel({ text: '八卦洲大桥南', x: 300, y: 280, layerId: doc.layers[0]!.id, fontSize: 14 }))
  const { editor, canvas, restore } = bindEditor(migrateDocument(doc))
  try {
    const label = editor.document.elements.find(isLabel)!
    // 站名锚点在其左侧，文字向右展开
    const s = editor.camera.worldToScreen({ x: label.x + 20, y: label.y })
    canvas.emit('pointerdown', s.x, s.y, 1)
    canvas.emit('pointerup', s.x, s.y, 1)
    assert.deepEqual(editor.state.selectionIds, [label.id])
  } finally {
    restore()
  }
})

test('drag distance helper stays consistent for element spacing checks', () => {
  // 防止上面的多选断言因浮点误差失效：确认距离函数本身可用
  assert.equal(distance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5)
})
