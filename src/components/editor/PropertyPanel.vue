<script setup lang="ts">
import { computed } from 'vue'
import { useEditorStore } from '../../stores/editor'
import type { DiagramElement, Layer, LineElement, PlatformElement, TrackElement } from '../../types'
import { contrastRatio, contrastTextColor } from '../../editor/render/LabelRenderer'

const store = useEditorStore()
const doc = computed(() => store.document)

/** 单选时为选中元素；多选同类时取第一个元素用于展示与批量编辑。 */
const selected = computed<DiagramElement | null>(() => {
  const single = store.selectedElement
  if (single) return single
  const ids = store.selectedIds
  if (ids.length > 1) {
    const els = ids
      .map((id) => store.editor?.getElement(id))
      .filter((el): el is DiagramElement => Boolean(el))
    const types = new Set(els.map((e) => e.type))
    if (types.size === 1) return els[0] ?? null
  }
  return null
})

const batchCount = computed(() => (store.selectedIds.length > 1 ? store.selectedIds.length : 0))

function core() {
  return store.editor ?? null
}

/** 修改属性：单选改一个，同类多选时批量改全部（一次撤销）。 */
function updateElement(patch: Partial<DiagramElement>, label = '修改属性'): void {
  const editor = core()
  if (!editor || !selected.value) return
  const ids = store.selectedIds.filter((id) => editor.getElement(id)?.type === selected.value!.type)
  editor.updateElementProperties(ids, patch, label)
}

function deleteSelected(): void {
  core()?.deleteSelection()
}

function layerOptions(): Layer[] {
  return doc.value?.layers ?? []
}

function layerSelectValue(): string {
  return selected.value?.layerId ?? ''
}

function updateLayer(value: string): void {
  updateElement({ layerId: value }, '修改图层')
}

function trackAngle(tr: TrackElement): number | null {
  if (tr.points.length < 2) return null
  const a = tr.points[0]
  const b = tr.points[1]
  const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
  return ((deg % 180) + 180) % 180
}

/** 手动设置线路角度：以首段中点为旋转中心，整条折线刚性旋转。 */
function setTrackAngle(tr: TrackElement, degrees: number): void {
  const editor = core()
  if (!editor) return
  editor.setTrackAngle(store.selectedIds.length ? store.selectedIds : [tr.id], degrees)
}

function updateTrackBridgeGap(trackId: string, value: number): void {
  const editor = core()
  if (!editor || !Number.isFinite(value) || value > 10000) return
  const gap = Math.max(0, value)
  // 记录最近一次设置，后续新画的线路自动继承。
  editor.state.bridgeGap = gap
  updateElement({ bridgeGap: gap }, '修改跨线缺口')
  void trackId
}

function platformAngle(pl: PlatformElement): number {
  const deg = (Math.atan2(pl.end.y - pl.start.y, pl.end.x - pl.start.x) * 180) / Math.PI
  return ((deg % 180) + 180) % 180
}

/** 手动指定站台角度：绕中点旋转，长度保持不变。 */
function setPlatformAngle(pl: PlatformElement, degrees: number): void {
  const editor = core()
  if (!editor) return
  editor.setPlatformAngle(store.selectedIds.length ? store.selectedIds : [pl.id], degrees)
}

function setTrackLabel(tr: TrackElement, value: string): void {
  store.editor?.setTrackLabel(tr.id, value)
}

function isLineEl(el: DiagramElement | null): el is LineElement {
  return el?.type === 'line'
}

/** 选中车站当前关联的线路名。 */
const linkedTrackNames = computed<string[]>(() => {
  if (selected.value?.type !== 'station') return []
  void store.version
  return core()?.getSelectedStationTracks().map((t) => t.name || '未命名线路') ?? []
})

/** 可供切换关联的线路，标记当前是否已关联。 */
const linkableTracks = computed<{ id: string; name: string; linked: boolean }[]>(() => {
  if (selected.value?.type !== 'station') return []
  void store.version
  const editor = core()
  if (!editor) return []
  const station = selected.value
  const linked = new Set(station.trackIds)
  return editor.document.elements
    .filter((el): el is TrackElement => el.type === 'track')
    .map((t) => ({ id: t.id, name: t.name || '未命名线路', linked: linked.has(t.id) }))
})

