<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useEditorStore } from '../../stores/editor'

const store = useEditorStore()
const inputRef = ref<HTMLInputElement | null>(null)

watch(
  () => store.labelPrompt.open,
  async (open) => {
    if (open) {
      await nextTick()
      inputRef.value?.focus()
      inputRef.value?.select()
    }
  },
)

function confirm(): void {
  if (store.labelPrompt.text.trim()) {
    store.completeLabel(store.labelPrompt.text)
  } else {
    store.cancelLabel()
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter') confirm()
  if (e.key === 'Escape') store.cancelLabel()
}
</script>

<template>
  <div v-if="store.labelPrompt.open" class="label-dialog-backdrop" @mousedown.self="store.cancelLabel()">
    <div class="label-dialog">
      <div class="label-dialog-title">输入文字</div>
      <input
        ref="inputRef"
        v-model="store.labelPrompt.text"
        class="label-input"
        placeholder="请输入文字内容"
        @keydown="onKeydown"
      />
      <div class="label-dialog-actions">
        <button class="label-cancel" @click="store.cancelLabel()">取消</button>
        <button class="label-confirm" @click="confirm()">确定</button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.label-dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.22);
  display: grid;
  place-items: center;
  z-index: 30;
}

.label-dialog {
  width: 320px;
  padding: 16px;
  background: #fff;
  border: 1px solid var(--rail-border);
  border-radius: 4px;
  box-shadow: 0 12px 40px rgba(15, 23, 42, 0.18);
}

.label-dialog-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 10px;
}

.label-input {
  width: 100%;
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--rail-border);
  border-radius: 3px;
  font-size: 13px;
}

.label-input:focus {
  outline: none;
  border-color: var(--rail-accent);
}

.label-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.label-dialog-actions button {
  height: 28px;
  padding: 0 12px;
  border-radius: 3px;
  border: 1px solid var(--rail-border);
  background: #fff;
  font-size: 12px;
}

.label-confirm {
  background: var(--rail-accent) !important;
  border-color: var(--rail-accent) !important;
  color: #fff !important;
}

.label-confirm:hover {
  background: var(--rail-accent-hover) !important;
}
</style>
