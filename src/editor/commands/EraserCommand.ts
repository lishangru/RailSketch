import type { DiagramElement, Point, RailDocument } from '../../types'
import { v4 as uuidv4 } from 'uuid'
import { isDirectionMarker, isLabel, isLine, isPlatform, isStation, isTrack } from '../model/Document'
import { cutPolylineBySegmentSpan, cutTrackBySegmentSpan, rebuildNodeConnectivity, removeElementsWithReferences } from '../topology/Topology'
import type { Command } from './Command'
import { DocumentChange } from './DocumentChange'

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

export interface EraserHost {
  document: RailDocument
  findEraserHits(stroke: Point[]): { spans: { elementId: string; from: number; to: number }[]; deleteIds: string[] }
  invalidate(): void
}

/** Cut at segment boundaries; retain changed records for stable, symmetric redo. */
export class EraserCommand implements Command {
  readonly label = '橡皮擦'
  private change?: DocumentChange

  constructor(private host: EraserHost, private stroke: Point[]) {}

  execute(): void {
    const doc = this.host.document
    if (this.change) this.change.redo(doc)
    else this.change = DocumentChange.capture(doc, () => {
      const { spans, deleteIds } = this.host.findEraserHits(this.stroke)
      for (const span of spans) {
        const el = doc.elements.find((e) => e.id === span.elementId)
        if (!el) continue
        let pieces: DiagramElement[]
        if (isTrack(el)) pieces = cutTrackBySegmentSpan(doc, el, span).pieces
        else if (isLine(el)) {
          const result = cutPolylineBySegmentSpan(el.points, span)
          pieces = [result.a, result.b].filter((p): p is Point[] => p !== null).map((points) => ({ ...clone(el), id: uuidv4(), points }))
        } else continue
        const index = doc.elements.findIndex((e) => e.id === el.id)
        doc.elements.splice(index, 1, ...pieces)
      }
      removeElementsWithReferences(doc, deleteIds.filter((id) => {
        const el = doc.elements.find((e) => e.id === id)
        return !!el && (isPlatform(el) || isStation(el) || isLabel(el) || isDirectionMarker(el))
      }))
      rebuildNodeConnectivity(doc)
    })
    this.host.invalidate()
  }

  undo(): void {
    this.change?.undo(this.host.document)
    this.host.invalidate()
  }
}
