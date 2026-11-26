import type { RailDocument } from '../../types'
import { Camera } from '../core/Camera'
import { Renderer } from '../render/Renderer'
import { labelDrawnRange } from '../render/LabelRenderer'
import { isTrack } from '../model/Document'

export type ExportFormat = 'png' | 'jpg' | 'pdf'

export interface ExportOptions {
  format: ExportFormat
  /** 导出倍率，1 表示 1 像素 = 1 世界单位。 */
  scale?: number
  /** 导出范围；缺省为全部可见内容的包围盒。 */
  bounds?: { minX: number; minY: number; maxX: number; maxY: number }
  /** 背景色；传 null 表示透明背景（PNG）。 */
  background?: string | null
  /** 边距（世界单位）。 */
  padding?: number
  /** 是否隐藏网格、悬停高亮等编辑器辅助显示。 */
  clean?: boolean
}

export interface ExportResult {
  blob: Blob
  width: number
  height: number
  fileName: string
}

/** 导出上限，防止误操作生成超大位图。 */
export const MAX_EXPORT_PIXELS = 40_000_000
export const MAX_EXPORT_DIMENSION = 20_000

/**
 * 计算导出用的世界包围盒。
 *
 * 复用 Editor 的内容包围盒逻辑会把编辑器辅助图元算进去，
 * 因此这里独立计算，只统计线路 / 线 / 站台 / 车站 / 文字。
 */
export function computeExportBounds(doc: RailDocument, padding = 0): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  const extend = (x: number, y: number, r = 0): void => {
    minX = Math.min(minX, x - r)
    minY = Math.min(minY, y - r)
    maxX = Math.max(maxX, x + r)
    maxY = Math.max(maxY, y + r)
  }
  for (const el of doc.elements) {
    if (!el.visible) continue
    const layer = doc.layers.find((l) => l.id === el.layerId)
    if (layer && !layer.visible) continue
    if (isTrack(el) || el.type === 'line') {
      const half = el.strokeWidth / 2
      for (const p of el.points) extend(p.x, p.y, half + 2)
    } else if (el.type === 'platform') {
      extend(el.start.x, el.start.y, el.width / 2 + 2)
      extend(el.end.x, el.end.y, el.width / 2 + 2)
    } else if (el.type === 'station') {
      extend(el.x, el.y, el.radius + el.borderWidth / 2 + 2)
    } else if (el.type === 'label') {
      // 复用渲染层的绘制范围，导出裁剪与屏幕所见一致。
      const drawn = labelDrawnRange(el)
      const rad = (el.rotation * Math.PI) / 180
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      // 旋转后四角都要纳入，避免斜排文字被裁切。
      for (const c of [
        { x: drawn.left, y: drawn.top },
        { x: drawn.right, y: drawn.top },
        { x: drawn.right, y: drawn.bottom },
        { x: drawn.left, y: drawn.bottom },
      ]) {
        const dx = c.x - el.x
        const dy = c.y - el.y
        extend(el.x + dx * cos - dy * sin, el.y + dx * sin + dy * cos, 2)
      }
    }
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: Math.max(1, doc.canvas.width), maxY: Math.max(1, doc.canvas.height) }
  }
  return { minX: minX - padding, minY: minY - padding, maxX: maxX + padding, maxY: maxY + padding }
}

/**
 * 把文档离屏渲染为位图。
 *
 * 复用同一套 Renderer，导出结果与屏幕所见一致；`clean` 模式隐藏网格、
 * 吸附提示、悬停高亮与选中框，得到「干净的成品图」。
 */
/** 尺寸上限校验：必须在分配 canvas 之前执行。 */
export function assertExportSize(width: number, height: number): void {
  if (width > MAX_EXPORT_DIMENSION || height > MAX_EXPORT_DIMENSION || width * height > MAX_EXPORT_PIXELS) {
    throw new Error(`导出尺寸过大（${width}×${height}），请降低倍率或缩小范围`)
  }
}

