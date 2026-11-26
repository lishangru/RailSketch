import type { Point } from '../../types'
import type { Editor } from '../core/Editor'
import { distance } from '../geometry/Point'

/** 选择工具：点击命中、空白取消、平台草稿 + 文字入口。 */
export class SelectionController {
  draftPlatform = { active: false, start: { x: 0, y: 0 } }

  constructor(private editor: Editor) {}

  onPointerDown(world: Point, transfer = false): void {
    const tool = this.editor.state.tool
    if (tool === 'track') return

    if (tool === 'platform') {
      this.beginOrFinishPlatform(world)
      return
    }
    if (tool === 'label') {
      const snapped = this.editor.getSnapPoint(world, false).point
      this.editor.snapPoint = null
      this.editor.requestLabelPlacement?.(snapped)
      return
    }
    if (tool === 'station') {
      // 车站是单点图元：单击即落点；按住 Shift 直接画换乘站。
      // 开启线路吸附，使站点自动落在轨道中心线上。
      const snapped = this.editor.getSnapPoint(world, false, undefined, true)
      this.editor.snapPoint = null
      const kind = transfer ? 'transfer' : this.editor.state.stationKind
      this.editor.commitStation(snapped.point, kind)
      return
    }

    // —— 选择工具 ——
    const control = this.editor.hitTestControlPoint(world)
    if (control) {
      // 拖动控制点由 DragController 接管（在 PointerController 中协调）。
      return
    }
    const hit = this.editor.hitTest(world)
    if (hit) {
      this.editor.setSelection([hit.element.id])
    } else {
      this.editor.clearSelection()
    }
  }

  /** 平台草稿：鼠标移动时更新第二端点实时预览。 */
  updatePlatformPreview(world: Point): void {
    if (!this.draftPlatform.active) return
    const start = this.draftPlatform.start
    const target = this.editor.getSnapPoint(world, this.editor.isAngleSnapActive, start).point
    this.editor.drawPreview = [{ ...start }, target]
    this.editor.invalidate()
  }

  private beginOrFinishPlatform(world: Point): void {
    if (!this.draftPlatform.active) {
      const snapped = this.editor.getSnapPoint(world, false).point
      this.draftPlatform.active = true
      this.draftPlatform.start = { ...snapped }
      this.editor.drawPreview = [{ ...snapped }]
      this.editor.invalidate()
      return
    }
    const start = this.draftPlatform.start
    const end = this.editor.getSnapPoint(world, this.editor.isAngleSnapActive, start).point
    if (distance(start, end) < 1) return
    this.editor.commitPlatform(start, end)
    this.cancelDraftPlatform()
  }

  cancelDraftPlatform(): void {
    this.draftPlatform.active = false
    this.editor.drawPreview = []
    this.editor.snapPoint = null
    this.editor.invalidate()
  }
}
