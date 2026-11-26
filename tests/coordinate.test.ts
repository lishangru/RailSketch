import test from 'node:test'
import assert from 'node:assert/strict'
import { Editor } from '../src/editor/core/Editor'
import { isLabel, isStation, isTrack } from '../src/editor/model/Document'
import { createLabel } from '../src/editor/model/Label'
import { createStation } from '../src/editor/model/Station'
import { hitTest } from '../src/editor/geometry/HitTest'
import { labelBoxSize, labelDrawnRange, measureLabel } from '../src/editor/render/LabelRenderer'
import { createDocument, migrateDocument } from '../src/editor/model/Document'

/** 渲染层的绘制范围（生产代码与测试共用同一实现，避免测试自说自话）。 */
function drawnRange(l: Parameters<typeof labelBoxSize>[0]): { left: number; right: number; top: number; bottom: number } {
  return labelDrawnRange(l)
}

test('label hit boxes coincide with the drawn text range for every alignment', () => {
  const cases: { align?: 'left' | 'center' | 'right'; background?: string }[] = [
    {},
    { align: 'center' },
    { align: 'right' },
    { background: '#00ABE1' },
    { align: 'center', background: '#00ABE1' },
    { align: 'right', background: '#00ABE1' },
  ]
  for (const extra of cases) {
    const label = { ...createLabel({ text: '南京南站', x: 500, y: 400, layerId: 'L', fontSize: 17 }), ...extra }
    const drawn = drawnRange(label)
    // 命中框四角都必须落在绘制范围内，且绘制范围的中点可被命中。
    const probes = [
      { x: drawn.left + 0.5, y: label.y },
      { x: drawn.right - 0.5, y: label.y },
      { x: (drawn.left + drawn.right) / 2, y: label.y },
    ]
    for (const p of probes) {
      const hit = hitTest(p, [label], { maxDistance: 1 })
      assert.ok(hit, `align=${label.align ?? 'left'} bg=${label.background ?? '-'} 在 x=${p.x.toFixed(1)} 未命中`)
      assert.equal(hit.element.id, label.id)
    }
  }
})

test('a left-aligned label is not hit half a text width to the left of where it is drawn', () => {
  // 回归：曾把左对齐文字的命中框错误地按「锚点为中心」计算，导致整体左移 w/2。
  const label = createLabel({ text: '八卦洲大桥南', x: 1099, y: 540, layerId: 'L', fontSize: 14 })
  const drawn = drawnRange(label)
  assert.ok(Math.abs(drawn.left - 1099) < 0.01, '左对齐文字应从锚点向右画')
  const before = hitTest({ x: 1099 - 20, y: 540 }, [label], { maxDistance: 2 })
  assert.equal(before, null, '锚点左侧 20 单位处不应命中')
  const inside = hitTest({ x: 1099 + 20, y: 540 }, [label], { maxDistance: 2 })
  assert.ok(inside, '锚点右侧（文字上）应命中')
  assert.equal(inside.element.id, label.id)
})

test('label drawn range is the single source of truth for hit, erase and export', () => {
  const label = createLabel({ text: '南京林业大学·新庄', x: 1003, y: 933, layerId: 'L', fontSize: 14 })
  const drawn = labelDrawnRange(label)
  // 左对齐：起点即锚点
  assert.ok(Math.abs(drawn.left - 1003) < 1e-9, '左对齐文字左边缘应等于锚点 x')
  assert.ok(drawn.right > 1003, '左对齐文字应向右展开')
  assert.ok(Math.abs((drawn.top + drawn.bottom) / 2 - 933) < 1e-9, '垂直方向以锚点为中心')

  const centered = { ...label, align: 'center' as const }
  const c = labelDrawnRange(centered)
  assert.ok(Math.abs((c.left + c.right) / 2 - 1003) < 1e-9, '居中文字应以锚点为中心')

  const right = { ...label, align: 'right' as const }
  const r = labelDrawnRange(right)
  assert.ok(Math.abs(r.right - 1003) < 1e-9, '右对齐文字右边缘应等于锚点 x')

  const badge = { ...label, background: '#00ABE1', backgroundWidth: 37, backgroundHeight: 26 }
  const b = labelDrawnRange(badge)
  assert.ok(Math.abs((b.left + b.right) / 2 - 1003) < 1e-9, '底板以锚点为中心')
  assert.ok(Math.abs(b.right - b.left - 37) < 1e-9, '底板宽度应生效')
})

