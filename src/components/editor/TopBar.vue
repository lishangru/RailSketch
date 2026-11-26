<script setup lang="ts">
import { onScopeDispose, ref, watch } from 'vue'
import { useEditorStore } from '../../stores/editor'
import BatchLayoutDialog from './BatchLayoutDialog.vue'

const store = useEditorStore()
const menuOpen = ref<'file' | 'view' | null>(null)
const toast = ref<{ kind: 'info' | 'error'; text: string } | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(kind: 'info' | 'error', text: string): void {
  toast.value = { kind, text }
  if (toastTimer !== null) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.value = null
    toastTimer = null
  }, 2600)
}

// 统一展示文件菜单、导入和编辑器快捷键触发的文件操作结果。
watch(() => store.fileMessage, (message) => {
  if (message) showToast(message.kind, message.text)
}, { immediate: true })
watch(() => store.saveError, (error) => {
  if (error) showToast('error', error)
}, { immediate: true })

function toggleMenu(menu: 'file' | 'view'): void {
  menuOpen.value = menuOpen.value === menu ? null : menu
}

function closeMenu(): void {
  menuOpen.value = null
}

function onWindowClick(e: MouseEvent): void {
  const target = e.target as HTMLElement
  if (!target.closest('.topbar')) closeMenu()
}

const eventWindow = typeof window === 'undefined' ? null : window
eventWindow?.addEventListener('mousedown', onWindowClick)
onScopeDispose(() => {
  eventWindow?.removeEventListener('mousedown', onWindowClick)
  if (toastTimer !== null) clearTimeout(toastTimer)
})

function doNew(): void {
  store.newProject()
  closeMenu()
  showToast('info', '已新建项目')
}

function doSave(): void {
  store.saveProject()
  closeMenu()
}

async function doExport(format: 'png' | 'jpg' | 'pdf'): Promise<void> {
  closeMenu()
  await store.exportImage(format)
}

function doOpen(): void {
  closeMenu()
  store.requestOpenFile()
}

function checkTopology(): void {
  closeMenu()
  const issues = store.checkTopology()
  showToast(issues.length ? 'error' : 'info', issues.length ? `拓扑问题：${issues.join('；')}` : '拓扑检查通过')
}

async function handleFileOpen(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) {
    closeMenu()
    await store.openProject(file)
  }
}
</script>

<template>
  <header class="topbar">
    <div class="brand">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M3 7h18M3 12h18M3 17h18" fill="none" stroke="currentColor" stroke-width="2" />
        <path d="M7 7v10M17 12l3 5M17 7v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
      <span class="brand-name">RailSketch</span>
      <span class="brand-sub">铁路配线图编辑器</span>
    </div>

    <nav class="menu">
      <button class="menu-button" :class="{ active: menuOpen === 'file' }" @click="toggleMenu('file')">文件</button>
      <button class="menu-button" :class="{ active: menuOpen === 'view' }" @click="toggleMenu('view')">视图</button>
    </nav>

    <div v-if="menuOpen === 'file'" class="menu-dropdown">
      <button class="menu-item" @click="doNew">新建项目</button>
      <button class="menu-item" @click="doOpen">打开项目…</button>
      <button class="menu-item" @click="doSave">保存项目（Ctrl+S）</button>
      <div class="menu-sep" />
      <button class="menu-item" @click="doExport('png')">导出 PNG 图片</button>
      <button class="menu-item" @click="doExport('jpg')">导出 JPG 图片</button>
      <button class="menu-item" @click="doExport('pdf')">导出 PDF</button>
      <div class="menu-sep" />
      <label class="menu-item file-label">
        导入 JSON 文件
        <input class="file-input-hidden" type="file" accept=".json,application/json" @change="handleFileOpen" />
      </label>
    </div>

    <div v-if="menuOpen === 'view'" class="menu-dropdown view-menu">
      <label class="menu-item">
        <input type="checkbox" :checked="store.showGrid" @change="store.setShowGrid(($event.target as HTMLInputElement).checked)" />
        显示网格
      </label>
      <label class="menu-item">
        <input type="checkbox" :checked="store.snapGrid" @change="store.setSnapGrid(($event.target as HTMLInputElement).checked)" />
        吸附网格
      </label>
      <div class="menu-sep" />
      <button class="menu-item" @click="checkTopology">调试：检查拓扑</button>
    </div>

    <div class="topbar-tools">
      <button class="topbar-action" title="批量布置站台与线路（在画布空白位置生成）" @click="store.openBatchLayoutDialog()">
        批量布置
      </button>
      <label class="tool-check" title="显示网格">
        <input type="checkbox" :checked="store.showGrid" @change="store.setShowGrid(($event.target as HTMLInputElement).checked)" />
        网格
      </label>
      <label class="tool-check" title="吸附网格（含线路中心线 / 虚拟对齐）">
        <input type="checkbox" :checked="store.snapGrid" @change="store.setSnapGrid(($event.target as HTMLInputElement).checked)" />
        吸附
      </label>
    </div>

    <div class="zoom-box">
      <span class="zoom-value">{{ Math.round(store.zoom * 100) }}%</span>
    </div>

    <BatchLayoutDialog />

    <div v-if="toast" class="toast" :class="toast.kind">{{ toast.text }}</div>
  </header>
