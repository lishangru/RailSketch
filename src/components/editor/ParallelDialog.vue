<script setup lang="ts">
import { useEditorStore } from '../../stores/editor'

const store = useEditorStore()
</script>

<template>
  <div v-if="store.parallelDialog.open" class="dlg-backdrop" @mousedown.self="store.parallelDialog.open = false">
    <div class="dlg">
      <div class="dlg-title">生成平行轨道</div>
      <label class="dlg-row">数量
        <input v-model.number="store.parallelDialog.count" type="number" min="1" max="20" />
      </label>
      <label class="dlg-row">间距
        <input v-model.number="store.parallelDialog.spacing" type="number" min="1" />
      </label>
      <div class="dlg-row">方向
        <label><input v-model="store.parallelDialog.side" type="radio" value="left" /> 左侧</label>
        <label><input v-model="store.parallelDialog.side" type="radio" value="right" /> 右侧</label>
        <label><input v-model="store.parallelDialog.side" type="radio" value="both" /> 两侧居中</label>
      </div>
      <div class="dlg-actions">
        <button @click="store.parallelDialog.open = false">取消</button>
        <button class="primary" @click="store.confirmParallel">确定</button>
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
  width: 300px;
  padding: 14px 16px;
  background: #fff;
  border: 1px solid var(--rail-border);
  border-radius: 4px;
  box-shadow: 0 12px 40px rgba(15, 23, 42, 0.16);
}

.dlg-title {
  font-weight: 600;
  margin-bottom: 12px;
}

.dlg-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  font-size: 12px;
}

.dlg-row input[type='number'] {
  width: 70px;
  height: 24px;
  border: 1px solid var(--rail-border);
  border-radius: 3px;
  padding: 0 6px;
}

.dlg-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.dlg-actions button {
  height: 26px;
  padding: 0 12px;
  border: 1px solid var(--rail-border);
  background: #fff;
  border-radius: 3px;
  font-size: 12px;
}

.dlg-actions .primary {
  background: var(--rail-accent);
  border-color: var(--rail-accent);
  color: #fff;
}
</style>
