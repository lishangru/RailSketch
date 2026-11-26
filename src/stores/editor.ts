import { defineStore } from 'pinia'
import { computed, onScopeDispose, reactive, shallowRef, ref } from 'vue'
import { createEditor } from '../editor/editorFactory'
import type { DiagramElement, RailDocument, StationKind, ToolId } from '../types'
import { createDocument } from '../editor/model/Document'
import { MAX_DOCUMENT_BYTES, parseDocument } from '../editor/serialization/serializer'
import type { Editor } from '../editor/core/Editor'

export const AUTOSAVE_KEY = 'railsketch.autosave.v1'

interface OpenProjectResult {
  ok: boolean
  error?: string
  cancelled?: boolean
}

/**
 * Pinia 仅保存 UI 关心与跨组件共享的低频状态：
 * 当前文档引用、工具、选择、保存状态、鼠标世界坐标和版本号。
 * Canvas 高频中间数据全部保留在 Editor Core 内部。
 */
export const useEditorStore = defineStore('editor', () => {
  const editor = shallowRef<Editor | null>(null)
  const version = ref(0)
  const saveState = ref<'saved' | 'saving' | 'dirty' | 'error'>('saved')
  const saveError = ref<string | null>(null)
  const fileMessage = ref<{ kind: 'info' | 'error'; text: string } | null>(null)
  const mouseWorld = reactive({ x: 0, y: 0 })
  const showGrid = ref(true)
  const snapGrid = ref(true)
  const activeLayerId = ref<string | null>(null)
  const labelPrompt = reactive({ open: false, x: 0, y: 0, text: '' })
  const contextMenu = reactive({
    open: false,
    x: 0,
    y: 0,
    kind: 'canvas' as 'canvas' | 'track' | 'node' | 'intersection' | 'marker',
    trackId: '',
    nodeId: '',
    markerId: '',
    trackAId: '',
    trackBId: '',
    point: { x: 0, y: 0 },
  })
  const parallelDialog = reactive({ open: false, trackId: '', count: 1, spacing: 20, side: 'right' as 'left' | 'right' | 'both' })
  const nodeSplitDialog = reactive({ open: false, nodeId: '', keepIds: [] as string[] })
  const batchLayoutDialog = reactive({ open: false, text: '', length: 500, rowSpacing: 80, trackSpacing: 24, platformWidth: 16 })

  const tool = ref<ToolId>('select')
  /** 车站工具当前绘制的站点类型。 */
  const stationKind = ref<StationKind>('station')
  const viewVersion = ref(0)

  function initEditor(initial: RailDocument): Editor {
    if (editor.value) return editor.value
    const doc = restoreOrCreate(initial)
    const instance = createEditor(doc)
    wireEditor(instance)
    editor.value = instance
    syncTool()
    showGrid.value = instance.state.showGrid
    snapGrid.value = instance.state.snapGrid
    activeLayerId.value = instance.state.activeLayerId
    return instance
  }

  function wireEditor(instance: Editor): void {
    instance.onChange = () => {
      if (disposed) return
      version.value++
      activeLayerId.value = instance.state.activeLayerId
      scheduleAutosave()
    }
    instance.onViewChange = () => {
      viewVersion.value++
    }
    instance.onSelectionChange = () => {
      version.value++
    }
    instance.onChangeTool = () => {
      tool.value = instance.state.tool
      stationKind.value = instance.state.stationKind
    }
    instance.onCursorChange = () => {
      // 指针样式主要由 Editor 直接写到 canvas.style.cursor
    }
    instance.onPointerWorld = (p) => {
      mouseWorld.x = Math.round(p.x)
      mouseWorld.y = Math.round(p.y)
    }
    instance.requestLabelPlacement = (world) => {
      labelPrompt.open = true
      labelPrompt.x = Math.round(world.x)
      labelPrompt.y = Math.round(world.y)
      labelPrompt.text = ''
    }
    instance.onContextMenuRequest = (menu) => {
      contextMenu.open = true
      contextMenu.x = menu.screen.x
      contextMenu.y = menu.screen.y
      contextMenu.kind = menu.kind
      contextMenu.trackId = menu.kind === 'track' ? menu.trackId : ''
      contextMenu.nodeId = menu.kind === 'node' ? menu.nodeId : ''
      contextMenu.markerId = menu.kind === 'marker' ? menu.markerId : ''
      contextMenu.trackAId = menu.kind === 'intersection' ? menu.trackAId : ''
      contextMenu.trackBId = menu.kind === 'intersection' ? menu.trackBId : ''
      contextMenu.point = menu.kind === 'intersection' ? { ...menu.point } : { x: 0, y: 0 }
    }
    instance.onSaveRequest = () => saveProject()
    instance.onOpenRequest = () => storeOpenRequest()
    showGrid.value = instance.state.showGrid
    snapGrid.value = instance.state.snapGrid
  }

  function syncTool(): void {
    if (editor.value) tool.value = editor.value.state.tool
  }

  function setTool(t: ToolId): void {
    tool.value = t
    if (editor.value) editor.value.setTool(t)
  }

  function setStationKind(kind: StationKind): void {
    stationKind.value = kind
    if (editor.value) editor.value.state.stationKind = kind
  }

  function setShowGrid(v: boolean): void {
    showGrid.value = v
    if (editor.value) {
      editor.value.state.showGrid = v
      editor.value.invalidate()
    }
  }

  function setSnapGrid(v: boolean): void {
    snapGrid.value = v
    if (editor.value) {
      editor.value.state.snapGrid = v
      editor.value.invalidate()
    }
  }

  function setActiveLayerId(id: string | null): void {
    activeLayerId.value = id
    if (editor.value) editor.value.state.activeLayerId = id
  }

  const selectedIds = computed<string[]>(() => {
    void version.value
    return editor.value?.state.selectionIds ?? []
  })

  const selectedElement = computed<DiagramElement | null>(() => {
    const ids = selectedIds.value
    if (!editor.value || ids.length !== 1) return null
    return editor.value.getElement(ids[0]) ?? null
  })

  const document = computed<RailDocument | null>(() => {
    void version.value
    return editor.value?.document ?? null
  })
  const zoom = computed(() => {
    void viewVersion.value
    return editor.value?.camera.zoom ?? 1
  })

  // —— 自动保存（500ms debounce）——
  let disposed = false
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null
  let openVersion = 0
  let cancelOpen: (() => void) | null = null
  let cleanupFileInput: (() => void) | null = null
  const downloadTimers = new Map<string, ReturnType<typeof setTimeout>>()

  function clearAutosaveTimer(): void {
    if (autosaveTimer !== null) clearTimeout(autosaveTimer)
    autosaveTimer = null
  }

  function scheduleAutosave(): void {
    if (disposed) return
    clearAutosaveTimer()
    saveState.value = 'dirty'
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null
      persistDocument()
    }, 500)
  }

  function persistDocument(): boolean {
    if (disposed || !editor.value) return false
    clearAutosaveTimer()
    saveState.value = 'saving'
    try {
      localStorage.setItem(AUTOSAVE_KEY, editor.value.toJSON())
      saveError.value = null
      saveState.value = 'saved'
      return true
    } catch {
      saveError.value = '自动保存失败，可能是浏览器存储不可用或空间不足；请导出项目备份。'
      saveState.value = 'error'
      return false
    }
  }

  function restoreOrCreate(initial: RailDocument): RailDocument {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY)
      if (raw) {
        // 所有恢复/导入路径均使用同一个大小检查、解析和验证入口。
        const result = parseDocument(raw)
        if (result.ok && result.document) return result.document
        fileMessage.value = { kind: 'error', text: `自动保存恢复失败：${result.error ?? '无效的项目文件'}` }
      }
    } catch {
      fileMessage.value = { kind: 'error', text: '无法读取浏览器自动保存；已使用初始项目。' }
    }
    return initial
  }

  function cancelPendingOpen(): void {
    openVersion++
    cleanupFileInput?.()
    cancelOpen?.()
  }

  function replaceDocument(doc: RailDocument): void {
    if (disposed || !editor.value) return
    editor.value.setDocument(doc)
    activeLayerId.value = editor.value.state.activeLayerId
    version.value++
    scheduleAutosave()
  }

  function applyLoadedDocument(doc: RailDocument): void {
    cancelPendingOpen()
    replaceDocument(doc)
  }

  function newProject(): void {
    applyLoadedDocument(createDocument('未命名项目'))
  }

  const exporting = ref(false)

  /**
   * 导出当前文档为图片 / PDF。
   *
   * 走独立的离屏渲染路径，不影响画布上的当前视图与撤销历史。
   */
  async function exportImage(format: 'png' | 'jpg' | 'pdf'): Promise<void> {
    const instance = editor.value
    if (!instance || exporting.value) return
    exporting.value = true
    try {
      const { exportDocument, downloadBlob, formatBytes } = await import('../editor/export/Exporter')
      const result = await exportDocument(instance.document, { format, scale: 2, padding: 24, clean: true })
      downloadBlob(result.blob, result.fileName)
      fileMessage.value = {
        kind: 'info',
        text: `已导出 ${result.fileName}（${result.width}×${result.height}，${formatBytes(result.blob.size)}）`,
      }
    } catch (error) {
      fileMessage.value = {
        kind: 'error',
        text: `导出失败：${error instanceof Error ? error.message : String(error)}`,
      }
    } finally {
      exporting.value = false
    }
  }

  function revokeDownload(url: string): void {
    const timer = downloadTimers.get(url)
    if (timer !== undefined) clearTimeout(timer)
    downloadTimers.delete(url)
    URL.revokeObjectURL(url)
  }

  function saveProject(): boolean {
    if (disposed || !editor.value) return false
    let url: string | null = null
    try {
      const json = editor.value.toJSON()
      const blob = new Blob([json], { type: 'application/json' })
      url = URL.createObjectURL(blob)
      const a = globalThis.document.createElement('a')
      const name = editor.value.document.name || '未命名项目'
      a.href = url
      a.download = `${name.replace(/[\\/:*?"<>|]/g, '_')}.rail.json`
      a.click()
      const downloadUrl = url
      downloadTimers.set(downloadUrl, setTimeout(() => revokeDownload(downloadUrl), 500))
      // 发起下载不等于浏览器自动保存成功，不覆盖 dirty/error 状态。
      fileMessage.value = { kind: 'info', text: '已发起 .rail.json 项目下载' }
      return true
    } catch {
      if (url !== null) revokeDownload(url)
      fileMessage.value = { kind: 'error', text: '项目导出失败，请重试。' }
      return false
    }
  }

  function openProject(file: File): Promise<OpenProjectResult> {
    cancelPendingOpen()
    const requestVersion = openVersion
    return new Promise((resolve) => {
      let reader: FileReader | null = null
      let settled = false
      const finish = (result: OpenProjectResult): void => {
        if (settled) return
        settled = true
        if (reader) reader.onload = reader.onerror = reader.onabort = null
        if (cancelOpen === cancel) cancelOpen = null
        if (!disposed && requestVersion === openVersion && !result.cancelled) {
          fileMessage.value = {
            kind: result.ok ? 'info' : 'error',
            text: result.ok ? '项目已打开' : result.error ?? '打开失败',
          }
        }
        resolve(result)
      }
      const cancel = (): void => {
        finish({ ok: false, cancelled: true, error: '文件打开已取消' })
        try {
          if (reader?.readyState === 1) reader.abort()
        } catch {
          // 已失效的读取即使无法 abort，也不能应用其迟到结果。
        }
      }
      if (disposed) {
        finish({ ok: false, cancelled: true, error: '编辑器已关闭' })
        return
      }
      cancelOpen = cancel
      try {
        if (!editor.value) {
          finish({ ok: false, error: '编辑器尚未初始化' })
          return
        }
        if (file.size > MAX_DOCUMENT_BYTES) {
          finish({ ok: false, error: `项目文件过大，不能超过 ${MAX_DOCUMENT_BYTES / 1024 / 1024} MiB` })
          return
        }
        reader = new FileReader()
        reader.onload = () => {
          if (settled || disposed || requestVersion !== openVersion) return
          try {
            if (typeof reader?.result !== 'string') {
              finish({ ok: false, error: '文件读取失败' })
              return
            }
            const result = parseDocument(reader.result)
            if (result.ok && result.document) {
              replaceDocument(result.document)
              finish({ ok: true })
            } else {
              finish({ ok: false, error: result.error ?? '无效的项目文件' })
            }
          } catch {
            finish({ ok: false, error: '文件打开失败' })
          }
        }
        reader.onerror = () => finish({ ok: false, error: '文件读取失败' })
        reader.onabort = () => finish({ ok: false, cancelled: true, error: '文件读取已取消' })
        reader.readAsText(file)
      } catch {
        finish({ ok: false, error: '文件读取失败' })
      }
    })
  }

  function requestOpenFile(): void {
    if (disposed) return
    cancelPendingOpen()
    const requestVersion = openVersion
    try {
      const input = globalThis.document.createElement('input')
      const cleanup = (): void => {
        input.onchange = input.oncancel = null
        input.value = ''
        if (cleanupFileInput === cleanup) cleanupFileInput = null
      }
      cleanupFileInput = cleanup
      input.type = 'file'
      input.accept = '.json,application/json'
      input.onchange = () => {
        const file = input.files?.[0]
        cleanup()
        // openProject 将结果发布到 fileMessage，菜单及快捷键均可获得反馈。
        if (!disposed && requestVersion === openVersion && file) void openProject(file)
      }
      input.oncancel = cleanup
      input.click()
    } catch {
      cleanupFileInput?.()
      fileMessage.value = { kind: 'error', text: '无法打开文件选择器，请重试。' }
    }
  }

  function storeOpenRequest(): void {
    requestOpenFile()
  }

  function flushAutosave(): void {
    if (autosaveTimer !== null || saveState.value === 'dirty' || saveState.value === 'error') {
      persistDocument()
    }
  }

  const eventWindow = typeof window === 'undefined' ? null : window
  eventWindow?.addEventListener('beforeunload', flushAutosave)
  onScopeDispose(() => {
    disposed = true
    clearAutosaveTimer()
    cancelPendingOpen()
    eventWindow?.removeEventListener('beforeunload', flushAutosave)
    for (const url of downloadTimers.keys()) revokeDownload(url)
  })

  function completeLabel(text: string): void {
    labelPrompt.open = false
    const trimmed = text.trim()
    if (!trimmed || !editor.value) return
    editor.value.commitLabel(trimmed, { x: labelPrompt.x, y: labelPrompt.y })
  }

  function cancelLabel(): void {
    labelPrompt.open = false
  }

  function updateDocumentName(name: string): void {
    if (!editor.value) return
    editor.value.document.name = name
    editor.value.markDirty()
  }

  function openParallelDialog(trackId: string): void {
    parallelDialog.open = true
    parallelDialog.trackId = trackId
    parallelDialog.count = 1
    parallelDialog.spacing = 20
    parallelDialog.side = 'right'
  }

  function confirmParallel(): void {
    parallelDialog.open = false
    if (!editor.value || !parallelDialog.trackId) return
    editor.value.createParallelTracks(parallelDialog.trackId, Math.max(1, Math.floor(parallelDialog.count)), Math.max(1, parallelDialog.spacing), parallelDialog.side)
  }

  function openNodeSplitDialog(nodeId: string): void {
    if (!editor.value) return
    const node = editor.value.document.nodes.find((n) => n.id === nodeId)
    if (!node) return
    nodeSplitDialog.open = true
    nodeSplitDialog.nodeId = nodeId
    nodeSplitDialog.keepIds = node.connectedTrackIds.slice()
  }

  function confirmNodeSplit(): void {
    nodeSplitDialog.open = false
    if (!editor.value || !nodeSplitDialog.nodeId) return
    editor.value.splitNodeCommand(nodeSplitDialog.nodeId, nodeSplitDialog.keepIds)
  }

  function checkTopology(): string[] {
    return editor.value?.getTopologyIssues() ?? []
  }

  /** 解析批量布置文本：每行一个元素，站台 = 含“站/台”，线 = “线”字重复次数。 */
  function parseBatchLayoutText(text: string): { type: 'platform' | 'tracks'; count: number }[] {
    const rows: { type: 'platform' | 'tracks'; count: number }[] = []
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const hasPlatform = /[站台]/.test(trimmed)
      const trackCount = (trimmed.match(/[线]/g) ?? []).length
      if (hasPlatform && trackCount === 0) rows.push({ type: 'platform', count: 1 })
      else if (trackCount > 0) rows.push({ type: 'tracks', count: Math.min(20, trackCount) })
    }
    return rows
  }

  function openBatchLayoutDialog(): void {
    batchLayoutDialog.open = true
    if (!batchLayoutDialog.text) batchLayoutDialog.text = '站台\n线\n站台\n线线线\n站台'
  }

  function closeBatchLayoutDialog(): void {
    batchLayoutDialog.open = false
  }

  function confirmBatchLayout(): void {
    const rows = parseBatchLayoutText(batchLayoutDialog.text)
    if (!editor.value || rows.length === 0) return
    editor.value.createBatchLayout(rows, {
      length: Math.max(50, batchLayoutDialog.length),
      rowSpacing: Math.max(10, batchLayoutDialog.rowSpacing),
      trackSpacing: Math.max(2, batchLayoutDialog.trackSpacing),
      platformWidth: Math.max(2, batchLayoutDialog.platformWidth),
    })
    batchLayoutDialog.open = false
  }

  function updateCanvasGridSize(size: number): void {
    if (!editor.value || !Number.isFinite(size)) return
    editor.value.document.canvas.gridSize = Math.max(1, size)
    editor.value.markDirty()
  }

  return {
    editor,
    version,
    tool,
    stationKind,
    saveState,
    saveError,
    fileMessage,
    mouseWorld,
    showGrid,
    snapGrid,
    activeLayerId,
    labelPrompt,
    selectedIds,
    selectedElement,
    document,
    zoom,
    initEditor,
    setTool,
    setStationKind,
    setShowGrid,
    setSnapGrid,
    setActiveLayerId,
    newProject,
    exportImage,
    exporting,
    saveProject,
    openProject,
    requestOpenFile,
    applyLoadedDocument,
    persistDocument,
    completeLabel,
    cancelLabel,
    updateDocumentName,
    updateCanvasGridSize,
    contextMenu,
    parallelDialog,
    nodeSplitDialog,
    openParallelDialog,
    confirmParallel,
    openNodeSplitDialog,
    confirmNodeSplit,
    checkTopology,
    batchLayoutDialog,
    openBatchLayoutDialog,
    closeBatchLayoutDialog,
    confirmBatchLayout,
  }
})
