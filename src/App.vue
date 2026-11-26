<script setup lang="ts">
import { onMounted } from 'vue'
import { useEditorStore } from './stores/editor'
import { createDemoDocument } from './editor/model/DemoDocument'
import TopBar from './components/editor/TopBar.vue'
import Toolbar from './components/editor/Toolbar.vue'
import EditorCanvas from './components/editor/EditorCanvas.vue'
import PropertyPanel from './components/editor/PropertyPanel.vue'
import LayerPanel from './components/editor/LayerPanel.vue'
import StatusBar from './components/editor/StatusBar.vue'
import LabelInputDialog from './components/editor/LabelInputDialog.vue'
import ParallelDialog from './components/editor/ParallelDialog.vue'
import NodeSplitDialog from './components/editor/NodeSplitDialog.vue'

const store = useEditorStore()

onMounted(() => {
  // Demo 文档仅在没有自动保存数据时使用。
  const initial = createDemoDocument()
  store.initEditor(initial)
})
</script>

<template>
  <div class="rails-app">
    <TopBar />
    <div class="rails-main">
      <Toolbar />
      <main class="rails-canvas-wrap">
        <EditorCanvas />
      </main>
      <aside class="rails-side">
        <PropertyPanel />
        <LayerPanel />
      </aside>
    </div>
    <StatusBar />
    <LabelInputDialog />
    <ParallelDialog />
    <NodeSplitDialog />
  </div>
</template>
