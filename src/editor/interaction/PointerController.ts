import type { Point } from '../../types'
import type { Editor } from '../core/Editor'
import { distance } from '../geometry/Point'

type Mode = 'idle' | 'pan' | 'select' | 'marquee' | 'draw-track' | 'platform' | 'switch' | 'node' | 'segment' | 'eraser'

/**
 * 统一指针事件入口，将事件转换为世界坐标后分发给各交互控制器。
 */
export class PointerController {
  private canvas: HTMLCanvasElement | null = null
  private mode: Mode = 'idle'
  private activePointerId: number | null = null
  private downScreen: Point = { x: 0, y: 0 }
  private downWorld: Point = { x: 0, y: 0 }
  private suppressClickAfterDrag = false
  private marqueeAdditive = false
  downDragDistance = 0

  constructor(private editor: Editor) {}

  get isDown(): boolean {
    return this.mode !== 'idle'
  }

  bind(canvas: HTMLCanvasElement): void {
    if (this.canvas) this.unbind()
    this.canvas = canvas
    canvas.addEventListener('pointerdown', this.handlePointerDown, { passive: false })
    canvas.addEventListener('pointermove', this.handlePointerMove, { passive: false })
    canvas.addEventListener('pointerup', this.handlePointerUp)
    canvas.addEventListener('pointercancel', this.handlePointerCancel)
    canvas.addEventListener('lostpointercapture', this.handlePointerCancel)
    canvas.addEventListener('dblclick', this.handleDblClick)
    canvas.addEventListener('click', this.handleClick)
    canvas.addEventListener('wheel', this.handleWheel, { passive: false })
    canvas.addEventListener('contextmenu', this.handleContext)
  }

  unbind(): void {
    const canvas = this.canvas
    this.cancel()
    if (!canvas) return
    canvas.removeEventListener('pointerdown', this.handlePointerDown)
    canvas.removeEventListener('pointermove', this.handlePointerMove)
    canvas.removeEventListener('pointerup', this.handlePointerUp)
    canvas.removeEventListener('pointercancel', this.handlePointerCancel)
    canvas.removeEventListener('lostpointercapture', this.handlePointerCancel)
    canvas.removeEventListener('dblclick', this.handleDblClick)
    canvas.removeEventListener('click', this.handleClick)
    canvas.removeEventListener('wheel', this.handleWheel)
    canvas.removeEventListener('contextmenu', this.handleContext)
    this.canvas = null
    this.mode = 'idle'
  }

  /** 取消所有临时交互；必须在更换文档或执行 undo/redo 之前调用。 */
  cancel(): void {
    this.mode = 'idle'
    this.releasePointer()
    this.editor.drag.cancel()
    this.editor.nodeController.cancel()
    this.editor.segmentController.cancel()
    this.editor.eraser.cancel()
    this.editor.drawTrack.cancel()
    this.editor.switchController.cancel()
    this.editor.selectionController.cancelDraftPlatform()
    this.editor.pan.cancel()
    this.editor.marqueeRect = null
    this.editor.hoverControl = null
    this.editor.state.clearHover()
    this.editor.snapPoint = null
    this.editor.alignmentGuide = null
    this.downScreen = { x: 0, y: 0 }
    this.downWorld = { x: 0, y: 0 }
    this.downDragDistance = 0
    this.marqueeAdditive = false
    // 防止取消后浏览器继续派发 click，意外提交新草稿；下一次 down 会复位。
    this.suppressClickAfterDrag = true
    this.refreshCursor()
    this.editor.invalidate()
  }

  /**
   * 顶点是否优先于普通图元。
   *
   * 线网图上顶点极其密集（每个站点处都有轨道顶点，且相邻顶点间距可小于 1px），
   * 若顶点一律优先，点击站点会被同位置的顶点抢走，多选因此只选中一个。
   *
   * 规则：顶点必须比当前最近的可选中图元明显更近（差值超过一个像素）才优先；
   * 附近没有其他图元时，顶点照常优先，便于选中孤立顶点。
   */
  private shouldPreferControlPoint(world: Point): boolean {
    const control = this.editor.hitTestControlPoint(world)
    if (!control) return false
    const near = this.editor.hitTest(world)
    if (!near) return true
    const vertexDistance = distance(world, control.element.points[control.index]!)
    // 顶点与图元重合（站点正压在顶点上）时按图元处理。
    return near.worldDistance - vertexDistance > 1 / this.editor.camera.zoom
  }