/** 开启底板时给一个中性默认色，避免生成不可见的透明底板。 */
function onToggleLabelBackground(enabled: boolean): void {
  if (!enabled) {
    // 关闭底板：清空颜色与尺寸，回到纯文字。
    updateElement({ background: '', backgroundWidth: undefined, backgroundHeight: undefined, backgroundRadius: undefined }, '隐藏文字底板')
    return
  }
  const current = selected.value
  const patch: Partial<DiagramElement> = { background: (current?.type === 'label' && current.background) || '#e2e8f0' }
  updateElement(patch, '显示文字底板')
}

/** 底板尺寸：留空或 0 视为「自动」，需要删除字段而不是写 0。 */
function onLabelBackgroundSize(field: 'backgroundWidth' | 'backgroundHeight', raw: string): void {
  const value = Number(raw)
  const patch: Partial<DiagramElement> = {}
  if (!raw.trim() || !Number.isFinite(value) || value <= 0) {
    // undefined 会在序列化时被丢弃，等于回到自动推算。
    Object.assign(patch, { [field]: undefined })
  } else {
    Object.assign(patch, { [field]: Math.min(2000, value) })
  }
  updateElement(patch, '修改底板尺寸')
}

function onResetLabelBackground(): void {
  updateElement({ backgroundWidth: undefined, backgroundHeight: undefined, backgroundRadius: undefined }, '恢复底板默认样式')
}

/**
 * 修改底板颜色。
 *
 * 徽标类文字常用白字，一旦底色改成浅色就会「改了看不见」，
 * 因此在对比度不足时同步把文字色换成可读色。
 */
function onLabelBackgroundColor(value: string): void {
  const patch: Partial<DiagramElement> = { background: value }
  const current = selected.value
  if (current?.type === 'label') {
    const textColor = current.color ?? '#111827'
    if (contrastRatio(textColor, value) < 3) patch.color = contrastTextColor(value)
  }
  updateElement(patch, '修改底板颜色')
}

function onToggleTrackLink(trackId: string): void {
  const editor = core()
  if (!editor || !trackId || selected.value?.type !== 'station') return
  editor.toggleStationTrackLink(selected.value.id, trackId)
}
</script>

