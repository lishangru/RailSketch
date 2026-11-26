<script setup lang="ts">
import { computed } from 'vue'
import { useEditorStore } from '../../stores/editor'
import type { ToolId } from '../../types'

const store = useEditorStore()
const activeTool = computed(() => store.tool)

const tools: { id: ToolId; title: string; shortcut: string; icon: string }[] = [
  { id: 'select', title: '选择工具', shortcut: 'V', icon: 'M4 4l7 18 2.5-7.5L21 12z' },
  { id: 'track', title: '轨道工具', shortcut: 'T', icon: 'M3 9h18M3 15h18M7 6v12M17 5v14' },
  { id: 'switch', title: '道岔工具', shortcut: 'W', icon: 'M4 12h16M14 12l6 6M10 12L16 6' },
  { id: 'line', title: '箭头 / 虚线工具', shortcut: 'G', icon: 'M3 17h12M12 12l5 5m0 0h-3.5M17 17v-3.5' },
  { id: 'eraser', title: '橡皮擦（按住拖动）', shortcut: 'E', icon: 'M4 17l6-6M6 19l8-8M12 13l4-4M15 10l2-2M9 5l2-2a2 2 0 013 3l-2 2M5 13l2-2a2 2 0 013 3l-2 2' },
  { id: 'segment', title: '段编辑', shortcut: 'S', icon: 'M5 12h14M9 6l6 6-6 6' },
  { id: 'node', title: '节点编辑', shortcut: 'N', icon: 'M12 5v14M5 12h14M12 12l4 4' },
  { id: 'platform', title: '站台工具', shortcut: 'P', icon: 'M4 9h16v6H4z' },
  { id: 'station', title: '站点工具（Shift 点击画换乘站）', shortcut: 'M', icon: 'M12 6.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM12 10.2a1.8 1.8 0 100 3.6 1.8 1.8 0 000-3.6z' },
  { id: 'label', title: '文字工具', shortcut: 'L', icon: 'M5 4h14M12 4v16M8 20h8' },
]

function pick(tool: ToolId): void {
  store.setTool(tool)
}
</script>

<template>
  <nav class="toolbar">
    <button
      v-for="t in tools"
      :key="t.id"
      class="tool-button"
      :class="{ active: activeTool === t.id }"
      :title="`${t.title} (${t.shortcut})`"
      @click="pick(t.id)"
    >
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          :d="t.icon"
        />
      </svg>
    </button>

    <!-- 站点类型切换：仅在站点工具激活时出现 -->
    <div v-if="activeTool === 'station'" class="station-kind">
      <button
        class="kind-button"
        :class="{ active: store.stationKind === 'station' }"
        title="普通车站：白底圆圈"
        @click="store.setStationKind('station')"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <circle cx="12" cy="12" r="6.5" fill="#fff" stroke="currentColor" stroke-width="2" />
        </svg>
      </button>
      <button
        class="kind-button"
        :class="{ active: store.stationKind === 'transfer' }"
        title="换乘车站：大圆圈 + 内环"
        @click="store.setStationKind('transfer')"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <circle cx="12" cy="12" r="8" fill="#fff" stroke="currentColor" stroke-width="2" />
          <circle cx="12" cy="12" r="3" fill="currentColor" />
        </svg>
      </button>
    </div>
  </nav>
</template>

<style scoped lang="scss">
.toolbar {
  width: var(--rail-toolbar-width);
  flex: none;
  background: var(--rail-panel);
  border-right: 1px solid var(--rail-border);
  padding: 8px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.tool-button {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border: none;
  background: transparent;
  border-radius: 3px;
  color: var(--rail-text-muted);
}

.tool-button:hover {
  background: #e9eef4;
  color: var(--rail-text);
}

.tool-button.active {
  background: var(--rail-active);
  color: var(--rail-accent);
  box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.4);
}

.station-kind {
  margin-top: 4px;
  padding-top: 6px;
  border-top: 1px solid var(--rail-border);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.kind-button {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 3px;
  color: var(--rail-text-muted);
}

.kind-button:hover {
  background: #e9eef4;
  color: var(--rail-text);
}

.kind-button.active {
  background: var(--rail-active);
  border-color: rgba(37, 99, 235, 0.4);
  color: var(--rail-accent);
}
</style>