export function renderDocumentToCanvas(doc: RailDocument, options: ExportOptions): HTMLCanvasElement {
  // 尺寸上限必须在创建 canvas 之前判定：浏览器会直接分配 width×height×4 字节。
  const scale = Math.max(0.05, Math.min(options.scale ?? 1, 16))
  const padding = options.padding ?? 20
  const b = options.bounds ?? computeExportBounds(doc, padding)
  const worldW = Math.max(1e-6, b.maxX - b.minX)
  const worldH = Math.max(1e-6, b.maxY - b.minY)
  const width = Math.max(1, Math.round(worldW * scale))
  const height = Math.max(1, Math.round(worldH * scale))
  assertExportSize(width, height)

  const canvas = globalThis.document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建导出画布')

  const background = options.background === undefined ? '#ffffff' : options.background
  if (background) {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, width, height)
  }

  const camera = new Camera()
  // 让 (minX, minY) 映射到像素 (0,0)，并按 scale 缩放。
  camera.setTransform(scale, -b.minX * scale, -b.minY * scale)

  const clean = options.clean !== false
  const state = {
    tool: 'select' as const,
    selectionIds: [] as string[],
    selectedPoints: [],
    activeElement: null,
    spacePan: false,
    showGrid: !clean,
    snapGrid: false,
    activeLayerId: null,
    stationKind: 'station' as const,
    bridgeGap: 20,
    hoverElementId: null,
    hoverSegment: null,
    hoverNodeId: null,
    hoverIntersection: null,
    setTool() {},
    setSelection() {},
    setSelectedPoints() {},
    hasSelection: () => false,
    clearHover() {},
  }

  new Renderer().render({
    ctx,
    dpr: 1,
    cssWidth: width,
    cssHeight: height,
    context: { doc, camera, state: state as never },
    snapPoint: null,
    alignmentGuide: null,
    drawPreview: [],
    hoverControl: null,
    marqueeRect: null,
    eraserStroke: [],
    eraserHitIds: [],
    eraserSpans: [],
  })

  return canvas
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('画布编码失败'))
    }, type, quality)
  })
}

/**
 * 导出为 PDF。
 *
 * 单页图片型 PDF：内嵌 JPEG（DCTDecode），无需第三方依赖。
 * 矢量文字与线条会栅格化，这是浏览器端零依赖方案下的取舍。
 */
export async function exportAsPdf(doc: RailDocument, options: ExportOptions): Promise<ExportResult> {
  const canvas = renderDocumentToCanvas(doc, { ...options, background: options.background === null ? '#ffffff' : options.background })
  // JPEG 不支持透明，PDF 内嵌图像必须如此。
  const jpeg = await canvasToBlob(canvas, 'image/jpeg', 0.92)
  const bytes = new Uint8Array(await jpeg.arrayBuffer())
  const pdf = buildSingleImagePdf(bytes, canvas.width, canvas.height)
  // 复制到独立 ArrayBuffer，避免共享底层缓冲的类型问题。
  const blob = new Blob([pdf.slice().buffer as ArrayBuffer], { type: 'application/pdf' })
  return { blob, width: canvas.width, height: canvas.height, fileName: `${sanitize(doc.name)}.pdf` }
}

/** 组装单页图片 PDF。PDF 长度以字节计，故需精确偏移。 */
function buildSingleImagePdf(jpeg: Uint8Array, width: number, height: number): Uint8Array {
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0

  const push = (data: Uint8Array | string): void => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data
    parts.push(bytes)
    length += bytes.length
  }
  const beginObject = (): number => {
    offsets.push(length)
    return offsets.length
  }

  // 二进制注释标记，提示这是二进制文件；用 latin1 字节以保证偏移可预测。
  push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))

  // 1: Catalog  2: Pages  3: Page  4: Contents  5: Image
  beginObject()
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  beginObject()
  push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')
  beginObject()
  // 页面尺寸取图像像素（1px = 1pt），避免额外缩放计算。
  push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] `
    + `/Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>\nendobj\n`,
  )
  const content = `q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ\n`
  beginObject()
  push(`4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`)
  beginObject()
  push(
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} `
    + '/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '
    + `${jpeg.length} >>\nstream\n`,
  )
  push(jpeg)
  push('\nendstream\nendobj\n')

  const xrefStart = length
  let xref = `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`
  push(xref)
  push(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`)

  const out = new Uint8Array(length)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** 导出为位图（JPG / PNG）。 */
export async function exportAsImage(doc: RailDocument, options: ExportOptions): Promise<ExportResult> {
  const jpg = options.format === 'jpg'
  // JPG 无透明通道，透明背景会变成黑色，这里强制白底。
  const background = jpg ? (options.background === null ? '#ffffff' : options.background) : options.background
  const canvas = renderDocumentToCanvas(doc, { ...options, background })
  const blob = await canvasToBlob(canvas, jpg ? 'image/jpeg' : 'image/png', jpg ? 0.92 : undefined)
  return {
    blob,
    width: canvas.width,
    height: canvas.height,
    fileName: `${sanitize(doc.name)}.${jpg ? 'jpg' : 'png'}`,
  }
}

export async function exportDocument(doc: RailDocument, options: ExportOptions): Promise<ExportResult> {
  return options.format === 'pdf' ? exportAsPdf(doc, options) : exportAsImage(doc, options)
}

function sanitize(name: string): string {
  const cleaned = (name || '未命名项目').replace(/[\\/:*?"<>|]/g, '_')
  return cleaned.slice(0, 80) || '未命名项目'
}

/** 触发浏览器下载。 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = globalThis.document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

