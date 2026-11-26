import type { Point } from '../../types'
import type { Editor } from '../core/Editor'

/** Space+左键 / 鼠标中键画布平移。 */
export class PanController {
  private active = false
  private lastScreen: Point = { x: 0, y: 0 }

  constructor(private editor: Editor) {}

  get isPanning(): boolean {
    return this.active
  }

  begin(screen: Point): void {
    this.active = true
    this.lastScreen = screen
    this.editor.setCursor('grabbing')
  }

  move(screen: Point): void {
    if (!this.active) return
    const dx = screen.x - this.lastScreen.x
    const dy = screen.y - this.lastScreen.y
    this.lastScreen = screen
    this.editor.panBy(dx, dy)
  }

  end(): void {
    if (!this.active) return
    this.active = false
    this.editor.pointer.refreshCursor()
  }

  cancel(): void {
    this.active = false
    this.editor.pointer.refreshCursor()
  }
}
