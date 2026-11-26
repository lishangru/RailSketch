import type { Point } from '../../types'
import type { Editor } from '../core/Editor'

/**
 * 轨道 / 线元素 / 道岔岔线的连续折线绘制：连续点击添加顶点，
 * 双击结束（带防抖，避免双击时多画出一段线），Esc 取消整条草稿。
 * 提交时按当前工具分发（commitDraft）。
 */
export class DrawTrackController {
  private draft: Point[] = []
  private lastClickTime = 0
  private lastClickPos: Point | null = null

  constructor(private editor: Editor) {}

  get isDrawing(): boolean {
    return this.draft.length > 0
  }

  get draftPoints(): Point[] {
    return this.draft
  }

  private syncPreview(): void {
    this.editor.drawPreview = this.draft.slice()
    this.editor.invalidate()
  }

  /** 第一次点击开始草稿。 */
  begin(p: Point): void {
    this.draft = [p]
    this.lastClickTime = 0
    this.lastClickPos = null
    this.syncPreview()
  }

  /**
   * 在 click 事件中追加顶点。
   * 防抖：与前一次点击时间 / 位置接近时视为双击结束，不追加顶点。
   */
  addPoint(p: Point): void {
    if (!this.isDrawing) {
      const snapped = this.editor.getSnapPoint(p, false, undefined, true).point
      this.begin(snapped)
      return
    }
    // 双击防抖：300ms 内、5px 内重复点击 → 结束绘制。
    const now = Date.now()
    if (this.lastClickPos && now - this.lastClickTime < 300) {
      const px = 5 / this.editor.camera.zoom
      if (Math.hypot(p.x - this.lastClickPos.x, p.y - this.lastClickPos.y) < px) {
        this.finish()
        return
      }
    }
    this.lastClickTime = now
    this.lastClickPos = { ...p }
    const last = this.draft[this.draft.length - 1]
    const snapped = this.editor.getSnapPoint(p, this.editor.isAngleSnapActive, last, true).point
    if (Math.hypot(snapped.x - last.x, snapped.y - last.y) < 1e-4) return
    this.draft.push({ ...snapped })
    this.syncPreview()
  }

  /** 鼠标移动时更新预览终点（应用角度吸附由 PointerController 传入最终点）。 */
  updateHover(p: Point): void {
    if (!this.isDrawing) return
    const pts = this.draft.slice()
    const last = pts[pts.length - 1]
    const target = this.editor.getSnapPoint(p, this.editor.isAngleSnapActive, last, true).point
    pts.push(target)
    this.editor.drawPreview = pts
    this.editor.invalidate()
  }

  /** 双击结束：直接提交，不追加顶点（防抖已在 addPoint 处理）。 */
  finish(): void {
    if (this.draft.length === 0) return
    const points = this.draft.map((p) => ({ ...p }))
    if (points.length >= 2) {
      this.editor.commitDraft(points)
    }
    this.cancel()
  }

  /** Esc：取消整条草稿（包括道岔岔线草稿）。 */
  cancelCurrentStep(): void {
    this.cancel()
  }

  cancel(): void {
    this.draft = []
    this.editor.drawPreview = []
    this.editor.snapPoint = null
    this.editor.alignmentGuide = null
    this.editor.switchDraft = null
    this.editor.invalidate()
  }
}
