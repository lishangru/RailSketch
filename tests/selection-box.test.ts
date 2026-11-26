import test from 'node:test'
import assert from 'node:assert/strict'
import { Editor } from '../src/editor/core/Editor'
import { createDocument, migrateDocument } from '../src/editor/model/Document'
import { createLabel } from '../src/editor/model/Label'
import { labelDrawnRange, labelBoxSize } from '../src/editor/render/LabelRenderer'
import { SelectionRenderer } from '../src/editor/render/SelectionRenderer'

function docWithLabel(extra: Partial<ReturnType<typeof createLabel>> = {}) {
  const doc = createDocument('选中框')
  const layerId = doc.layers[0]!.id
  const label = { ...createLabel({ text: '八卦洲大桥南', x: 1099, y: 540, layerId, fontSize: 14 }), ...extra }
  doc.elements.push(label)
  return { editor: new Editor(migrateDocument(doc)), label }
}

/** 捕获 SelectionRenderer 绘制的 strokeRect 参数。 */
function captureLabelSelectionBox(editor: Editor, labelId: string) {
  const calls: number[][] = []
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_, key: string) => {
      if (key === 'strokeRect') return (...args: number[]) => calls.push(args)
      return () => {}
    },
    set: () => true,
  })
  editor.setSelection([labelId])
  new SelectionRenderer().render(ctx as unknown as CanvasRenderingContext2D, editor.camera, editor.document, editor.state.selectionIds, editor.state.selectedPoints)
  return calls
}

test('the selection box of a left-aligned label starts at the anchor and extends right', () => {
  const { editor, label } = docWithLabel()
  const calls = captureLabelSelectionBox(editor, label.id)
  assert.equal(calls.length, 1, '应绘制一个选中框')
  const drawn = labelDrawnRange(label)
  const [x, y, w, h] = calls[0]!
  // strokeRect 在 translate(x, y) 之后使用局部坐标，需换算回世界坐标比较。
  const worldLeft = label.x + x
  const worldTop = label.y + y
  // 选中框应包住绘制范围（允许 4px 内边距），左边缘不越过绘制左边缘太多。
  assert.ok(worldLeft <= drawn.left + 0.001, `选中框左边缘 ${worldLeft} 不应明显超出绘制左边缘 ${drawn.left}`)
  assert.ok(Math.abs(worldTop - drawn.top) < 12, '选中框上边缘应贴近文字顶部')
  assert.ok(w >= drawn.right - drawn.left - 0.001, '选中框宽度应覆盖整个文字')
  assert.ok(h >= drawn.bottom - drawn.top - 0.001)
})

test('a centred label is selected with a box centred on its anchor', () => {
  const { editor, label } = docWithLabel({ align: 'center' })
  const calls = captureLabelSelectionBox(editor, label.id)
  const drawn = labelDrawnRange(label)
  const [x, , w] = calls[0]!
  const worldLeft = label.x + x
  const worldCenter = worldLeft + w / 2
  assert.ok(Math.abs(worldCenter - label.x) < 6, `居中文字的选中框应居中，实际中心 ${worldCenter} vs ${label.x}`)
  assert.ok(Math.abs(drawn.left + drawn.right) / 2 - label.x < 0.001)
})

test('a label with a background plate is selected around the plate, not the glyphs', () => {
  const { editor, label } = docWithLabel({ background: '#00ABE1', backgroundWidth: 37, backgroundHeight: 26 })
  const calls = captureLabelSelectionBox(editor, label.id)
  const drawn = labelDrawnRange(label)
  const [x, , w] = calls[0]!
  const worldLeft = label.x + x
  const worldRight = worldLeft + w
  assert.ok(Math.abs((drawn.left + drawn.right) / 2 - (worldLeft + worldRight) / 2) < 6, '选中框应与底板同心')
  assert.ok(w >= drawn.right - drawn.left - 0.001, '选中框应覆盖整个底板')
})

test('eraser removes a left-aligned label when sweeping over the visible text', () => {
  const { editor, label } = docWithLabel()
  const drawn = labelDrawnRange(label)
  const before = editor.document.elements.length
  // 笔刷只经过文字可见范围的中点（不经过锚点左侧）。
  editor.executeEraser([
    { x: (drawn.left + drawn.right) / 2 - 5, y: label.y },
    { x: (drawn.left + drawn.right) / 2 + 5, y: label.y },
  ])
  assert.equal(editor.document.elements.length, before - 1, '笔刷经过文字可见范围应能删除')
  void label
})

test('the eraser does not remove a label when sweeping only to the left of its glyphs', () => {
  const { editor, label } = docWithLabel()
  const drawn = labelDrawnRange(label)
  const before = editor.document.elements.length
  // 笔刷在锚点左侧 25 单位处，正好落在旧的（错误的）命中框内。
  editor.executeEraser([
    { x: label.x - 30, y: label.y },
    { x: label.x - 20, y: label.y },
  ])
  assert.equal(editor.document.elements.length, before, '文字左侧空白处擦除不应命中')
  assert.ok(drawn.left >= label.x - 0.001)
})

test('labelBoxSize and labelDrawnRange agree on the plate size', () => {
  const label = { ...createLabel({ text: 'S1', x: 0, y: 0, layerId: 'L', fontSize: 17 }), background: '#43BFB5', backgroundWidth: 37, backgroundHeight: 26 }
  const size = labelBoxSize(label)
  const drawn = labelDrawnRange(label)
  assert.equal(drawn.right - drawn.left, size.w)
  assert.equal(drawn.bottom - drawn.top, size.h)
})
