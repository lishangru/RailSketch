import test from 'node:test'
import assert from 'node:assert/strict'
import { isLabel } from '../src/editor/model/Document'
import { LabelRenderer, labelDrawnRange, measureLabel } from '../src/editor/render/LabelRenderer'
import { Camera } from '../src/editor/core/Camera'
import { createDocument, migrateDocument } from '../src/editor/model/Document'
import { createLabel } from '../src/editor/model/Label'
import type { LabelElement } from '../src/types'

/** 记录 fillText 参数的最小上下文。 */
function captureFillText() {
  const calls: { text: string; x: number; y: number; align: string; baseline: string }[] = []
  let align = 'left'
  let baseline = 'alphabetic'
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_, key: string) => {
      if (key === 'fillText') {
        return (text: string, x: number, y: number) => calls.push({ text, x, y, align, baseline })
      }
      if (key === 'textAlign') return align
      if (key === 'textBaseline') return baseline
      if (key === 'font') return ''
      if (key === 'measureText') return () => ({ width: 0 })
      return () => {}
    },
    set: (_t, key: string, value: unknown) => {
      if (key === 'textAlign') align = String(value)
      if (key === 'textBaseline') baseline = String(value)
      return true
    },
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}

function renderOne(label: LabelElement) {
  const doc = migrateDocument((() => {
    const d = createDocument('t')
    d.layers[0]!.locked = false
    d.elements.push(label)
    return d
  })())
  const { ctx, calls } = captureFillText()
  const camera = new Camera()
  camera.setTransform(1, 0, 0)
  new LabelRenderer().render(ctx, camera, doc)
  return calls
}

test('centred text is centred by the canvas, not by a manual offset', () => {
  const label = { ...createLabel({ text: '4', x: 1768, y: 646, layerId: '', fontSize: 17 }), align: 'center' as const, bold: true, background: '#7671B4', backgroundWidth: 26, backgroundHeight: 26, backgroundRadius: 13 }
  const calls = renderOne(label)
  assert.equal(calls.length, 1)
  const call = calls[0]!
  // 关键回归：不再用「估算宽度 / 2」把文字推到左边，而是让 Canvas 用真实字形居中。
  assert.equal(call.align, 'center', '居中文字应使用 canvas 的 center 对齐')
  assert.equal(call.x, 0, '居中文字的绘制原点应在锚点上，不再手动平移')
  assert.equal(call.baseline, 'middle')
})

test('left and right aligned text also draw at the anchor with matching canvas alignment', () => {
  const left = renderOne(createLabel({ text: '八卦洲大桥南', x: 1099, y: 540, layerId: '', fontSize: 14 }))
  assert.equal(left[0]!.align, 'left')
  assert.equal(left[0]!.x, 0)

  const right = renderOne({ ...createLabel({ text: '终点', x: 500, y: 400, layerId: '', fontSize: 14 }), align: 'right' })
  assert.equal(right[0]!.align, 'right')
  assert.equal(right[0]!.x, 0)

  const plain = renderOne(createLabel({ text: '无 align', x: 10, y: 20, layerId: '', fontSize: 14 }))
  assert.equal(plain[0]!.align, 'left', '缺省应为左对齐')
  assert.equal(plain[0]!.x, 0)
})

test('the drawn range still matches the anchor for each alignment', () => {
  // 命中框以锚点推导宽度，而渲染交给 Canvas；两者必须指向同一个中心。
  for (const align of ['left', 'center', 'right'] as const) {
    const label = { ...createLabel({ text: '南京南站', x: 500, y: 400, layerId: '', fontSize: 17 }), align }
    const drawn = labelDrawnRange(label)
    if (align === 'center') {
      assert.ok(Math.abs((drawn.left + drawn.right) / 2 - 500) < 1e-9, '居中范围应以锚点为中心')
    } else if (align === 'right') {
      assert.ok(Math.abs(drawn.right - 500) < 1e-9, '右对齐范围的右边缘应是锚点')
    } else {
      assert.ok(Math.abs(drawn.left - 500) < 1e-9, '左对齐范围的左边缘应是锚点')
    }
  }
})

test('badge plates stay centred on their anchor regardless of text width', () => {
  const badges = ['1', 'S10', '10号线', 'Line 11'].map((text, i) => ({
    ...createLabel({ text, x: 100 + i * 70, y: 200 + i * 13, layerId: '', fontSize: 17 }),
    background: '#00ABE1',
  }))
  for (const b of badges) {
    const drawn = labelDrawnRange(b)
    const cx = (drawn.left + drawn.right) / 2
    const cy = (drawn.top + drawn.bottom) / 2
    assert.ok(Math.abs(cx - b.x) < 1e-6, `徽标 ${b.text} 水平未居中：${cx} vs ${b.x}`)
    assert.ok(Math.abs(cy - b.y) < 1e-6, `徽标 ${b.text} 垂直未居中：${cy} vs ${b.y}`)
  }
})

test('the width estimate is no longer used for centring, so font metrics cannot skew badges', () => {
  // 若渲染再次改回「按估算宽度手动平移」，这个断言会失败。
  const label = { ...createLabel({ text: 'S10', x: 300, y: 300, layerId: '', fontSize: 17 }), align: 'center' as const, background: '#ED9B5C', backgroundWidth: 37, backgroundHeight: 26, backgroundRadius: 13 }
  const calls = renderOne(label)
  assert.equal(calls[0]!.x, 0)
  assert.notEqual(measureLabel(label).w, 0, '估算宽度仍用于命中框与底板自动尺寸')
})
