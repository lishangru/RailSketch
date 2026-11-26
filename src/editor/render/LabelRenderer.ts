import type { LabelElement, RailDocument } from '../../types'
import type { Camera } from '../core/Camera'
import { isLabel } from '../model/Document'

/** 底板缺省内边距（世界单位）。 */
const BADGE_PADDING_X = 7
const BADGE_PADDING_Y = 4

/** 未测量到真实字形宽度时的兜底估算系数：中文 1.0 字号，ASCII 0.55 字号。 */
const ASCII_WIDTH_RATIO = 0.55

/**
 * 自动推导的文字色使用纯黑 / 纯白。
 *
 * 只有纯黑纯白才能保证「任取底色，对比度都不低于 4.58:1」（WCAG AA 正文为 4.5:1）；
 * 用带色调的近黑（如 #111827）会在中等亮度底色上跌到 4.0 左右而变得难读。
 */
const DARK_TEXT = '#000000'
const LIGHT_TEXT = '#ffffff'

/** 解析 #rgb / #rrggbb；无法解析时按浅色底处理。 */
function parseHex(color: string): [number, number, number] | null {
  const hex = color.trim().replace(/^#/, '')
  if (hex.length === 3) {
    const [r, g, b] = [hex[0]!, hex[1]!, hex[2]!]
    return [parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16)]
  }
  if (hex.length === 6 && /^[0-9a-f]{6}$/i.test(hex)) {
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]
  }
  return null
}

/** WCAG 相对亮度（0 = 黑，1 = 白）。 */
export function relativeLuminance(color: string): number {
  const rgb = parseHex(color)
  if (!rgb) return 1
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * 给定底色，返回对比度更高的文字色。
 *
 * 取黑/白中对比度更高者：对任何底色该比值都不低于 4.58:1（WCAG AA 正文要求 4.5:1），
 * 因此不会出现「改了底色却看不见文字」。
 */
export function contrastTextColor(background: string): string {
  const l = relativeLuminance(background)
  // 交叉点约在 L = 0.179：高于此值用深色字，低于则用浅色字。
  return l > 0.179 ? DARK_TEXT : LIGHT_TEXT
}

/** 两色对比度（WCAG 公式），用于判断文字在底板上是否可读。 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

export function measureLabel(l: LabelElement): { w: number; h: number } {
  let units = 0
  for (const ch of l.text) units += ch.charCodeAt(0) > 0x2e80 ? 1 : ASCII_WIDTH_RATIO
  return { w: units * l.fontSize, h: l.fontSize * 1.2 }
}

export function labelBackgroundSize(l: LabelElement): { w: number; h: number } {
  const text = measureLabel(l)
  return {
    w: l.backgroundWidth ?? text.w + BADGE_PADDING_X * 2,
    h: l.backgroundHeight ?? text.h + BADGE_PADDING_Y * 2,
  }
}

/**
 * 文字在屏幕上占据的包围盒尺寸。
 *
 * 渲染、命中测试、导出裁剪都必须用这一个入口，否则三处的文字范围会各说各话，
 * 表现为「点击位置和看到的文字对不上」。
 */
export function labelBoxSize(l: LabelElement): { w: number; h: number } {
  return l.background ? labelBackgroundSize(l) : measureLabel(l)
}

/**
 * 文字（含底板）在世界坐标中的实际绘制范围。
 *
 * 渲染、命中测试、橡皮擦、导出裁剪都以此为唯一依据：
 * `fillText` 的横向偏移必须与包围盒中心成对推导，否则命中框会整体偏移半个字宽。
 */
export function labelDrawnRange(l: LabelElement): { left: number; right: number; top: number; bottom: number } {
  const { w, h } = labelBoxSize(l)
  const dx = l.background ? -w / 2 : l.align === 'center' ? -w / 2 : l.align === 'right' ? -w : 0
  return { left: l.x + dx, right: l.x + dx + w, top: l.y - h / 2, bottom: l.y + h / 2 }
}

export class LabelRenderer {
  render(ctx: CanvasRenderingContext2D, camera: Camera, doc: RailDocument): void {
    ctx.save()
    ctx.transform(camera.zoom, 0, 0, camera.zoom, camera.offsetX, camera.offsetY)
    for (const el of doc.elements) {
      if (!isLabel(el)) continue
      if (!el.visible) continue
      const layer = doc.layers.find((l) => l.id === el.layerId)
      if (layer && !layer.visible) continue
      this.renderLabel(ctx, el)
    }
    ctx.restore()
  }

  private renderLabel(ctx: CanvasRenderingContext2D, l: LabelElement): void {
    // 带底板时文字必须居中于底板：底板恒以锚点为中心，若再按 align 偏移，
    // 「左对齐」会把文字推到底板右半边、「右对齐」推到左半边，看起来正好反了。
    // align 只对无底板的纯文字生效。
    const align = l.background ? 'center' : (l.align ?? 'left')

    ctx.save()
    ctx.translate(l.x, l.y)
    ctx.rotate((l.rotation * Math.PI) / 180)

    if (l.background) {
      const { w, h } = labelBackgroundSize(l)
      // 底板始终以 (x, y) 为中心，与 align 无关。
      const r = l.backgroundRadius ?? h / 2
      ctx.fillStyle = l.background
      ctx.beginPath()
      if (r > 0.01) {
        const rr = Math.min(r, w / 2, h / 2)
        ctx.moveTo(-w / 2 + rr, -h / 2)
        ctx.arcTo(w / 2, -h / 2, w / 2, h / 2, rr)
        ctx.arcTo(w / 2, h / 2, -w / 2, h / 2, rr)
        ctx.arcTo(-w / 2, h / 2, -w / 2, -h / 2, rr)
        ctx.arcTo(-w / 2, -h / 2, w / 2, -h / 2, rr)
        ctx.closePath()
      } else {
        ctx.rect(-w / 2, -h / 2, w, h)
      }
      ctx.fill()
    }

    ctx.fillStyle = l.color ?? '#111827'
    ctx.font = `${l.bold ? '700 ' : ''}${l.fontSize}px system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`
    // 交给 Canvas 用真实字形宽度做对齐：手动按估算宽度平移会因字体差异产生偏移。
    // 'start' / 'end' 是逻辑方向，与 align 的 left / right 语义一致（不支持时回退）。
    ctx.textAlign = align === 'center' ? 'center' : align === 'right' ? 'right' : 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(l.text, 0, 0)
    ctx.restore()
  }
}
