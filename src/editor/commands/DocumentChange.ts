import type { Crossing, DiagramElement, RailDocument, RailwayNode } from '../../types'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

type Entry<T> = { index: number; value: T }
type Change<T> = { ids: Set<string>; before: Entry<T>[]; after: Entry<T>[] }

function diff<T extends { id: string }>(before: T[], after: T[]): Change<T> {
  const old = new Map(before.map((value) => [value.id, value]))
  const next = new Map(after.map((value) => [value.id, value]))
  const ids = new Set([...old.keys(), ...next.keys()].filter((id) => JSON.stringify(old.get(id)) !== JSON.stringify(next.get(id))))
  const entries = (values: T[]) => values.flatMap((value, index) => ids.has(value.id) ? [{ index, value: clone(value) }] : [])
  return { ids, before: entries(before), after: entries(after) }
}

function apply<T extends { id: string }>(values: T[], change: Change<T>, side: 'before' | 'after'): T[] {
  const result = values.filter((value) => !change.ids.has(value.id))
  for (const entry of change[side]) result.splice(entry.index, 0, clone(entry.value))
  return result
}

/** Retain only changed records, including their order, rather than a document JSON snapshot. */
export class DocumentChange {
  private constructor(
    private elements: Change<DiagramElement>,
    private nodes: Change<RailwayNode>,
    private crossings: Change<Crossing>,
  ) {}

  static capture(doc: RailDocument, mutate: () => void): DocumentChange {
    const elements = doc.elements.map(clone)
    const nodes = doc.nodes.map(clone)
    const crossings = doc.crossings.map(clone)
    try {
      mutate()
    } catch (error) {
      doc.elements = elements
      doc.nodes = nodes
      doc.crossings = crossings
      throw error
    }
    return new DocumentChange(diff(elements, doc.elements), diff(nodes, doc.nodes), diff(crossings, doc.crossings))
  }

  undo(doc: RailDocument): void { this.restore(doc, 'before') }
  redo(doc: RailDocument): void { this.restore(doc, 'after') }

  private restore(doc: RailDocument, side: 'before' | 'after'): void {
    doc.elements = apply(doc.elements, this.elements, side)
    doc.nodes = apply(doc.nodes, this.nodes, side)
    doc.crossings = apply(doc.crossings, this.crossings, side)
  }
}