<template>
  <div class="property-panel">
    <div v-if="batchCount > 0" class="panel-section">
      <h2 class="panel-title">已选择 {{ batchCount }} 个对象</h2>
      <p class="hint">
        <template v-if="selected">同类对象（{{ selected.type === 'track' ? '轨道' : selected.type === 'platform' ? '站台' : selected.type === 'station' ? '车站' : selected.type === 'label' ? '文字' : selected.type === 'line' ? '线' : '方向标识' }}），下方属性修改将批量应用。</template>
        <template v-else>包含不同类型对象，仅支持拖动平移与删除。</template>
      </p>
      <button class="danger-button" @click="deleteSelected">删除所选对象</button>
    </div>

    <div v-else-if="!selected && doc" class="panel-section">
      <h2 class="panel-title">文档</h2>
      <div class="form-row">
        <label>名称</label>
        <input type="text" :value="doc.name" @change="store.updateDocumentName(($event.target as HTMLInputElement).value)" />
      </div>
      <div class="form-row">
        <label>画布宽度</label>
        <input type="number" :value="doc.canvas.width" disabled title="第一阶段固定示例尺寸" />
      </div>
      <div class="form-row">
        <label>画布高度</label>
        <input type="number" :value="doc.canvas.height" disabled title="第一阶段固定示例尺寸" />
      </div>
      <div class="form-row">
        <label>网格大小</label>
        <input type="number" min="1" :value="doc.canvas.gridSize" @change="store.updateCanvasGridSize(Number(($event.target as HTMLInputElement).value))" />
      </div>
      <div class="form-row">
        <label>图层数</label>
        <span class="hint">{{ doc.layers.length }}</span>
      </div>
    </div>

    <div v-else-if="selected" class="panel-section">
      <!-- 轨道 -->
      <template v-if="selected.type === 'track'">
        <h2 class="panel-title">轨道</h2>
        <div class="form-row">
          <label>名称</label>
          <input
            type="text"
            :value="selected.name ?? ''"
            @change="updateElement({ name: ($event.target as HTMLInputElement).value || undefined }, '修改轨道名称')"
          />
        </div>
        <div class="form-row">
          <label>标注文字</label>
          <input
            type="text"
            :value="selected.labelText ?? ''"
            placeholder="在线路旁创建文字框"
            @change="setTrackLabel(selected, ($event.target as HTMLInputElement).value)"
          />
        </div>
        <div class="form-row">
          <label>类型</label>
          <div class="radio-group">
            <label>
              <input
                type="radio"
                name="track-style"
                :checked="selected.trackStyle === 'single'"
                @change="updateElement({ trackStyle: 'single' }, '改为单线')"
              />
              单线
            </label>
            <label>
              <input
                type="radio"
                name="track-style"
                :checked="selected.trackStyle === 'double'"
                @change="updateElement({ trackStyle: 'double' }, '改为双线')"
              />
              双线
            </label>
          </div>
        </div>
        <div class="form-row">
          <label>角度</label>
          <input
            type="number"
            step="1"
            :value="trackAngle(selected) == null ? 0 : Math.round(trackAngle(selected) ?? 0)"
            @change="setTrackAngle(selected, Number(($event.target as HTMLInputElement).value))"
          />
        </div>
        <div class="form-row">
          <label>拐角圆角</label>
          <input
            type="number"
            min="0"
            step="1"
            :value="selected.cornerRadius"
            @change="updateElement({ cornerRadius: Math.max(0, Number(($event.target as HTMLInputElement).value)) }, '修改拐角圆角')"
          />
        </div>
        <div class="form-row">
          <label>断开宽度</label>
          <input
            type="number"
            min="0"
            step="1"
            :value="selected.bridgeGap"
            @change="updateTrackBridgeGap(selected.id, Number(($event.target as HTMLInputElement).value))"
          />
        </div>
        <div class="form-row">
          <label>线宽</label>
          <input
            type="number"
            min="0.5"
            step="0.5"
            :value="selected.strokeWidth"
            @change="updateElement({ strokeWidth: Number(($event.target as HTMLInputElement).value) }, '修改线宽')"
          />
        </div>
        <div class="form-row">
          <label>双线间距</label>
          <input
            type="number"
            min="0"
            step="1"
            :value="selected.spacing"
            @change="updateElement({ spacing: Number(($event.target as HTMLInputElement).value) }, '修改双线间距')"
          />
        </div>
        <div class="form-row">
          <label>颜色</label>
          <input
            type="color"
            :value="selected.color"
            @change="updateElement({ color: ($event.target as HTMLInputElement).value }, '修改颜色')"
          />
        </div>
        <div class="form-row">
          <label>图层</label>
          <select :value="layerSelectValue()" @change="updateLayer(($event.target as HTMLSelectElement).value)">
            <option value="">无图层</option>
            <option v-for="l in layerOptions()" :key="l.id" :value="l.id">{{ l.name }}</option>
          </select>
        </div>
        <button class="danger-button" @click="deleteSelected">删除轨道</button>
      </template>

      <!-- 线（箭头 / 虚线） -->
      <template v-else-if="isLineEl(selected)">
        <h2 class="panel-title">线</h2>
        <div class="form-row">
          <label>线型</label>
          <div class="radio-group">
            <label>
              <input type="radio" name="line-dash" :checked="!selected.dashed" @change="updateElement({ dashed: false }, '改为实线')" />
              实线
            </label>
            <label>
              <input type="radio" name="line-dash" :checked="selected.dashed" @change="updateElement({ dashed: true }, '改为虚线')" />
              虚线
            </label>
          </div>
        </div>
        <div class="form-row">
          <label>箭头</label>
          <div class="radio-group">
            <label><input type="radio" name="line-arrow" :checked="!selected.arrowStart && !selected.arrowEnd" @change="updateElement({ arrowStart: false, arrowEnd: false }, '无箭头')" /> 无</label>
            <label><input type="radio" name="line-arrow" :checked="selected.arrowStart && !selected.arrowEnd" @change="updateElement({ arrowStart: true, arrowEnd: false }, '起点箭头')" /> 起点</label>
            <label><input type="radio" name="line-arrow" :checked="!selected.arrowStart && selected.arrowEnd" @change="updateElement({ arrowStart: false, arrowEnd: true }, '终点箭头')" /> 终点</label>
            <label><input type="radio" name="line-arrow" :checked="selected.arrowStart && selected.arrowEnd" @change="updateElement({ arrowStart: true, arrowEnd: true }, '两端箭头')" /> 两端</label>
          </div>
        </div>
        <div class="form-row">
          <label>线宽</label>
          <input
            type="number"
            min="0.5"
            step="0.5"
            :value="selected.strokeWidth"
            @change="updateElement({ strokeWidth: Number(($event.target as HTMLInputElement).value) }, '修改线宽')"
          />
        </div>
        <div class="form-row">
          <label>颜色</label>
          <input
            type="color"
            :value="selected.color"
            @change="updateElement({ color: ($event.target as HTMLInputElement).value }, '修改颜色')"
          />
        </div>
        <div class="form-row">
          <label>图层</label>
          <select :value="layerSelectValue()" @change="updateLayer(($event.target as HTMLSelectElement).value)">
            <option value="">无图层</option>
            <option v-for="l in layerOptions()" :key="l.id" :value="l.id">{{ l.name }}</option>
          </select>
        </div>
        <button class="danger-button" @click="deleteSelected">删除线</button>
      </template>

      <!-- 站台 -->
      <template v-else-if="selected.type === 'platform'">
        <h2 class="panel-title">站台</h2>
        <div class="form-row">
          <label>名称</label>
          <input
            type="text"
            :value="selected.label ?? ''"
            @change="updateElement({ label: ($event.target as HTMLInputElement).value || undefined }, '修改站台名称')"
          />
        </div>
        <div class="form-row">
          <label>宽度</label>
          <input
            type="number"
            min="2"
            :value="selected.width"
            @change="updateElement({ width: Number(($event.target as HTMLInputElement).value) }, '修改站台宽度')"
          />
        </div>
        <div class="form-row">
          <label>角度</label>
          <input
            type="number"
            step="1"
            :value="Math.round(platformAngle(selected))"
            @change="setPlatformAngle(selected, Number(($event.target as HTMLInputElement).value))"
          />
        </div>
        <div class="form-row">
          <label>站台颜色</label>
          <input
            type="color"
            :value="selected.color"
            @change="updateElement({ color: ($event.target as HTMLInputElement).value }, '修改站台颜色')"
          />
        </div>
        <div class="form-row">
          <label>文字颜色</label>
          <input
            type="color"
            :value="selected.textColor"
            @change="updateElement({ textColor: ($event.target as HTMLInputElement).value }, '修改站台文字颜色')"
          />
        </div>
        <div class="form-row">
          <label>字号</label>
          <span class="hint">随宽度自动（{{ selected.width }}）</span>
        </div>
        <div class="form-row">
          <label>图层</label>
          <select :value="layerSelectValue()" @change="updateLayer(($event.target as HTMLSelectElement).value)">
            <option value="">无图层</option>
            <option v-for="l in layerOptions()" :key="l.id" :value="l.id">{{ l.name }}</option>
          </select>
        </div>
        <button class="danger-button" @click="deleteSelected">删除站台</button>
      </template>

      <!-- 方向标识 -->
      <template v-else-if="selected.type === 'direction-marker'">
        <h2 class="panel-title">线路方向标识</h2>
        <div class="form-row">
          <label>方向名称</label>
          <input type="text" :value="selected.text" @change="updateElement({ text: ($event.target as HTMLInputElement).value }, '修改方向名称')" />
        </div>
        <div class="form-row">
          <label>端点</label>
          <span class="hint">{{ selected.endpoint === 'start' ? '起点' : '终点' }}</span>
        </div>
        <div class="form-row">
          <label>箭头</label>
          <div class="radio-group">
            <label><input type="radio" name="arrow" :checked="selected.arrow === 'outward'" @change="updateElement({ arrow: 'outward' }, '箭头正向')" /> 正向</label>
            <label><input type="radio" name="arrow" :checked="selected.arrow === 'inward'" @change="updateElement({ arrow: 'inward' }, '箭头反向')" /> 反向</label>
            <label><input type="radio" name="arrow" :checked="selected.arrow === 'none'" @change="updateElement({ arrow: 'none' }, '隐藏箭头')" /> 无</label>
          </div>
        </div>
        <div class="form-row">
          <label>文字方向</label>
          <div class="radio-group">
            <label><input type="radio" name="text-orientation" :checked="selected.textOrientation !== 'horizontal'" @change="updateElement({ textOrientation: 'follow' }, '文字跟随线路')" /> 跟随线路</label>
            <label><input type="radio" name="text-orientation" :checked="selected.textOrientation === 'horizontal'" @change="updateElement({ textOrientation: 'horizontal' }, '文字始终水平')" /> 始终水平</label>
          </div>
        </div>
        <div class="form-row">
          <label>箭头距离</label>
          <input type="number" :value="selected.offset" @change="updateElement({ offset: Number(($event.target as HTMLInputElement).value) }, '修改箭头距离')" />
        </div>
        <div class="form-row">
          <label>文字距离</label>
          <input type="number" :value="selected.textOffset" @change="updateElement({ textOffset: Number(($event.target as HTMLInputElement).value) }, '修改文字距离')" />
        </div>
        <div class="form-row">
          <label>字号</label>
          <input type="number" min="6" max="200" :value="selected.fontSize" @change="updateElement({ fontSize: Number(($event.target as HTMLInputElement).value) }, '修改字号')" />
        </div>
        <div class="form-row">
          <label>箭头大小</label>
          <input type="number" min="2" :value="selected.arrowSize" @change="updateElement({ arrowSize: Number(($event.target as HTMLInputElement).value) }, '修改箭头大小')" />
        </div>
        <div class="form-row">
          <label>线宽</label>
          <input type="number" min="0.5" step="0.5" :value="selected.strokeWidth" @change="updateElement({ strokeWidth: Number(($event.target as HTMLInputElement).value) }, '修改线宽')" />
        </div>
        <button class="danger-button" @click="deleteSelected">删除方向标识</button>
      </template>

      <template v-else-if="selected.type === 'station'">
        <h2 class="panel-title">车站</h2>
        <div class="form-row">
          <label>类型</label>
          <select
            :value="selected.kind"
            @change="updateElement({ kind: ($event.target as HTMLSelectElement).value as 'station' | 'transfer' }, '修改站点类型')"
          >
            <option value="station">普通车站</option>
            <option value="transfer">换乘车站</option>
          </select>
        </div>
        <div class="form-row">
          <label>站名</label>
          <input
            type="text"
            :value="selected.name ?? ''"
            @change="updateElement({ name: ($event.target as HTMLInputElement).value }, '修改站名')"
          />
        </div>
        <div class="form-row">
          <label>半径</label>
          <input
            type="number"
            min="1"
            max="200"
            :value="selected.radius"
            @change="updateElement({ radius: Math.max(1, Number(($event.target as HTMLInputElement).value)) }, '修改站点半径')"
          />
        </div>
        <div class="form-row">
          <label>填充色</label>
          <input type="color" :value="selected.color" @change="updateElement({ color: ($event.target as HTMLInputElement).value }, '修改填充色')" />
        </div>
        <div class="form-row">
          <label>描边色</label>
          <input type="color" :value="selected.borderColor" @change="updateElement({ borderColor: ($event.target as HTMLInputElement).value }, '修改描边色')" />
        </div>
        <div class="form-row">
          <label>描边宽</label>
          <input
            type="number"
            min="0"
            max="40"
            step="0.5"
            :value="selected.borderWidth"
            @change="updateElement({ borderWidth: Math.max(0, Number(($event.target as HTMLInputElement).value)) }, '修改描边宽度')"
          />
        </div>
        <div class="form-row">
          <label>内环半径</label>
          <input
            type="number"
            min="0"
            max="200"
            :value="selected.innerRadius"
            @change="updateElement({ innerRadius: Math.max(0, Number(($event.target as HTMLInputElement).value)) }, '修改内环半径')"
          />
        </div>
        <div class="form-row">
          <label>关联线路</label>
          <span class="hint">{{ linkedTrackNames.length ? linkedTrackNames.join('、') : '未关联（在站点工具下落在线路上会自动关联）' }}</span>
        </div>
        <div v-if="linkableTracks.length" class="form-row">
          <label>切换关联</label>
          <select :value="''" @change="onToggleTrackLink(($event.target as HTMLSelectElement).value)">
            <option value="">选择线路…</option>
            <option v-for="t in linkableTracks" :key="t.id" :value="t.id">
              {{ t.linked ? '取消关联 ' : '关联 ' }}{{ t.name || '未命名线路' }}
            </option>
          </select>
        </div>
        <div class="form-row">
          <label>图层</label>
          <select :value="layerSelectValue()" @change="updateLayer(($event.target as HTMLSelectElement).value)">
            <option value="">无图层</option>
            <option v-for="l in layerOptions()" :key="l.id" :value="l.id">{{ l.name }}</option>
          </select>
        </div>
        <button class="danger-button" @click="deleteSelected">删除车站</button>
      </template>

      <template v-else-if="selected.type === 'label'">
        <h2 class="panel-title">文字</h2>
        <div class="form-row">
          <label>显示</label>
          <input type="checkbox" :checked="selected.visible" @change="updateElement({ visible: ($event.target as HTMLInputElement).checked }, '显示 / 隐藏文字')" />
          <span class="hint">隐藏后可用 Ctrl+Z 撤销恢复</span>
        </div>
        <div class="form-row">
          <label>内容</label>
          <input
            type="text"
            :value="selected.text"
            @change="updateElement({ text: ($event.target as HTMLInputElement).value }, '修改文字内容')"
          />
        </div>
        <div class="form-row">
          <label>字号</label>
          <input
            type="number"
            min="6"
            max="200"
            :value="selected.fontSize"
            @change="updateElement({ fontSize: Number(($event.target as HTMLInputElement).value) }, '修改字号')"
          />
        </div>
        <div class="form-row">
          <label>旋转</label>
          <input
            type="number"
            step="1"
            :value="selected.rotation"
            @change="updateElement({ rotation: Number(($event.target as HTMLInputElement).value) }, '修改旋转角度')"
          />
        </div>
        <div class="form-row">
          <label>文字颜色</label>
          <input
            type="color"
            :value="selected.color ?? '#111827'"
            @change="updateElement({ color: ($event.target as HTMLInputElement).value }, '修改文字颜色')"
          />
        </div>
        <div class="form-row">
          <label>加粗</label>
          <input
            type="checkbox"
            :checked="selected.bold ?? false"
            @change="updateElement({ bold: ($event.target as HTMLInputElement).checked }, '修改文字加粗')"
          />
        </div>
        <div class="form-row">
          <label>水平对齐</label>
          <select
            :value="selected.align ?? 'left'"
            :disabled="!!selected.background"
            @change="updateElement({ align: ($event.target as HTMLSelectElement).value as 'left' | 'center' | 'right' }, '修改文字对齐')"
          >
            <option value="left">左对齐（锚点在文字左侧）</option>
            <option value="center">居中（锚点在文字中央）</option>
            <option value="right">右对齐（锚点在文字右侧）</option>
          </select>
        </div>
        <p v-if="selected.background" class="hint">带底板时文字恒居中于底板，水平对齐不生效。</p>

        <h3 class="panel-subtitle">底板</h3>
        <div class="form-row">
          <label>显示底板</label>
          <input
            type="checkbox"
            :checked="!!selected.background"
            @change="onToggleLabelBackground(($event.target as HTMLInputElement).checked)"
          />
        </div>
        <template v-if="selected.background">
          <div class="form-row">
            <label>底板颜色</label>
            <input
              type="color"
              :value="selected.background"
              @change="onLabelBackgroundColor(($event.target as HTMLInputElement).value)"
            />
          </div>
          <div class="form-row">
            <label>圆角</label>
            <input
              type="number"
              min="0"
              max="200"
              step="1"
              :value="selected.backgroundRadius ?? 0"
              @change="updateElement({ backgroundRadius: Math.max(0, Number(($event.target as HTMLInputElement).value)) }, '修改底板圆角')"
            />
            <span class="hint">0 = 直角；留空则按高度一半（胶囊）</span>
          </div>
          <div class="form-row">
            <label>底板宽</label>
            <input
              type="number"
              min="0"
              max="2000"
              step="1"
              :value="selected.backgroundWidth ?? ''"
              placeholder="自动"
              @change="onLabelBackgroundSize('backgroundWidth', ($event.target as HTMLInputElement).value)"
            />
          </div>
          <div class="form-row">
            <label>底板高</label>
            <input
              type="number"
              min="0"
              max="2000"
              step="1"
              :value="selected.backgroundHeight ?? ''"
              placeholder="自动"
              @change="onLabelBackgroundSize('backgroundHeight', ($event.target as HTMLInputElement).value)"
            />
          </div>
          <button class="secondary-button" @click="onResetLabelBackground">恢复自动尺寸与胶囊圆角</button>
        </template>

        <div class="form-row">
          <label>图层</label>
          <select :value="layerSelectValue()" @change="updateLayer(($event.target as HTMLSelectElement).value)">
            <option value="">无图层</option>
            <option v-for="l in layerOptions()" :key="l.id" :value="l.id">{{ l.name }}</option>
          </select>
        </div>
        <button class="danger-button" @click="deleteSelected">删除文字</button>
      </template>
    </div>

    <div v-else class="panel-section">
      <h2 class="panel-title">属性</h2>
      <p class="hint">点击对象查看和编辑属性</p>
    </div>
  </div>
</template>

<style scoped lang="scss">
.property-panel {
  min-height: 0;
}
</style>
