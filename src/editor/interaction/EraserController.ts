import type { Point } from '../../types'
import type { Editor } from '../core/Editor'

/**
 * 橡皮擦工具：按住左键拖动，笔画经过的轨道 / 线段区间红色高亮；
 * 松开后按折点边界切割（删除笔画穿过的段区间），站台、文字等直接删除。
 */
export class EraserController {
  private stroke: Point[] = []

  constructor(private editor: Editor) {}

  get isErasing(): boolean {
    return this.stroke.length > 0
  }

  pointerDown(world: Point): void {
    this.stroke = [{ ...world }]
    this.editor.eraserStroke = this.stroke
    this.editor.eraserHitIds = []
    this.editor.eraserSpans = []
    this.editor.invalidate()
  }

  move(world: Point): void {
    if (this.stroke.length === 0) return
    const last = this.stroke[this.stroke.length - 1]
    if (Math.hypot(world.x - last.x, world.y - last.y) < 1e-6) return
    this.stroke.push({ ...world })
    this.editor.eraserStroke = this.stroke
    const { spans, deleteIds } = this.editor.findEraserHits(this.stroke)
    this.editor.eraserSpans = spans
    this.editor.eraserHitIds = deleteIds
    this.editor.invalidate()
  }

  finish(): void {
    if (this.stroke.length === 0) return
    this.editor.executeEraser(this.stroke)
    this.cancel()
  }

  cancel(): void {
    this.stroke = []
    this.editor.eraserStroke = []
    this.editor.eraserHitIds = []
    this.editor.eraserSpans = []
    this.editor.invalidate()
  }
}
