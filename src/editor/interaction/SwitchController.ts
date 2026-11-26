import type { Point } from '../../types'
import type { Editor } from '../core/Editor'

/**
 * 道岔工具：点击既有线路确定主线锚点后，岔线像画轨道一样连续绘制折线
 * （角度吸附、双击结束、Esc 取消）。主线不拆线：提交时在锚点插入顶点
 * 并建立 switch 节点，岔线以该节点为起点。
 */
export class SwitchController {
  constructor(private editor: Editor) {}

  get isActive(): boolean {
    return this.editor.switchDraft != null
  }

  hover(world: Point): void {
    const seg = this.editor.hitTestSegment(world)
    this.editor.state.hoverSegment = seg ? { trackId: seg.track.id, index: seg.index } : null
    this.editor.invalidate()
  }

  /** 第一阶段：点击主线，确定锚点并开始岔线草稿。 */
  pointerDown(world: Point): void {
    if (this.isActive) return
    const seg = this.editor.hitTestSegment(world)
    if (!seg || !this.editor.isSelectable(seg.track)) return
    const p = this.projectOnSegment(world, seg.track.points[seg.index], seg.track.points[seg.index + 1])
    this.editor.switchDraft = { trackId: seg.track.id, anchor: { ...p } }
    this.editor.drawTrack.begin({ ...p })
  }

  /** 第二阶段：像画轨道一样移动预览。 */
  move(world: Point): void {
    if (!this.isActive) return
    this.editor.drawTrack.updateHover(world)
  }

  /** 追加岔线顶点（双击防抖由 DrawTrackController 处理）。 */
  click(world: Point): void {
    if (!this.isActive) return
    this.editor.drawTrack.addPoint(world)
  }

  cancel(): void {
    this.editor.switchDraft = null
    this.editor.drawTrack.cancel()
    this.editor.state.hoverSegment = null
    this.editor.invalidate()
  }

  private projectOnSegment(p: Point, a: Point, b: Point): Point {
    const abx = b.x - a.x
    const aby = b.y - a.y
    const lenSq = abx * abx + aby * aby || 1
    let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq
    t = Math.max(0, Math.min(1, t))
    return { x: a.x + abx * t, y: a.y + aby * t }
  }
}
