import test from 'node:test'
import assert from 'node:assert/strict'
import { Editor } from '../src/editor/core/Editor'
import { createDocument, migrateDocument } from '../src/editor/model/Document'
import { createLabel } from '../src/editor/model/Label'
import { parseDocument, serializeDocument } from '../src/editor/serialization/serializer'
import { labelBackgroundSize, measureLabel } from '../src/editor/render/LabelRenderer'
import { hitTest } from '../src/editor/geometry/HitTest'
import { UpdateElementCommand } from '../src/editor/commands/UpdateElementCommand'

function labelDoc() {
  const doc = createDocument('底板测试')
  doc.elements.push(createLabel({ text: '1', x: 100, y: 100, layerId: doc.layers[0]!.id, fontSize: 17 }))
  return migrateDocument(doc)
}

function badge() {
  const doc = createDocument('徽标')
  doc.elements.push({
    id: 'b1', type: 'label', layerId: doc.layers[0]!.id, visible: true, locked: false,
    text: 'S1', x: 200, y: 200, rotation: 0, fontSize: 17,
    align: 'center', bold: true, color: '#ffffff', background: '#43BFB5',
    backgroundWidth: 37, backgroundHeight: 26, backgroundRadius: 13,
  })
  return migrateDocument(doc)
}

test('label background size falls back to text metrics plus padding', () => {
  const plain = createLabel({ text: '1号线', x: 0, y: 0, layerId: 'L', fontSize: 14 })
  const size = labelBackgroundSize(plain)
  const text = measureLabel(plain)
  assert.equal(size.w, text.w + 14, '宽度应按文字宽度加内边距')
  assert.equal(size.h, text.h + 8, '高度应按字号加内边距')
  // 显式尺寸优先。
  const sized = { ...plain, backgroundWidth: 40, backgroundHeight: 20 }
  assert.deepEqual(labelBackgroundSize(sized), { w: 40, h: 20 })
})

test('background colour and corner radius can be edited through the property panel path', () => {
  const ed = new Editor(badge())
  const id = 'b1'
  ed.updateElementProperties([id], { background: '#ff0000' }, '修改底板颜色')
  let el = ed.getElement(id)
  assert.ok(el?.type === 'label' && el.background === '#ff0000')

  ed.updateElementProperties([id], { backgroundRadius: 0 }, '修改底板圆角')
  el = ed.getElement(id)
  assert.ok(el?.type === 'label' && el.backgroundRadius === 0, '圆角 0 应表示直角')

  ed.updateElementProperties([id], { backgroundRadius: 13 }, '修改底板圆角')
  el = ed.getElement(id)
  assert.ok(el?.type === 'label' && el.backgroundRadius === 13)
})

test('clearing a background restores plain text and is undoable', () => {
  const ed = new Editor(badge())
  ed.updateElementProperties(['b1'], { background: '', backgroundWidth: undefined, backgroundHeight: undefined, backgroundRadius: undefined }, '隐藏文字底板')
  const el = ed.getElement('b1')
  assert.ok(el?.type === 'label')
  assert.equal(el.background, '')
  // 关闭底板后按文字尺寸度量。
  assert.deepEqual(labelBackgroundSize(el), labelBackgroundSize({ ...el, background: undefined }))
  ed.undo()
  const back = ed.getElement('b1')
  assert.ok(back?.type === 'label')
  assert.equal(back.background, '#43BFB5', '撤销应恢复底板颜色')
  assert.equal(back.backgroundRadius, 13, '撤销应恢复圆角')
  assert.equal(back.backgroundWidth, 37, '撤销应恢复底板宽度')
})

test('setting a size to undefined removes the key so auto-sizing resumes', () => {
  const ed = new Editor(badge())
  ed.updateElementProperties(['b1'], { backgroundWidth: undefined, backgroundHeight: undefined }, '恢复自动尺寸')
  const el = ed.getElement('b1')
  assert.ok(el?.type === 'label')
  assert.ok(!Object.hasOwn(el, 'backgroundWidth'), '应删除字段而不是留下 undefined')
  assert.ok(!Object.hasOwn(el, 'backgroundHeight'))
  const size = labelBackgroundSize(el)
  assert.ok(size.w > 0 && size.h > 0)
})

