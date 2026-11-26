<script setup lang="ts">
import { computed } from 'vue'
import { useEditorStore } from '../../stores/editor'

const store = useEditorStore()
const zoomPercent = computed(() => Math.round(store.zoom * 100))
const saveText = computed(() => {
  if (store.saveState === 'saving') return '保存中...'
  if (store.saveState === 'dirty') return '未保存'
  if (store.saveState === 'error') return '自动保存失败，请导出备份'
  return '已保存'
})
</script>

<template>
  <footer class="statusbar">
    <span class="status-name">{{ store.document?.name ?? 'RailSketch' }}</span>
    <span class="status-sep">|</span>
    <span class="status-coords">X: {{ store.mouseWorld.x }} &nbsp; Y: {{ store.mouseWorld.y }}</span>
    <span class="status-sep">|</span>
    <span class="status-zoom">Zoom: {{ zoomPercent }}%</span>
    <span class="status-right" :class="{ 'save-error': store.saveState === 'error' }" :title="store.saveError ?? undefined" role="status">{{ saveText }}</span>
  </footer>
</template>

<style scoped lang="scss">
.statusbar {
  height: var(--rail-statusbar-height);
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  background: var(--rail-panel);
  border-top: 1px solid var(--rail-border);
  font-size: 12px;
  color: var(--rail-text-muted);
}

.status-sep {
  color: var(--rail-border);
}

.status-coords {
  font-variant-numeric: tabular-nums;
  min-width: 130px;
}

.status-right {
  margin-left: auto;
}

.save-error {
  color: #b91c1c;
}

.status-name {
  font-weight: 600;
  color: var(--rail-text);
}
</style>
