<script setup lang="ts">
import { useEditorStore } from '../../stores/editor'

const store = useEditorStore()
</script>

<template>
  <div v-if="store.batchLayoutDialog.open" class="batch-backdrop" @mousedown.self="store.closeBatchLayoutDialog()" @contextmenu.prevent="store.closeBatchLayoutDialog()">
    <div class="batch-dialog">
      <h3 class="batch-title">批量布置站台线路</h3>
      <p class="hint">每行一个元素，从上到下排列；“站台”为站台行，“线线线”= 三条平行轨道。生成位置为当前视口中心。</p>
      <textarea
        v-model="store.batchLayoutDialog.text"
        class="batch-textarea"
        rows="7"
        spellcheck="false"
        placeholder="站台&#10;线&#10;站台&#10;线线线&#10;站台"
      />
      <div class="batch-grid">
        <label class="batch-field">
          <span>线路长度</span>
          <input type="number" min="50" step="10" v-model.number="store.batchLayoutDialog.length" />
        </label>
        <label class="batch-field">
          <span>行间距</span>
          <input type="number" min="10" step="5" v-model.number="store.batchLayoutDialog.rowSpacing" />
        </label>
        <label class="batch-field">
          <span>轨道间距</span>
          <input type="number" min="2" step="2" v-model.number="store.batchLayoutDialog.trackSpacing" />
        </label>
        <label class="batch-field">
          <span>站台宽度</span>
          <input type="number" min="2" step="1" v-model.number="store.batchLayoutDialog.platformWidth" />
        </label>
      </div>
      <div class="batch-actions">
        <button class="batch-btn" @click="store.closeBatchLayoutDialog()">取消</button>
        <button class="batch-btn primary" @click="store.confirmBatchLayout()">生成</button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.batch-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(15, 23, 42, 0.18);
  display: grid;
  place-items: center;
}

.batch-dialog {
  width: 360px;
  background: #fff;
  border: 1px solid var(--rail-border);
  border-radius: 4px;
  box-shadow: 0 16px 48px rgba(15, 23, 42, 0.22);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.batch-title {
  margin: 0;
  font-size: 14px;
  color: var(--rail-text);
}

.batch-textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  border: 1px solid var(--rail-border);
  border-radius: 3px;
  padding: 6px 8px;
  font-size: 13px;
  font-family: inherit;
  line-height: 1.7;
}

.batch-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 12px;
}

.batch-field {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
  color: var(--rail-text);
}

.batch-field span {
  flex: none;
  white-space: nowrap;
  color: var(--rail-text-muted);
}

.batch-field input {
  flex: 1;
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--rail-border);
  border-radius: 3px;
  padding: 3px 6px;
  font-size: 12px;
}

.batch-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.batch-btn {
  height: 26px;
  padding: 0 14px;
  border: 1px solid var(--rail-border);
  background: #fff;
  border-radius: 3px;
  font-size: 12px;
  cursor: pointer;
}

.batch-btn.primary {
  background: var(--rail-accent);
  border-color: var(--rail-accent);
  color: #fff;
}
</style>
