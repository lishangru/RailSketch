import type { RailwayNode, TrackElement } from '../../types'
import type { Command } from './Command'

export interface TrackCommandHost {
  addElement(el: TrackElement): void
  removeElement(id: string): void
  addNode(node: RailwayNode): void
  removeNode(id: string): void
  rebuildTopology(): void
  setSelection(ids: string[]): void
}

/** 新建轨道，并同时写入创建时生成的拓扑端点节点。 */
export class AddTrackCommand implements Command {
  readonly label = '新建轨道'

  constructor(
    private host: TrackCommandHost,
    private track: TrackElement,
    private nodes: RailwayNode[] = [],
  ) {
    this.track = structuredClone(track)
    this.nodes = structuredClone(nodes)
  }

  execute(): void {
    for (const node of this.nodes) this.host.addNode(structuredClone(node))
    this.host.addElement(structuredClone(this.track))
    this.host.rebuildTopology()
    this.host.setSelection([this.track.id])
  }

  undo(): void {
    this.host.removeElement(this.track.id)
    for (const node of this.nodes) this.host.removeNode(node.id)
    this.host.rebuildTopology()
    this.host.setSelection([])
  }
}
