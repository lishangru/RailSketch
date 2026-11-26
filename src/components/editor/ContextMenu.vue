<script setup lang="ts">
import { useEditorStore } from '../../stores/editor'

const store = useEditorStore()

function close(): void {
  store.contextMenu.open = false
}

function selectTrack(): void {
  if (store.contextMenu.trackId) store.editor?.setSelection([store.contextMenu.trackId])
  close()
}

function generateParallel(): void {
  if (store.contextMenu.trackId) store.openParallelDialog(store.contextMenu.trackId)
  close()
}

function reverseTrack(): void {
  if (store.contextMenu.trackId) store.editor?.reverseTrackCommand(store.contextMenu.trackId)
  close()
}

function addStartMarker(): void {
  if (store.contextMenu.trackId) store.editor?.addDirectionMarker(store.contextMenu.trackId, 'start', '方向')
  close()
}

function addEndMarker(): void {
  if (store.contextMenu.trackId) store.editor?.addDirectionMarker(store.contextMenu.trackId, 'end', '方向')
  close()
}

function deleteSelected(): void {
  store.editor?.deleteSelection()
  close()
}

function splitNode(): void {
  if (store.contextMenu.nodeId) store.openNodeSplitDialog(store.contextMenu.nodeId)
  close()
}

function disconnectJunction(): void {
  if (store.contextMenu.nodeId) store.editor?.disconnectJunctionCommand(store.contextMenu.nodeId)
  close()
}

function deleteNode(): void {
  if (store.contextMenu.nodeId) store.editor?.deleteNodeCommand(store.contextMenu.nodeId)
  close()
}

function connectCrossing(): void {
  const m = store.contextMenu
  if (m.trackAId && m.trackBId) store.editor?.connectCrossingCommand(m.trackAId, m.trackBId, m.point)
  close()
}

function setAsSwitch(): void {
  const m = store.contextMenu
  if (m.kind === 'intersection' && m.trackAId && m.trackBId) {
    store.editor?.crossingToSwitchCommand(m.trackAId, m.trackBId, m.point)
  } else if (m.kind === 'node' && m.nodeId) {
    store.editor?.setNodeTypeCommand(m.nodeId, 'switch')
  }
  close()
}

function setBridge(aOverB: boolean, plain = false): void {
  const m = store.contextMenu
  if (m.trackAId && m.trackBId) {
    const mode = plain ? 'plain' : aOverB ? 'bridge-a-over-b' : 'bridge-b-over-a'
    store.editor?.setCrossingMode(m.trackAId, m.trackBId, m.point, mode)
  }
  close()
}
</script>

<template>
  <div v-if="store.contextMenu.open" class="ctx-backdrop" @mousedown.self="close" @contextmenu.prevent="close">
    <div class="ctx-menu" :style="{ left: store.contextMenu.x + 'px', top: store.contextMenu.y + 'px' }">
      <template v-if="store.contextMenu.kind === 'track'">
        <button class="ctx-item" @click="selectTrack">编辑轨道</button>
        <div class="ctx-sep" />
        <button class="ctx-item" @click="generateParallel">生成平行轨道</button>
        <button class="ctx-item" @click="reverseTrack">反转线路方向</button>
        <button class="ctx-item" @click="addStartMarker">添加起点方向标识</button>
        <button class="ctx-item" @click="addEndMarker">添加终点方向标识</button>
        <div class="ctx-sep" />
        <button class="ctx-item danger" @click="deleteSelected">删除</button>
      </template>

      <template v-else-if="store.contextMenu.kind === 'node'">
        <button class="ctx-item" @click="setAsSwitch">设为道岔</button>
        <button class="ctx-item" @click="splitNode">拆分节点</button>
        <button v-if="store.editor?.document.nodes.find(n => n.id === store.contextMenu.nodeId)?.nodeType === 'junction'" class="ctx-item" @click="disconnectJunction">取消线路连接</button>
        <div class="ctx-sep" />
        <button class="ctx-item danger" @click="deleteNode">删除节点</button>
      </template>

      <template v-else-if="store.contextMenu.kind === 'intersection'">
        <div class="ctx-label">交叉</div>
        <div class="ctx-sep" />
        <button class="ctx-item" @click="connectCrossing">连接两条线路</button>
        <button class="ctx-item" @click="setAsSwitch">设为道岔</button>
        <button class="ctx-item" @click="setBridge(true)">设置 A 跨越 B</button>
        <button class="ctx-item" @click="setBridge(false)">设置 B 跨越 A</button>
        <button class="ctx-item" @click="setBridge(true, true)">普通交叉</button>
      </template>

      <template v-else>
        <button class="ctx-item" @click="close">刷新视图</button>
      </template>
    </div>
  </div>
</template>

<style scoped lang="scss">
.ctx-backdrop {
  position: absolute;
  inset: 0;
  z-index: 25;
}

.ctx-menu {
  position: absolute;
  min-width: 180px;
  padding: 4px;
  background: #fff;
  border: 1px solid var(--rail-border);
  border-radius: 3px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.16);
  display: flex;
  flex-direction: column;
}

.ctx-item {
  display: block;
  width: 100%;
  text-align: left;
  height: 26px;
  padding: 0 10px;
  border: none;
  background: transparent;
  border-radius: 2px;
  font-size: 12px;
}

.ctx-item:hover {
  background: #eef3fa;
}

.ctx-item.danger {
  color: var(--rail-danger);
}

.ctx-label {
  padding: 2px 10px 4px;
  font-size: 11px;
  color: var(--rail-text-muted);
}

.ctx-sep {
  height: 1px;
  background: var(--rail-border);
  margin: 3px 0;
}
</style>
