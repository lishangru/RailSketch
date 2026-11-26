import test from 'node:test'
import assert from 'node:assert/strict'
import { isLabel } from '../src/editor/model/Document'
import { LabelRenderer, labelBoxSize, contrastRatio, contrastTextColor, relativeLuminance } from '../src/editor/render/LabelRenderer'
import { Camera } from '../src/editor/core/Camera'
import { createDocument, migrateDocument } from '../src/editor/model/Document'
import { createLabel } from '../src/editor/model/Label'
import type { LabelElement } from '../src/types'

/** 记录 fillText 的 canvas 对齐方式与绘制原点。 */
function renderOne(label: LabelElement) {
  const doc = createDocument('t')
  doc.elements.push(label)
  const texts: { x: number; align: string }[] = []
  const fills: string[] = []
  let tx = 0
  let align = 'left'
  let fillStyle = ''
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_, k: string) => {
      if (k === 'translate') return (x: number) => { tx = x }
      if (k === 'fillText') return (_t: string, x: number) => { texts.push({ x: tx + x, align }) }
      if (k === 'fill') return () => { fills.push(fillStyle) }
      if (k === 'textAlign') return align
      if (k === 'fillStyle') return fillStyle
      return () => {}
    },
    set: (_t, k: string, v: unknown) => {
      if (k === 'textAlign') align = String(v)
      if (k === 'fillStyle') fillStyle = String(v)
      return true
    },
  })
  const cam = new Camera()
  cam.setTransform(1, 0, 0)
  new LabelRenderer().render(ctx as unknown as CanvasRenderingContext2D, cam, migrateDocument(doc))
  return { texts, fills }
}

function plated(extra: Record<string, unknown> = {}): LabelElement {
  return {
    ...createLabel({ text: '4', x: 500, y: 300, layerId: '', fontSize: 17 }),
    align: 'center',
    bold: true,
    background: '#7671B4',
    backgroundWidth: 26,
    backgroundHeight: 26,
    backgroundRadius: 13,
    ...extra,
  } as LabelElement
}

test('relative luminance orders colours from black to white', () => {
  assert.ok(relativeLuminance('#000000') < 0.01)
  assert.ok(relativeLuminance('#ffffff') > 0.99)
  assert.ok(relativeLuminance('#000000') < relativeLuminance('#7671B4'))
  assert.ok(relativeLuminance('#7671B4') < relativeLuminance('#ffffff'))
  // 3 位简写也要支持
  assert.equal(relativeLuminance('#fff'), relativeLuminance('#ffffff'))
  assert.equal(relativeLuminance('#000'), relativeLuminance('#000000'))
})

test('contrastTextColor picks a readable colour for light and dark plates', () => {
  // 5 号线浅黄、10 号线浅棕：白字会看不见，必须给深色字。
  assert.equal(contrastTextColor('#FFE637'), '#000000')
  assert.equal(contrastTextColor('#E4B983'), '#000000')
  assert.equal(contrastTextColor('#ffffff'), '#000000')
  assert.equal(contrastTextColor('#000000'), '#ffffff')
  // 青色亮度偏高，白字对比度只有 2.65:1，因此必须用深色字。
  assert.equal(contrastTextColor('#00ABE1'), '#000000')
  assert.ok(contrastRatio('#ffffff', '#00ABE1') < 4.5, '青色底配白字本来就不可读')
  // 4 号线紫是临界色：白字 4.40、深字（近黑）4.05，都不够，必须用纯黑 7.9。
  assert.equal(contrastTextColor('#7671B4'), '#000000')

  // 关键保证：无论底色如何，返回值都达到 WCAG AA 正文对比度。
  for (const bg of ['#FFE637', '#E4B983', '#00ABE1', '#C30945', '#7671B4', '#FCB53D', '#ffffff', '#000000', '#888888', '#222222', '#43BFB5', '#ED9B5C']) {
    assert.ok(contrastRatio(contrastTextColor(bg), bg) >= 4.5, `${bg} 上的文字对比度不足`)
  }
})

test('text is always centred inside its plate, whatever align says', () => {
  // 回归：底板恒以锚点为中心，文字若再按 align 偏移就会偏到底板的一侧。
  for (const align of ['left', 'center', 'right'] as const) {
    const { texts } = renderOne(plated({ align }))
    assert.equal(texts[0]!.align, 'center', `align=${align} 时文字应居中于底板`)
    assert.equal(texts[0]!.x, 500, '文字绘制原点应在锚点')
  }
})

function plain(extra: Record<string, unknown> = {}): LabelElement {
  return { ...createLabel({ text: '站名', x: 500, y: 300, layerId: '', fontSize: 14 }), ...extra } as LabelElement
}

test('plain text still honours left, centre and right alignment', () => {
  const left = renderOne(plain({ align: 'left' }))
  assert.equal(left.texts[0]!.align, 'left')
  assert.equal(left.texts[0]!.x, 500)

  const center = renderOne(plain({ align: 'center' }))
  assert.equal(center.texts[0]!.align, 'center')

  const right = renderOne(plain({ align: 'right' }))
  assert.equal(right.texts[0]!.align, 'right')
  assert.equal(right.texts[0]!.x, 500, '右对齐同样以锚点为原点')
})

test('the plate is filled with the configured background colour', () => {
  const { fills } = renderOne(plated({ background: '#ff0000' }))
  assert.ok(fills.includes('#ff0000'), `底板应使用 #ff0000，实际 ${fills.join(',')}`)
})

test('changing only the plate colour keeps a readable text colour in the demo', () => {
  // 模拟用户在属性面板把浅黄徽标改成深色：白字会消失，应给出可读色。
  assert.equal(contrastTextColor('#FFE637'), '#000000')
  assert.equal(contrastTextColor('#222222'), '#ffffff')
  // 无论怎么改底色，只要用 contrastTextColor 就一定可读。
  for (const bg of ['#FFE637', '#f0f0f0', '#888888', '#222222', '#000000']) {
    assert.ok(contrastRatio(contrastTextColor(bg), bg) >= 4.5)
  }
})

test('labelBoxSize uses the plate size so hit area matches the drawn plate', () => {
  const label = plated()
  assert.deepEqual(labelBoxSize(label), { w: 26, h: 26 })
})
