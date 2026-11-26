import type { DiagramElement, RailDocument } from '../../types'
import type { Command } from './Command'
import { DocumentChange } from './DocumentChange'
import { removeElementsWithReferences } from '../topology/Topology'

export interface DeleteCommandHost {
  removeElement(id: string): void
  addElement(el: DiagramElement): void
  rebuildTopology(): void
  setSelection(ids: string[]): void
  selectionIds: string[]
  getElement(id: string): DiagramElement | undefined
  /** Optional for compatibility with lightweight non-topological hosts. */
  document?: RailDocument
}

export class DeleteElementCommand implements Command {
  readonly label = '删除对象'
  private snapshot: DiagramElement | null = null
  private selection: string[] = []
  private change?: DocumentChange

  constructor(private host: DeleteCommandHost, private targetId: string) {}

  execute(): void {
    const doc = this.host.document
    if (this.change && doc) this.change.redo(doc)
    else {
      const el = this.host.getElement(this.targetId)
      if (!el) return
      this.snapshot = JSON.parse(JSON.stringify(el)) as DiagramElement
      this.selection = this.host.selectionIds.slice()
      if (doc) this.change = DocumentChange.capture(doc, () => {
        removeElementsWithReferences(doc, [this.targetId])
        this.host.removeElement(this.targetId)
      })
      else this.host.removeElement(this.targetId)
    }
    this.host.rebuildTopology()
    this.host.setSelection([])
  }

  undo(): void {
    if (this.change && this.host.document) this.change.undo(this.host.document)
    else if (this.snapshot) this.host.addElement(JSON.parse(JSON.stringify(this.snapshot)))
    else return
    this.host.rebuildTopology()
    this.host.setSelection(this.selection.slice())
  }
}