  private releasePointer(): void {
    const id = this.activePointerId
    this.activePointerId = null
    if (id !== null && this.canvas?.hasPointerCapture?.(id)) this.canvas.releasePointerCapture(id)
  }

  private handlePointerCancel = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) return
    this.cancel()
  }

  private toScreen(e: MouseEvent): Point {
    const rect = this.canvas!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  private handlePointerDown = (e: PointerEvent): void => {
    if (!this.canvas || !this.canvas.contains(e.target as Node)) return
    if (this.activePointerId !== null || (e.button !== 0 && e.button !== 1)) return
    this.activePointerId = e.pointerId
    this.suppressClickAfterDrag = false
    this.canvas.focus({ preventScroll: true })
    this.canvas.setPointerCapture?.(e.pointerId)
    const screen = this.toScreen(e)
    const world = this.editor.screenToWorld(screen)
    this.editor.setMouseScreen(screen)
    this.downScreen = screen
    this.downWorld = world
    this.downDragDistance = 0

    if (e.button === 1) {
      this.mode = 'pan'
      this.editor.pan.begin(screen)
      e.preventDefault()
      return
    }
    if (e.button === 0 && this.editor.spacePan) {
      this.mode = 'pan'
      this.editor.pan.begin(screen)
      e.preventDefault()
      return
    }
    if (e.button !== 0) return

    const tool = this.editor.state.tool
    if (tool === 'track' || tool === 'line') {
      this.mode = 'draw-track'
      return
    }
    if (tool === 'eraser') {
      this.mode = 'eraser'
      this.editor.eraser.pointerDown(world)
      return
    }
    if (tool === 'platform') {
      this.mode = 'platform'
      return
    }
    if (tool === 'label') {
      this.mode = 'select'
      return
    }
    if (tool === 'station') {
      // 车站为单击落点，复用 select 模式的下派路径。
      this.mode = 'select'
      return
    }
    if (tool === 'switch') {
      this.mode = 'switch'
      this.editor.switchController.pointerDown(world)
      return
    }
    if (tool === 'node') {
      this.mode = 'node'
      this.editor.nodeController.pointerDown(world)
      return
    }
    if (tool === 'segment') {
      this.mode = 'segment'
      this.editor.segmentController.pointerDown(world)
      return
    }

    // —— 选择工具 ——
    this.mode = 'select'
    const additive = e.ctrlKey || e.metaKey

    // 多选后从已选中对象按下：整批拖动。必须早于下方"就近优先"判定，
    // 否则密集图元（站点圆圈 / 站名 / 线路重叠）会命中邻近对象而把选择收窄成一个。
    if (!additive && this.editor.state.selectionIds.length > 1) {
      const grabbed = this.editor.hitTestSelected(world)
      if (grabbed) {
        this.editor.drag.beginBatchDrag(this.editor.state.selectionIds, world)
        return
      }
    }

    // 方向标识 / 文字优先：点击其文字框位置时选中它们本身（即使与线路 / 控制点重叠）。
    const markerLabelHit = this.editor.hitTestMarkerLabel(world)
    if (markerLabelHit) {
      if (additive) {
        const ids = this.editor.state.selectionIds.slice()
        const idx = ids.indexOf(markerLabelHit.id)
        if (idx >= 0) ids.splice(idx, 1)
        else ids.push(markerLabelHit.id)
        this.editor.setSelection(ids)
        return
      }
      this.editor.setSelection([markerLabelHit.id])
      if (markerLabelHit.type === 'label') this.editor.drag.beginElementDrag(markerLabelHit.id, world)
      return
    }
    // 控制点优先：点可以单独选中 / 拖动 / 批量移动。
    // 顶点必须近于「站点 / 站台 / 文字」的拾取半径才会优先，否则密集顶点
    // （线网图上每个站点都有顶点）会抢走它们的点击。
    if (this.shouldPreferControlPoint(world)) {
      const control = this.editor.hitTestControlPoint(world)!
      if (additive) {
        this.editor.togglePointSelection(control.element.id, control.index)
        return
      }
      const sel = this.editor.state.selectedPoints
      const already = sel.some((s) => s.elementId === control.element.id && s.index === control.index)
      if (!already) this.editor.setSelectedPoints([{ elementId: control.element.id, index: control.index }])
      if (sel.length > 1 && already) {
        this.editor.drag.beginPointsDrag(sel, world)
      } else {
        this.editor.drag.beginPointDrag(control.element.id, control.index)
      }
      return
    }
    if (!additive) {
      const platformHandle = this.editor.hitTestPlatformEndpoint(world)
      if (platformHandle) {
        this.editor.drag.beginPlatformEndpointDrag(platformHandle.element.id, platformHandle.endpoint)
        return
      }
    }

    const hit = this.editor.hitTest(world)
    if (hit) {
      if (additive) {
        // Ctrl / Cmd 多选：切换选中状态，不进入拖动。
        const ids = this.editor.state.selectionIds.slice()
        const idx = ids.indexOf(hit.element.id)
        if (idx >= 0) ids.splice(idx, 1)
        else ids.push(hit.element.id)
        this.editor.setSelection(ids)
        return
      }
      const alreadySelected = this.editor.state.selectionIds.includes(hit.element.id)
      const multi = this.editor.state.selectionIds.length > 1
      if (multi && alreadySelected) {
        // 兜底：命中对象确实在选区内，走整批拖动。
        this.editor.drag.beginBatchDrag(this.editor.state.selectionIds, world)
        return
      }
      if (multi && this.editor.hitTestSelected(world)) {
        // 命中的是选区外的邻近对象，但指针确实落在某个已选中对象上：仍按整批拖动。
        this.editor.drag.beginBatchDrag(this.editor.state.selectionIds, world)
        return
      }
      this.editor.setSelection([hit.element.id])
      if (hit.element.type === 'track' || hit.element.type === 'platform' || hit.element.type === 'station' || hit.element.type === 'label' || hit.element.type === 'line') {
        this.editor.drag.beginElementDrag(hit.element.id, world)
      }
      return
    }

    // 空白处开始框选；Ctrl 框选为追加选择。
    this.mode = 'marquee'
    this.marqueeAdditive = additive
    this.editor.marqueeRect = { x0: world.x, y0: world.y, x1: world.x, y1: world.y }
    if (!additive) this.editor.clearSelection()
  }

  private handlePointerMove = (e: PointerEvent): void => {
    if (!this.canvas || (this.activePointerId !== null && e.pointerId !== this.activePointerId)) return
    const screen = this.toScreen(e)
    this.editor.setMouseScreen(screen)
    const world = this.editor.screenToWorld(screen)

    if (this.mode === 'pan') {
      this.editor.pan.move(screen)
      this.downDragDistance = Math.hypot(screen.x - this.downScreen.x, screen.y - this.downScreen.y)
      return
    }

    if (this.mode === 'idle' || this.mode === 'select') {
      this.editor.updateHover(world)
    }

    if (this.mode === 'draw-track') {
      this.editor.drawTrack.updateHover(world)
      return
    }
    if (this.mode === 'eraser') {
      this.editor.eraser.move(world)
      return
    }
    if (this.mode === 'platform') {
      this.editor.selectionController.updatePlatformPreview(world)
      return
    }
    if (this.mode === 'switch') {
      this.editor.switchController.move(world)
      return
    }
    if (this.mode === 'node') {
      this.editor.nodeController.move(world)
      return
    }
    if (this.mode === 'segment') {
      this.editor.segmentController.move(world)
      return
    }

    // 点击第一点后松开鼠标，仍持续显示预览。
    if (this.mode === 'idle') {
      if ((this.editor.state.tool === 'track' || this.editor.state.tool === 'line') && this.editor.drawTrack.isDrawing) {
        this.editor.drawTrack.updateHover(world)
        return
      }
      if (this.editor.state.tool === 'platform' && this.editor.selectionController.draftPlatform.active) {
        this.editor.selectionController.updatePlatformPreview(world)
        return
      }
      if (this.editor.state.tool === 'switch' && this.editor.switchDraft) {
        this.editor.switchController.move(world)
        return
      }
    }

    if (this.mode === 'marquee') {
      this.editor.marqueeRect = { x0: this.downWorld.x, y0: this.downWorld.y, x1: world.x, y1: world.y }
      this.downDragDistance = Math.hypot(screen.x - this.downScreen.x, screen.y - this.downScreen.y)
      this.editor.invalidate()
      return
    }

    if (this.mode === 'select' && this.editor.drag.isDragging) {
      this.editor.drag.move(world)
      this.downDragDistance = Math.hypot(screen.x - this.downScreen.x, screen.y - this.downScreen.y)
    } else if (this.mode === 'select') {
      this.downDragDistance = Math.hypot(screen.x - this.downScreen.x, screen.y - this.downScreen.y)
    }
  }

  private handlePointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return
    this.releasePointer()
    const wasDragging = this.editor.drag.isDragging
    if (this.mode === 'pan') {
      this.editor.pan.end()
      this.suppressClickAfterDrag = this.downDragDistance > 4
      this.mode = 'idle'
      return
    }
    if (this.mode === 'select' && this.editor.drag.isDragging) this.editor.drag.finish()
    if (this.mode === 'marquee') {
      if (this.editor.marqueeRect) this.editor.selectInRect(this.editor.marqueeRect, this.marqueeAdditive)
      this.editor.marqueeRect = null
      this.suppressClickAfterDrag = this.downDragDistance > 4
      this.mode = 'idle'
      this.editor.invalidate()
      return
    }
    if (this.mode === 'node') this.editor.nodeController.finish()
    if (this.mode === 'segment') this.editor.segmentController.finish()
    if (this.mode === 'eraser') this.editor.eraser.finish()

    if (this.mode === 'draw-track' || this.mode === 'platform' || this.mode === 'select') {
      this.suppressClickAfterDrag = this.downDragDistance > 4 && wasDragging
    }
    this.mode = 'idle'
  }

  private handleClick = (e: MouseEvent): void => {
    if (this.suppressClickAfterDrag) {
      this.suppressClickAfterDrag = false
      return
    }
    const screen = this.toScreen(e)
    const world = this.editor.screenToWorld(screen)
    this.editor.setMouseScreen(screen)
    const tool = this.editor.state.tool
    if (tool === 'track' || tool === 'line') {
      this.editor.drawTrack.addPoint(world)
      return
    }
    if (tool === 'platform') {
      this.editor.selectionController.onPointerDown(world)
      return
    }
    if (tool === 'station') {
      this.editor.selectionController.onPointerDown(world, e.shiftKey)
      return
    }
    if (tool === 'label') {
      this.editor.requestLabelPlacement?.(world)
      return
    }
    if (tool === 'switch') {
      this.editor.switchController.click(world)
      return
    }
  }

  private handleDblClick = (e: MouseEvent): void => {
    // 双击结束：不追加顶点（防抖已在 addPoint 处理），直接提交。
    if (this.editor.state.tool === 'track' || this.editor.state.tool === 'switch' || this.editor.state.tool === 'line') {
      this.editor.drawTrack.finish()
    }
  }

  private handleWheel = (e: WheelEvent): void => {
    e.preventDefault()
    const screen = this.toScreen(e)
    this.editor.zoomAt(screen, Math.exp(-e.deltaY * 0.0015))
  }

  private handleContext = (e: MouseEvent): void => {
    e.preventDefault()
    const screen = this.toScreen(e)
    const world = this.editor.screenToWorld(screen)
    const node = this.editor.hitTestNode(world)
    if (node) {
      this.editor.onContextMenuRequest?.({ kind: 'node', screen, nodeId: node.id })
      return
    }
    const intersection = this.editor.findIntersectionNear(world)
    if (intersection) {
      this.editor.onContextMenuRequest?.({ kind: 'intersection', screen, ...intersection })
      return
    }
    const hit = this.editor.hitTest(world)
    if (hit) {
      if (hit.element.type === 'track') this.editor.onContextMenuRequest?.({ kind: 'track', screen, trackId: hit.element.id })
      else if (hit.element.type === 'direction-marker') this.editor.onContextMenuRequest?.({ kind: 'marker', screen, markerId: hit.element.id })
      return
    }
    this.editor.onContextMenuRequest?.({ kind: 'canvas', screen })
  }

  refreshCursor(): void {
    if (this.editor.spacePan) {
      this.editor.setCursor('grab')
      return
    }
    switch (this.editor.state.tool) {
      case 'track':
      case 'switch':
      case 'platform':
      case 'station':
      case 'line':
      case 'eraser':
        this.editor.setCursor('crosshair')
        return
      case 'label':
        this.editor.setCursor('text')
        return
      case 'node':
      case 'segment':
        this.editor.setCursor('pointer')
        return
      default:
        this.editor.setCursor('default')
    }
  }
}