</template>

<style scoped lang="scss">
.topbar {
  height: var(--rail-topbar-height);
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  background: var(--rail-panel);
  border-bottom: 1px solid var(--rail-border);
  position: relative;
  z-index: 20;
}

.brand {
  display: flex;
  align-items: baseline;
  gap: 8px;
  color: var(--rail-accent);
  min-width: 190px;
}

.brand-name {
  font-weight: 700;
  font-size: 14px;
  color: var(--rail-text);
}

.brand-sub {
  font-size: 11px;
  color: var(--rail-text-muted);
}

.menu {
  display: flex;
  gap: 2px;
}

.menu-button {
  height: 28px;
  padding: 0 10px;
  border: none;
  border-radius: 3px;
  background: transparent;
  font-size: 12px;
}

.menu-button:hover,
.menu-button.active {
  background: #e9eef4;
}

.menu-dropdown {
  position: absolute;
  top: 42px;
  left: 12px;
  min-width: 180px;
  padding: 4px;
  background: #fff;
  border: 1px solid var(--rail-border);
  border-radius: 3px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.14);
  display: flex;
  flex-direction: column;
  z-index: 25;
}

.menu-item {
  display: block;
  width: 100%;
  text-align: left;
  height: 28px;
  padding: 0 10px;
  border: none;
  background: transparent;
  border-radius: 2px;
  font-size: 12px;
}

.menu-item:hover {
  background: #eef3fa;
}

.menu-sep {
  height: 1px;
  background: var(--rail-border);
  margin: 4px 0;
}

.file-label {
  display: flex;
  align-items: center;
}

.view-menu {
  left: 56px;
}

.view-menu .menu-item {
  display: flex;
  align-items: center;
  gap: 7px;
}

.file-input-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.topbar-tools {
  margin-left: 12px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.topbar-action {
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--rail-border);
  background: #fff;
  border-radius: 3px;
  font-size: 12px;
  color: var(--rail-text);
  cursor: pointer;
}

.topbar-action:hover {
  border-color: var(--rail-accent);
  color: var(--rail-accent);
}

.tool-check {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--rail-text-muted);
  cursor: pointer;
}

.zoom-box {
  margin-left: auto;
}

.zoom-value {
  font-size: 12px;
  color: var(--rail-text-muted);
  font-variant-numeric: tabular-nums;
}

.toast {
  position: absolute;
  right: 16px;
  bottom: -40px;
  padding: 5px 12px;
  border-radius: 3px;
  font-size: 12px;
  background: #eef7ff;
  color: #1d4ed8;
  border: 1px solid #bcd5f5;
  z-index: 40;
}

.toast.error {
  background: #fef2f2;
  color: #b91c1c;
  border-color: #f1c4c4;
}
</style>