test('a zero value is a real setting, distinct from auto', () => {
  const ed = new Editor(badge())
  ed.updateElementProperties(['b1'], { backgroundRadius: 0 }, '直角')
  const el = ed.getElement('b1')
  assert.ok(el?.type === 'label')
  assert.equal(el.backgroundRadius, 0)
  assert.ok(Object.hasOwn(el, 'backgroundRadius'), '0 必须保留，不能被当作缺省')
})

test('UpdateElementCommand deletes keys for undefined and keeps undo symmetric', () => {
  const ed = new Editor(badge())
  const cmd = new UpdateElementCommand(ed, 'b1', { backgroundRadius: undefined, backgroundWidth: 50 } as never, '测试')
  cmd.execute()
  let el = ed.getElement('b1')
  assert.ok(el?.type === 'label')
  assert.ok(!Object.hasOwn(el, 'backgroundRadius'))
  assert.equal(el.backgroundWidth, 50)
  cmd.undo()
  el = ed.getElement('b1')
  assert.ok(el?.type === 'label')
  assert.equal(el.backgroundRadius, 13, '撤销应恢复被删除的字段')
  assert.equal(el.backgroundWidth, 37)
})

test('out-of-range background values are rejected without changing the element', () => {
  const ed = new Editor(badge())
  ed.updateElementProperties(['b1'], { backgroundRadius: 9999 }, '越界')
  let el = ed.getElement('b1')
  assert.ok(el?.type === 'label')
  assert.equal(el.backgroundRadius, 13, '越界值应被拒绝')
  ed.updateElementProperties(['b1'], { backgroundWidth: -5 }, '负值')
  el = ed.getElement('b1')
  assert.ok(el?.type === 'label')
  assert.equal(el.backgroundWidth, 37, '负宽度应被拒绝')
})

test('text colour, bold and alignment are editable and survive a save/load round trip', () => {
  const ed = new Editor(badge())
  ed.updateElementProperties(['b1'], { color: '#000000', bold: false, align: 'right' }, '修改文字样式')
  const el = ed.getElement('b1')
  assert.ok(el?.type === 'label')
  assert.equal(el.color, '#000000')
  assert.equal(el.bold, false)
  assert.equal(el.align, 'right')
  const parsed = parseDocument(serializeDocument(ed.document))
  assert.equal(parsed.ok, true, parsed.error)
  const back = parsed.document!.elements[0]
  assert.ok(back.type === 'label')
  assert.equal(back.color, '#000000')
  assert.equal(back.align, 'right')
  assert.equal(back.background, '#43BFB5')
  assert.equal(back.backgroundRadius, 13)
})

test('a label with a plate is picked inside the plate, not just on the glyphs', () => {
  const ed = new Editor(badge())
  // 底板中心即锚点；hitTest 的包围盒来自 labelBackgroundSize。
  const hit = hitTest({ x: 200, y: 200 }, ed.document.elements, { maxDistance: 2 })
  assert.ok(hit)
  assert.equal(hit.element.type, 'label')
  const size = labelBackgroundSize(ed.getElement('b1') as never)
  assert.equal(size.w, 37)
  assert.equal(size.h, 26)
  // 明显落在底板之外应命中不到（hitTest 对非 OBB 命中用半对角线做保守近似）。
  const far = hitTest({ x: 200 + 40, y: 200 }, ed.document.elements, { maxDistance: 0.5 })
  assert.equal(far, null, '底板之外不应命中')
})

test('plain labels are unaffected by the new controls', () => {
  const ed = new Editor(labelDoc())
  const el = ed.document.elements[0]
  assert.ok(el?.type === 'label')
  assert.equal(el.background, undefined)
  const size = labelBackgroundSize(el)
  assert.ok(size.w > 0 && size.h > 0)
})
