export type ToolId = 'select' | 'track' | 'switch' | 'platform' | 'station' | 'label' | 'node' | 'segment' | 'line' | 'eraser'

export interface Point {
  x: number
  y: number
}

export interface BaseElement {
  id: string
  type: string
  layerId: string
  visible: boolean
  locked: boolean
}

export interface TrackElement extends BaseElement {
  type: 'track'
  name?: string
  points: Point[]
  trackStyle: 'single' | 'double'
  strokeWidth: number
  spacing: number
  color: string
  /** 折线拐角圆角半径（世界单位），0 表示尖角。 */
  cornerRadius: number
  /** 作为跨线桥下层时的断口半长（世界单位）。 */
  bridgeGap: number
  /** 拓扑起点节点。 */
  startNodeId?: string
  /** 拓扑终点节点。 */
  endNodeId?: string
  /** 线路标注文字（由属性面板设置，实际文字框为独立 Label 图元）。 */
  labelText?: string
  /** 线路标注对应的文字框元素 id。 */
  labelId?: string
}

/** 节点在轨道内部顶点上的连接（道岔不拆线：节点连接在 track 的哪个顶点）。 */
export interface NodeVertexLink {
  trackId: string
  vertexIndex: number
}

export type RailwayNodeType = 'endpoint' | 'junction' | 'switch' | 'crossing'

/** 铁路拓扑节点：Polyline 控制点描述几何，RailwayNode 描述真实连接。 */
export interface RailwayNode {
  id: string
  x: number
  y: number
  nodeType: RailwayNodeType
  connectedTrackIds: string[]
  name?: string
  /**
   * 不拆线的内部顶点连接。节点连接在 track 的中间顶点上时，
   * 用 vertexLinks 记录 trackId + 顶点下标；作为轨道端点时用
   * track 的 startNodeId / endNodeId 表达。
   */
  vertexLinks: NodeVertexLink[]
}

export type CrossingMode = 'plain' | 'bridge-a-over-b' | 'bridge-b-over-a'

/** 几何交叉记录：交叉默认不代表拓扑连接。 */
export interface Crossing {
  id: string
  trackAId: string
  trackBId: string
  point: Point
  mode: CrossingMode
}

export type DirectionArrow = 'outward' | 'inward' | 'none'
export type DirectionTextOrientation = 'follow' | 'horizontal'

/** 线路端点方向标识：角度由绑定 Track 的端点自动计算。 */
export interface DirectionMarkerElement extends BaseElement {
  type: 'direction-marker'
  trackId: string
  endpoint: 'start' | 'end'
  text: string
  arrow: DirectionArrow
  /** 箭头离开线路端点的距离（世界单位）。 */
  offset: number
  /** 文字相对箭头 / 端点的距离（世界单位）。 */
  textOffset: number
  textOrientation: DirectionTextOrientation
  /** 文字字号（世界单位）。 */
  fontSize: number
  /** 箭头长度（世界单位）。 */
  arrowSize: number
  /** 箭头线条粗细（世界单位）。 */
  strokeWidth: number
}

export interface PlatformElement extends BaseElement {
  type: 'platform'
  start: Point
  end: Point
  width: number
  label?: string
  /** 站台填充颜色。 */
  color: string
  /** 站台文字颜色。 */
  textColor: string
}

/** 站点类型：普通车站 / 换乘车站。 */
export type StationKind = 'station' | 'transfer'

/**
 * 车站标记：线网图上的站点圆圈。
 *
 * - `station`：白底 + 线路色描边的小圆圈。
 * - `transfer`：更大的圆圈，粗描边并带内环，表示换乘站。
 */
export interface StationElement extends BaseElement {
  type: 'station'
  kind: StationKind
  /** 站名（仅作数据与检索用，线网图上的文字是独立的 Label 图元）。 */
  name?: string
  x: number
  y: number
  /** 圆圈半径（世界单位）。 */
  radius: number
  /** 圆圈填充色。 */
  color: string
  /** 圆圈描边色。 */
  borderColor: string
  /** 圆圈描边宽度（世界单位）。 */
  borderWidth: number
  /** 换乘站内环半径（世界单位）；0 表示不绘制内环。 */
  innerRadius: number
  /**
   * 关联的线路（TrackElement）id 列表。
   *
   * 一个车站可同时属于多条线路（换乘站）。删除线路时，迁移会剔除这里的悬空引用。
   */
  trackIds: string[]
}

export type LabelAlign = 'left' | 'center' | 'right'
export interface LabelElement extends BaseElement {
  type: 'label'
  text: string
  x: number
  y: number
  rotation: number
  fontSize: number
  /** 文字水平对齐，默认 left（x 为文字左边缘中点）。 */
  align?: LabelAlign
  /** 文字颜色，默认 #111827。 */
  color?: string
  /** 文字加粗。 */
  bold?: boolean
  /** 文字底板填充色；缺省不绘制底板。 */
  background?: string
  /** 底板宽度（世界单位）；缺省按文字宽度加内边距推算。 */
  backgroundWidth?: number
  /** 底板高度（世界单位）；缺省按字号推算。 */
  backgroundHeight?: number
  /** 底板圆角半径；缺省为高度一半（胶囊形）。 */
  backgroundRadius?: number
}

/** 箭头 / 虚线等常见示意图元素：折线 + 虚线 + 端部箭头。 */
export interface LineElement extends BaseElement {
  type: 'line'
  name?: string
  points: Point[]
  dashed: boolean
  arrowStart: boolean
  arrowEnd: boolean
  color: string
  strokeWidth: number
}

export type DiagramElement = TrackElement | PlatformElement | StationElement | LabelElement | DirectionMarkerElement | LineElement

export interface Layer {
  id: string
  name: string
  visible: boolean
  locked: boolean
}

export interface RailDocument {
  id: string
  name: string
  version: number
  canvas: {
    width: number
    height: number
    gridSize: number
    /**
     * 是否在几何交叉处绘制灰色 X 提示。缺省 true。
     * 线网图等示意图需关闭，避免在 150 处线路交叉处出现编辑器提示标记。
     */
    showCrossings?: boolean
  }
  layers: Layer[]
  elements: DiagramElement[]
  /** v2：显式拓扑节点。 */
  nodes: RailwayNode[]
  /** v2：几何交叉样式记录。 */
  crossings: Crossing[]
}

export interface ViewportState {
  zoom: number
  offsetX: number
  offsetY: number
}

export type SaveState = 'saved' | 'saving' | 'dirty' | 'error'

export type SelectedElement = TrackElement | PlatformElement | StationElement | LabelElement | DirectionMarkerElement | LineElement

/** Generic JSON value used only at the serialization boundary. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
