<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useEditorStore } from '../../stores/editor'
import ContextMenu from './ContextMenu.vue'

const store = useEditorStore()
const wrapRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)

let attached = false

onMounted(() => {
  const canvas = canvasRef.value
  const wrap = wrapRef.value
  const core = store.editor
  if (canvas && wrap && core) {
    core.attach(canvas, wrap)
    attached = true
    // attach 内部已完成一次 fit；这里再确保画布占满父级后仍有正确尺寸。
    requestAnimationFrame(() => core.invalidate())
  }
})

onBeforeUnmount(() => {
  if (attached) store.editor?.dispose()
})
</script>

<template>
  <div ref="wrapRef" class="editor-canvas-wrap">
    <canvas ref="canvasRef" class="editor-canvas" tabindex="-1" />
    <ContextMenu />
    <div class="canvas-hint">
      Space+拖拽平移 · 滚轮缩放 · T 轨道 · V 选择
    </div>
  </div>
</template>

<style scoped lang="scss">
.editor-canvas-wrap {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.editor-canvas {
  display: block;
  position: absolute;
  inset: 0;
  touch-action: none;
}

.canvas-hint {
  position: absolute;
  right: 12px;
  bottom: 10px;
  padding: 3px 8px;
  border: 1px solid var(--rail-border);
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.82);
  color: var(--rail-text-muted);
  font-size: 11px;
  pointer-events: none;
}
</style>
