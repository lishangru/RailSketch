import type { DiagramElement, StationKind } from '../../types'
import { DEFAULT_TRACK_BRIDGE_GAP } from '../model/Track'

export type EditorTool = 'select' | 'track' | 'switch' | 'platform' | 'station' | 'label' | 'node' | 'segment' | 'line' | 'eraser'

export interface EditorSelection {
  ids: string[]
}

/** 单独选中的控制点（轨道 / 线元素顶点）。 */
export interface SelectedPoint {
  elementId: string
  index: number
}

/** Snapshot structure participating in the document history. */
export interface DocumentSnapshot {
  json: string
  selectionIds: string[]
}

export interface HoverSegment {
  trackId: string
  index: number
}

export interface HoverIntersection {
  point: { x: number; y: number }
  trackAId: string
  trackBId: string
  crossingId?: string
}

/**
 * Editor Core 内部状态。它不依赖 Vue，Pinia 只保存投影数据。
 */
export class EditorState {
  tool: EditorTool = 'select'
  selectionIds: string[] = []
  /** 单独选中的控制点（轨道 / 线元素顶点），独立于元素选择。 */
  selectedPoints: SelectedPoint[] = []
  activeElement: DiagramElement | null = null
  spacePan = false
  showGrid = true
  snapGrid = true
  activeLayerId: string | null = null
  /** 车站工具当前选择的站点类型，新建车站时沿用。 */
  stationKind: StationKind = 'station'
  /** 最近一次设置的跨线桥缺口大小，新建轨道继承该值。 */
  bridgeGap = DEFAULT_TRACK_BRIDGE_GAP

  // Hover 系统（低频投影，但保留在 Core 以便 renderer / context menu 使用）。
  hoverElementId: string | null = null
  hoverSegment: HoverSegment | null = null
  hoverNodeId: string | null = null
  hoverIntersection: HoverIntersection | null = null

  setTool(tool: EditorTool): void {
    this.tool = tool
  }

  setSelection(ids: string[]): void {
    this.selectionIds = ids.slice()
  }

  setSelectedPoints(points: SelectedPoint[]): void {
    this.selectedPoints = points.slice()
  }

  hasSelection(): boolean {
    return this.selectionIds.length > 0
  }

  clearHover(): void {
    this.hoverElementId = null
    this.hoverSegment = null
    this.hoverNodeId = null
    this.hoverIntersection = null
  }
}
