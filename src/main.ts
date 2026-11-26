import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { useEditorStore } from './stores/editor'
import { createDemoDocument } from './editor/model/DemoDocument'
import './styles/main.scss'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)

// 在挂载前初始化 Editor Core：子组件 onMounted 可以直接 attach。
const store = useEditorStore(pinia)
store.initEditor(createDemoDocument())

// 仅开发环境暴露测试 / 调试句柄（生产构建不包含）。
if (import.meta.env.DEV) {
  const testWindow = window as unknown as Record<string, unknown>
  testWindow.__railsketchEditor = store.editor
  testWindow.__railsketchStore = store
}

app.mount('#app')