test('pointer coordinates round-trip through the camera without drift', () => {
  const g = globalThis as Record<string, unknown>
  const saved = { ro: g.ResizeObserver, raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame, win: g.window, doc: g.document }
  g.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  g.requestAnimationFrame = () => 1
  g.cancelAnimationFrame = () => {}
  g.window = { devicePixelRatio: 2, addEventListener() {}, removeEventListener() {} }
  g.document = { activeElement: null, addEventListener() {}, removeEventListener() {} }
  try {
    const rect = { left: 100, top: 50, width: 800, height: 600 }
    class FakeCanvas {
      style: Record<string, string> = {}
      width = 300
      height = 150
      private listeners = new Map<string, Set<(e: unknown) => void>>()
      captures = new Set<number>()
      getContext() { return null }
      addEventListener(t: string, l: (e: unknown) => void) { if (!this.listeners.has(t)) this.listeners.set(t, new Set()); this.listeners.get(t)!.add(l) }
      removeEventListener(t: string, l: (e: unknown) => void) { this.listeners.get(t)?.delete(l) }
      contains(t: unknown) { return t === this }
      focus() {}
      getBoundingClientRect() { return { ...rect } }
      setPointerCapture(id: number) { this.captures.add(id) }
      hasPointerCapture(id: number) { return this.captures.has(id) }
      releasePointerCapture(id: number) { this.captures.delete(id) }
    }
    const document = createDocument('round-trip')
    document.elements.push(createStation({ x: 500, y: 400, layerId: document.layers[0]!.id }))
    const editor = new Editor(document)
    const canvas = new FakeCanvas()
    editor.attach(canvas as unknown as HTMLCanvasElement, { getBoundingClientRect: () => ({ ...rect }) } as unknown as HTMLElement)

    // 画布 CSS 尺寸与 dpr 无关地用于指针换算：屏幕坐标 -> CSS -> 世界。
    const station = document.elements.find(isStation)!
    const screen = editor.worldToScreen(station)
    const world = editor.screenToWorld({ ...screen })
    assert.ok(Math.hypot(world.x - station.x, world.y - station.y) < 1e-9, 'worldToScreen/screenToWorld 必须可逆')

    // 指针事件用的是 clientX/clientY，需要减去画布在视口中的位置。
    const hit = hitTest(world, document.elements, { maxDistance: 8 / editor.camera.zoom })
    assert.ok(hit)
    assert.equal(hit.element.id, station.id)
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete g[k]
      else g[k] = v
    }
  }
})

test('a station and its name label are independently selectable', () => {
  const doc = createDocument('站点与站名')
  const layerId = doc.layers[0]!.id
  doc.elements.push(createStation({ x: 300, y: 300, layerId, name: '八卦洲大桥南' }))
  doc.elements.push(createLabel({ text: '八卦洲大桥南', x: 200, y: 290, layerId, fontSize: 14 }))
  const migrated = migrateDocument(doc)
  const station = migrated.elements.find(isStation)!
  const label = migrated.elements.find(isLabel)!

  // 点站点中心 -> 站点
  const atStation = hitTest({ x: station.x, y: station.y }, migrated.elements, { maxDistance: 4 })
  assert.equal(atStation?.element.id, station.id)

  // 点站名文字中部 -> 文字
  const drawn = drawnRange(label)
  const atLabel = hitTest({ x: (drawn.left + drawn.right) / 2, y: label.y }, migrated.elements, { maxDistance: 4 })
  assert.equal(atLabel?.element.id, label.id)
})

test('label measurement is shared by rendering, hit testing and export', () => {
  const label = createLabel({ text: '宁天线S8', x: 100, y: 100, layerId: 'L', fontSize: 17 })
  assert.deepEqual(labelBoxSize(label), measureLabel(label), '无底板时包围盒应等于文字尺寸')
  const badge = { ...label, background: '#ED9B5C', backgroundWidth: 37, backgroundHeight: 26 }
  assert.deepEqual(labelBoxSize(badge), { w: 37, h: 26 }, '带底板时包围盒应等于底板尺寸')
})

test('tracks are hit along their centre line within half the stroke width', () => {
  const doc = createDocument('线路')
  const layerId = doc.layers[0]!.id
  doc.elements.push({
    id: 't1', type: 'track', layerId, visible: true, locked: false,
    points: [{ x: 100, y: 200 }, { x: 500, y: 200 }],
    trackStyle: 'single', strokeWidth: 12, spacing: 8, color: '#00ABE1', cornerRadius: 0, bridgeGap: 20,
  })
  const migrated = migrateDocument(doc)
  const track = migrated.elements.find(isTrack)!
  // 中心线上必中
  assert.ok(hitTest({ x: 300, y: 200 }, migrated.elements, { maxDistance: 1 }))
  // 线宽一半之内必中（6 单位）
  assert.ok(hitTest({ x: 300, y: 205 }, migrated.elements, { maxDistance: 1 }), '线宽范围内应命中')
  // 明显在外不中
  assert.equal(hitTest({ x: 300, y: 215 }, migrated.elements, { maxDistance: 1 }), null, '线路外侧过远不应命中')
  void track
})
