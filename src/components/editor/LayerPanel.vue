<script setup lang="ts">
import { computed, ref } from 'vue'
import { useEditorStore } from '../../stores/editor'
import { createLayer } from '../../editor/model/Layer'
import type { Layer } from '../../types'

const store = useEditorStore()
const editingId = ref<string | null>(null)
const editName = ref('')

const layers = computed<Layer[]>(() => store.document?.layers ?? [])
const activeId = computed(() => {
  void store.version
  return store.editor?.state.activeLayerId ?? null
})

function startRename(layer: Layer): void {
  editingId.value = layer.id
  editName.value = layer.name
}

function commitRename(): void {
  if (!store.editor || !editingId.value) return
  const layer = store.document?.layers.find((l) => l.id === editingId.value)
  if (layer) {
    layer.name = editName.value.trim() || layer.name
    store.editor.markDirty()
  }
  editingId.value = null
}

function toggleVisible(layer: Layer): void {
  if (!store.editor) return
  store.editor.cancelInteractions()
  layer.visible = !layer.visible
  if (!layer.visible) {
    store.editor.setSelection(store.editor.selectionIds.filter((id) => store.editor?.getElement(id)?.layerId !== layer.id))
  }
  store.editor.invalidate()
  store.editor.markDirty()
}

function toggleLocked(layer: Layer): void {
  if (!store.editor) return
  store.editor.cancelInteractions()
  layer.locked = !layer.locked
  // 锁定图层后，该图层对象不再可被选中 / 编辑；若已选中则取消其选择。
  if (layer.locked) {
    const ids = store.editor.selectionIds.filter((id) => {
      const el = store.editor?.getElement(id)
      return el ? el.layerId !== layer.id : true
    })
    store.editor.setSelection(ids)
  }
  store.editor.invalidate()
  store.editor.markDirty()
}

function newLayer(): void {
  if (!store.editor) return
  const layer = createLayer(`图层 ${layers.value.length + 1}`)
  store.editor.document.layers.push(layer)
  store.setActiveLayerId(layer.id)
  store.editor.markDirty()
}

function removeLayer(layer: Layer): void {
  if (!store.editor) return
  store.editor.removeLayer(layer.id)
  store.setActiveLayerId(store.editor.state.activeLayerId)
}

function selectActive(layer: Layer): void {
  if (!layer.locked && layer.visible) store.setActiveLayerId(layer.id)
}

function elementCount(id: string): number {
  return store.document?.elements.filter((e) => e.layerId === id).length ?? 0
}

function canRemove(_layer: Layer): boolean {
  return true
}
</script>

<template>
  <section class="layer-panel">
    <div class="layer-header">
      <h2 class="panel-title">图层</h2>
      <button class="layer-add" title="新建图层" @click="newLayer">＋</button>
    </div>
    <ul class="layer-list">
      <li
        v-for="layer in layers"
        :key="layer.id"
        class="layer-row"
        :class="{ active: activeId === layer.id, 'row-hidden': !layer.visible, 'row-locked': layer.locked }"
        @click="selectActive(layer)"
      >
        <span class="layer-name" @dblclick.stop="startRename(layer)">
          <input
            v-if="editingId === layer.id"
            v-model="editName"
            class="layer-rename-input"
            @keydown.enter="commitRename"
            @keydown.esc="editingId = null"
            @blur="commitRename"
          />
          <template v-else>{{ layer.name }}</template>
        </span>
        <span class="layer-count">{{ elementCount(layer.id) }}</span>
        <button class="layer-action layer-action-text" :title="layer.visible ? '隐藏图层' : '显示图层'" @click.stop="toggleVisible(layer)">
          {{ layer.visible ? '显' : '隐' }}
        </button>
        <button class="layer-action layer-action-text" :title="layer.locked ? '解锁图层' : '锁定图层'" @click.stop="toggleLocked(layer)">
          {{ layer.locked ? '锁' : '开' }}
        </button>
        <button v-if="canRemove(layer)" class="layer-action layer-delete" title="删除图层" @click.stop="removeLayer(layer)">✕</button>
        <span v-else class="layer-action-placeholder" />
      </li>
    </ul>
    <div class="layer-footer hint">
      双击图层名可重命名；隐藏图层不渲染，锁定图层不可选中编辑。
    </div>
  </section>
</template>

<style scoped lang="scss">
.layer-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.layer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 0;
}

.layer-add {
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--rail-border);
  background: #fff;
  border-radius: 3px;
  font-size: 13px;
}

.layer-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  margin: 8px 0 0;
  padding: 0 8px;
  list-style: none;
}

.layer-row {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 6px;
  border-radius: 3px;
  font-size: 12px;
  color: var(--rail-text);
}

.layer-row:hover {
  background: #edf1f6;
}

.layer-row.active {
  background: var(--rail-active);
  color: var(--rail-accent);
}

.layer-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: default;
}

.layer-rename-input {
  width: 100%;
  height: 22px;
  border: 1px solid var(--rail-accent);
  border-radius: 2px;
  padding: 0 4px;
  font-size: 12px;
}

.layer-count {
  color: var(--rail-text-muted);
  font-size: 11px;
  min-width: 20px;
  text-align: right;
}

.layer-action {
  width: 28px;
  height: 22px;
  border: none;
  background: transparent;
  font-size: 12px;
  border-radius: 3px;
}

.layer-action-text {
  width: 30px;
  color: var(--rail-text-muted);
}

.row-hidden .layer-name,
.row-hidden .layer-count {
  opacity: 0.42;
}

.row-locked .layer-name,
.row-locked .layer-count {
  opacity: 0.62;
}

.layer-action:hover {
  background: #dbe4ee;
}

.layer-delete {
  color: var(--rail-danger);
}

.layer-action-placeholder {
  width: 26px;
}

.layer-footer {
  padding: 6px 12px 10px;
  border-top: 1px solid var(--rail-border);
}
</style>
