import type { DiagramElement, RailDocument } from '../../types'
import { isLine, isTrack } from '../model/Document'
import type { Command } from './Command'
import { DocumentChange } from './DocumentChange'

export interface DeletePointHost {
  getElement(id: string): DiagramElement | undefined
  invalidate(): void
  rebuildTopology(): void
  document: RailDocument
}

/** Delete one vertex; a vertex explicitly linked to a node is protected. */
export class DeletePointCommand implements Command {
  readonly label = '删除点'
  private change?: DocumentChange

  constructor(private host: DeletePointHost, private elementId: string, private index: number) {}

  execute(): void {
    const doc = this.host.document
    if (this.change) this.change.redo(doc)
    else {
      const el = this.host.getElement(this.elementId)
      if (!el || (!isTrack(el) && !isLine(el))) return
      if (!Number.isInteger(this.index) || this.index < 0 || this.index >= el.points.length || el.points.length <= 2) return
      const idx = this.index
      if (doc.nodes.some((n) => n.vertexLinks.some((l) => l.trackId === el.id && l.vertexIndex === idx))) return
      this.change = DocumentChange.capture(doc, () => {
        const wasLast = idx === el.points.length - 1
        el.points.splice(idx, 1)
        if (isTrack(el)) {
          if (idx === 0) delete el.startNodeId
          if (wasLast) delete el.endNodeId
        }
        for (const n of doc.nodes) for (const l of n.vertexLinks) {
          if (l.trackId === el.id && l.vertexIndex > idx) l.vertexIndex -= 1
        }
        this.host.rebuildTopology()
      })
    }
    this.host.invalidate()
  }

  undo(): void {
    if (!this.change) return
    this.change.undo(this.host.document)
    this.host.invalidate()
  }
}
