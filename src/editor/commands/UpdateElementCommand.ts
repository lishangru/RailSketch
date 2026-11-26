import type { DiagramElement } from '../../types'
import type { Command } from './Command'

export interface UpdateElementHost {
  getElement(id: string): DiagramElement | undefined
  invalidate(): void
  setSelection(ids: string[]): void
}

/** 深拷贝快照式的属性更新命令，适用于所有图元的属性修改与整体移动。 */
export class UpdateElementCommand implements Command {
  label: string

  private before: DiagramElement | null = null

  constructor(
    private host: UpdateElementHost,
    private id: string,
    private patch: Partial<DiagramElement>,
    label = '修改属性',
    before?: DiagramElement,
  ) {
    this.label = label
    this.patch = structuredClone(patch)
    if (before) this.before = structuredClone(before)
  }

  execute(): void {
    const el = this.host.getElement(this.id)
    if (!el) return
    if (this.before == null) {
      this.before = JSON.parse(JSON.stringify(el)) as DiagramElement
    }
    const patch = structuredClone(this.patch) as Record<string, unknown>
    const target = el as unknown as Record<string, unknown>
    for (const [key, value] of Object.entries(patch)) {
      // undefined 表示「回到缺省」：必须删键，否则会留下一个显式的 undefined 属性。
      if (value === undefined) delete target[key]
      else target[key] = value
    }
    this.host.invalidate()
  }

  undo(): void {
    const el = this.host.getElement(this.id)
    if (!el || !this.before) return
    const keys = Object.getOwnPropertyNames(el)
    for (const k of keys) delete (el as unknown as Record<string, unknown>)[k]
    Object.assign(el, structuredClone(this.before))
    this.host.invalidate()
  }
}
