import type { DiagramElement } from '../../types'
import type { Command } from './Command'

export interface AddElementHost {
  addElement(el: DiagramElement): void
  removeElement(id: string): void
  setSelection(ids: string[]): void
}

/** 通用“加入图元”命令，用于站台、文字等非轨道对象。 */
export class AddElementCommand implements Command {
  readonly label: string
  private element: DiagramElement

  constructor(
    private host: AddElementHost,
    element: DiagramElement,
    label?: string,
  ) {
    this.element = JSON.parse(JSON.stringify(element)) as DiagramElement
    this.label = label ?? '新建图元'
  }

  execute(): void {
    this.host.addElement(structuredClone(this.element))
    this.host.setSelection([this.element.id])
  }

  undo(): void {
    this.host.removeElement(this.element.id)
    this.host.setSelection([])
  }
}
