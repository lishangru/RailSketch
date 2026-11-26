<script setup lang="ts">
import { computed } from 'vue'
import { useEditorStore } from '../../stores/editor'
import type { TrackElement } from '../../types'

const store = useEditorStore()
const node = computed(() => store.editor?.document.nodes.find((n) => n.id === store.nodeSplitDialog.nodeId))
const tracks = computed(() => {
  const ids = node.value?.connectedTrackIds ?? []
  return store.editor?.document.elements.filter((e): e is TrackElement => e.type === 'track' && ids.includes(e.id)) ?? []
})

function toggle(id: string): void {
  const arr = store.nodeSplitDialog.keepIds
  const i = arr.indexOf(id)
  if (i >= 0) arr.splice(i, 1)
  else arr.push(id)
}
</script>

<template>
  <div v-if="store.nodeSplitDialog.open" class="dlg-backdrop" @mousedown.self="store.nodeSplitDialog.open = false">
    <div class="dlg">
      <div class="dlg-title">拆分节点</div>
      <p class="hint">勾选保留在原节点的轨道，其余轨道将转移到新节点。</p>
      <div class="track-list">
        <label v-for="t in tracks" :key="t.id" class="track-row">
          <input type="checkbox" :checked="store.nodeSplitDialog.keepIds.includes(t.id)" @change="toggle(t.id)" />
          <span>{{ t.name || t.id.slice(0, 8) }}</span>
        </label>
      </div>
      <div class="dlg-actions">
        <button @click="store.nodeSplitDialog.open = false">取消</button>
        <button class="primary" @click="store.confirmNodeSplit">确定</button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.dlg-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.2);
  display: grid;
  place-items: center;
  z-index: 40;
}
.dlg {
  width: 320px;
  padding: 14px 16px;
  background: #fff;
  border: 1px solid var(--rail-border);
  border-radius: 4px;
}
.dlg-title { font-weight: 600; margin-bottom: 8px; }
.track-list { max-height: 240px; overflow: auto; margin: 10px 0; }
.track-row { display: flex; align-items: center; gap: 8px; min-height: 26px; font-size: 12px; }
.dlg-actions { display: flex; justify-content: flex-end; gap: 8px; }
.dlg-actions button { height: 26px; padding: 0 12px; border: 1px solid var(--rail-border); background: #fff; border-radius: 3px; font-size: 12px; }
.dlg-actions .primary { background: var(--rail-accent); border-color: var(--rail-accent); color: #fff; }
</style>
