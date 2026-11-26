import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { AUTOSAVE_KEY, useEditorStore } from '../src/stores/editor'
import { createDocument } from '../src/editor/model/Document'
import { MAX_DOCUMENT_BYTES } from '../src/editor/serialization/serializer'

class StorageStub {
  values = new Map<string, string>()
  writes = 0
  failRead = false
  failWrite = false

  getItem(key: string): string | null {
    if (this.failRead) throw new Error('Storage access denied')
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.writes++
    if (this.failWrite) throw new Error('Storage quota exceeded')
    this.values.set(key, value)
  }
}

class WindowStub {
  listeners = new Map<string, Set<() => void>>()

  addEventListener(type: string, listener: () => void): void {
    let listeners = this.listeners.get(type)
    if (!listeners) this.listeners.set(type, listeners = new Set())
    listeners.add(listener)
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener()
  }
}

class FileReaderStub {
  static instances: FileReaderStub[] = []
  static throwOnConstruct = false
  static throwOnRead = false
  static throwOnAbort = false
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  result: string | ArrayBuffer | null = null
  readyState = 0
  readCalls = 0
  abortCalls = 0

  constructor() {
    if (FileReaderStub.throwOnConstruct) throw new Error('FileReader unavailable')
    FileReaderStub.instances.push(this)
  }

  readAsText(_file: File): void {
    this.readCalls++
    if (FileReaderStub.throwOnRead) throw new Error('Cannot read file')
    this.readyState = 1
  }

  abort(): void {
    this.abortCalls++
    if (FileReaderStub.throwOnAbort) throw new Error('Cannot abort file')
    this.readyState = 2
    this.onabort?.()
  }

  load(text: string): void {
    this.result = text
    this.readyState = 2
    this.onload?.()
  }

  fail(): void {
    this.readyState = 2
    this.onerror?.()
  }
}

function stubGlobal(t: TestContext, name: string, value: unknown): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, name)
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, name, original)
    else Reflect.deleteProperty(globalThis, name)
  })
}

function setup(t: TestContext, initialize = true) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const storage = new StorageStub()
  const window = new WindowStub()
  const inputs: {
    type: string
    accept: string
    value: string
    files: File[]
    onchange: (() => void) | null
    oncancel: (() => void) | null
    click: () => void
  }[] = []
  const downloads: { href: string; download: string; click: () => void }[] = []
  const revoked: string[] = []
  const dom = { throwOnClick: false, throwOnDownload: false }
  FileReaderStub.instances = []
  FileReaderStub.throwOnConstruct = false
  FileReaderStub.throwOnRead = false
  FileReaderStub.throwOnAbort = false
  stubGlobal(t, 'localStorage', storage)
  stubGlobal(t, 'window', window)
  stubGlobal(t, 'FileReader', FileReaderStub)
  stubGlobal(t, 'document', {
    createElement(tag: string) {
      if (tag === 'input') {
        const input = {
          type: '', accept: '', value: '', files: [] as File[],
          onchange: null as (() => void) | null,
          oncancel: null as (() => void) | null,
          click() { if (dom.throwOnClick) throw new Error('Picker unavailable') },
        }
        inputs.push(input)
        return input
      }
      assert.equal(tag, 'a')
      const anchor = {
        href: '', download: '',
        click() {
          if (dom.throwOnDownload) throw new Error('Download unavailable')
          downloads.push(anchor)
        },
      }
      return anchor
    },
  })
  t.mock.method(URL, 'createObjectURL', () => `blob:test-${downloads.length}`)
  t.mock.method(URL, 'revokeObjectURL', (url: string) => { revoked.push(url) })
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useEditorStore()
  if (initialize) store.initEditor(createDocument('Original'))
  t.after(() => {
    store.$dispose()
    disposePinia(pinia)
    setActivePinia(undefined)
  })
  return { store, storage, window, inputs, downloads, revoked, dom }
}

function projectFile(name = 'Loaded', size?: number): File {
  const file = new File([JSON.stringify(createDocument(name))], `${name}.rail.json`, { type: 'application/json' })
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size })
  return file
}

function latestReader(): FileReaderStub {
  const reader = FileReaderStub.instances.at(-1)
  assert.ok(reader)
  return reader
}

test('autosave debounce saves the latest edit only after a successful storage write', (t) => {
  const { store, storage } = setup(t)
  store.updateDocumentName('First edit')
  t.mock.timers.tick(400)
  store.updateDocumentName('Latest edit')
  t.mock.timers.tick(499)
  assert.equal(storage.writes, 0)
  assert.equal(store.saveState, 'dirty')
  t.mock.timers.tick(1)
  assert.equal(storage.writes, 1)
  assert.equal(JSON.parse(storage.getItem(AUTOSAVE_KEY)!).name, 'Latest edit')
  assert.equal(store.saveState, 'saved')
  assert.equal(store.saveError, null)
})

test('storage failures never become saved and a later successful retry clears the error', (t) => {
  const { store, storage } = setup(t)
  storage.failWrite = true
  store.updateDocumentName('Unsaved edit')
  t.mock.timers.tick(500)
  assert.equal(store.saveState, 'error')
  assert.match(store.saveError!, /自动保存失败/)
  assert.equal(storage.getItem(AUTOSAVE_KEY), null)
  t.mock.timers.tick(1000)
  assert.equal(store.saveState, 'error', 'no delayed callback may claim that a failed write was saved')
  storage.failWrite = false
  assert.equal(store.persistDocument(), true)
  assert.equal(store.saveState, 'saved')
  assert.equal(store.saveError, null)
  assert.equal(JSON.parse(storage.getItem(AUTOSAVE_KEY)!).name, 'Unsaved edit')
})

test('serialization failures are handled like storage failures', (t) => {
  const { store, storage } = setup(t)
  t.mock.method(store.editor!, 'toJSON', () => { throw new Error('Cannot serialize') })
  assert.equal(store.persistDocument(), false)
  assert.equal(store.saveState, 'error')
  assert.equal(storage.writes, 0)
})

test('beforeunload flushes pending edits synchronously without triggering a download', (t) => {
  const { store, storage, window, downloads } = setup(t)
  store.updateDocumentName('Edit immediately before refresh')
  window.dispatch('beforeunload')
  assert.equal(JSON.parse(storage.getItem(AUTOSAVE_KEY)!).name, 'Edit immediately before refresh')
  assert.equal(store.saveState, 'saved')
  assert.equal(downloads.length, 0)
  t.mock.timers.tick(1000)
  assert.equal(storage.writes, 1, 'the old debounce must be cleared after flushing')
  window.dispatch('beforeunload')
  assert.equal(storage.writes, 1, 'an unchanged saved document needs no extra write')
})

test('beforeunload handles an unavailable store without downloading or throwing', (t) => {
  const { store, storage, window, downloads } = setup(t)
  storage.failWrite = true
  store.updateDocumentName('Still unsaved')
  assert.doesNotThrow(() => window.dispatch('beforeunload'))
  assert.equal(store.saveState, 'error')
  assert.equal(downloads.length, 0)
})

test('restoring a saved document uses a single shared parse-and-validation pass', (t) => {
  const { store, storage } = setup(t, false)
  storage.values.set(AUTOSAVE_KEY, JSON.stringify(createDocument('Restored')))
  const parse = JSON.parse
  let parses = 0
  t.mock.method(JSON, 'parse', (text: string) => {
    parses++
    return parse(text)
  })
  store.initEditor(createDocument('Fallback'))
  assert.equal(store.document?.name, 'Restored')
  assert.equal(parses, 1)
})

test('invalid stored data falls back safely and reports the restore error', (t) => {
  const { store, storage } = setup(t, false)
  storage.values.set(AUTOSAVE_KEY, '{"name":"Invalid","layers":{},"elements":[]}')
  store.initEditor(createDocument('Fallback'))
  assert.equal(store.document?.name, 'Fallback')
  assert.equal(store.fileMessage?.kind, 'error')
})

test('oversized localStorage data is rejected before JSON parsing', (t) => {
  const { store, storage } = setup(t, false)
  storage.values.set(AUTOSAVE_KEY, ' '.repeat(MAX_DOCUMENT_BYTES + 1))
  const parse = t.mock.method(JSON, 'parse', () => { throw new Error('Oversized input must not be parsed') })
  store.initEditor(createDocument('Fallback'))
  assert.equal(parse.mock.callCount(), 0)
  assert.equal(store.document?.name, 'Fallback')
  assert.equal(store.fileMessage?.kind, 'error')
})

test('blocked storage reads do not prevent editor initialization', (t) => {
  const { store, storage } = setup(t, false)
  storage.failRead = true
  assert.doesNotThrow(() => store.initEditor(createDocument('Fallback')))
  assert.equal(store.document?.name, 'Fallback')
  assert.equal(store.fileMessage?.kind, 'error')
})

test('FileReader error resolves with feedback and leaves the current document unchanged', async (t) => {
  const { store } = setup(t)
  const original = store.document
  const opening = store.openProject(projectFile())
  latestReader().fail()
  const result = await opening
  assert.equal(result.ok, false)
  assert.match(result.error!, /读取失败/)
  assert.equal(store.document, original)
  assert.equal(store.fileMessage?.kind, 'error')
})

test('FileReader abort always settles the open promise without replacing the document', async (t) => {
  const { store } = setup(t)
  const opening = store.openProject(projectFile())
  latestReader().abort()
  const result = await opening
  assert.equal(result.ok, false)
  assert.equal(result.cancelled, true)
  assert.equal(store.document?.name, 'Original')
})

test('FileReader construction and readAsText synchronous exceptions resolve as failures', async (t) => {
  const { store } = setup(t)
  FileReaderStub.throwOnConstruct = true
  assert.equal((await store.openProject(projectFile())).ok, false)
  FileReaderStub.throwOnConstruct = false
  FileReaderStub.throwOnRead = true
  assert.equal((await store.openProject(projectFile())).ok, false)
  assert.equal(store.document?.name, 'Original')
  assert.equal(store.fileMessage?.kind, 'error')
})

test('oversized files are rejected before creating a FileReader; the exact limit is allowed', async (t) => {
  const { store } = setup(t)
  const result = await store.openProject(projectFile('Too big', MAX_DOCUMENT_BYTES + 1))
  assert.equal(result.ok, false)
  assert.match(result.error!, /过大|超过/)
  assert.equal(FileReaderStub.instances.length, 0)
  assert.equal(store.document?.name, 'Original')
  const allowed = store.openProject(projectFile('At limit', MAX_DOCUMENT_BYTES))
  latestReader().load(JSON.stringify(createDocument('At limit')))
  assert.equal((await allowed).ok, true)
  assert.equal(store.document?.name, 'At limit')
})

test('malformed project input preserves the document and publishes parser errors', async (t) => {
  const { store } = setup(t)
  const opening = store.openProject(projectFile())
  latestReader().load('{ broken json')
  assert.equal((await opening).ok, false)
  assert.equal(store.document?.name, 'Original')
  assert.equal(store.fileMessage?.kind, 'error')
  assert.match(store.fileMessage!.text, /JSON/)
})

test('a newer open wins even if an older read cannot abort and calls its stale load handler', async (t) => {
  const { store } = setup(t)
  const first = store.openProject(projectFile('Old'))
  const oldReader = latestReader()
  const staleLoad = oldReader.onload!
  FileReaderStub.throwOnAbort = true
  const second = store.openProject(projectFile('New'))
  assert.equal((await first).cancelled, true)
  assert.equal(oldReader.abortCalls, 1)
  latestReader().load(JSON.stringify(createDocument('New')))
  assert.equal((await second).ok, true)
  oldReader.result = JSON.stringify(createDocument('Old'))
  staleLoad()
  assert.equal(store.document?.name, 'New')
  assert.equal(store.fileMessage?.text, '项目已打开')
})

test('a rejected newer open still invalidates an older in-flight read', async (t) => {
  const { store } = setup(t)
  const first = store.openProject(projectFile('Old'))
  const oldReader = latestReader()
  const staleLoad = oldReader.onload!
  const second = await store.openProject(projectFile('Too big', MAX_DOCUMENT_BYTES + 1))
  assert.equal(second.ok, false)
  assert.equal((await first).cancelled, true)
  oldReader.result = JSON.stringify(createDocument('Old'))
  staleLoad()
  assert.equal(store.document?.name, 'Original')
  assert.match(store.fileMessage!.text, /过大|超过/)
})

test('newProject and direct document replacement invalidate any pending file read', async (t) => {
  const { store } = setup(t)
  for (const replace of [
    () => store.newProject(),
    () => store.applyLoadedDocument(createDocument('Direct replacement')),
  ]) {
    const opening = store.openProject(projectFile('Stale'))
    const oldReader = latestReader()
    const staleLoad = oldReader.onload!
    replace()
    const replacement = store.document
    assert.equal((await opening).cancelled, true)
    oldReader.result = JSON.stringify(createDocument('Stale'))
    staleLoad()
    assert.equal(store.document, replacement)
  }
})

test('keyboard/menu file requests publish open errors and clean up input handlers', async (t) => {
  const { store, inputs } = setup(t)
  store.editor!.onOpenRequest!()
  const input = inputs[0]!
  input.files = [projectFile()]
  input.value = 'selected.rail.json'
  input.onchange!()
  latestReader().fail()
  await Promise.resolve()
  assert.equal(store.fileMessage?.kind, 'error')
  assert.match(store.fileMessage!.text, /读取失败/)
  assert.equal(input.value, '')
  assert.equal(input.onchange, null)
  assert.equal(input.oncancel, null)
})

test('picker cancellation and stale selection events never start an obsolete open', (t) => {
  const { store, inputs } = setup(t)
  store.requestOpenFile()
  inputs[0]!.oncancel!()
  assert.equal(inputs[0]!.onchange, null)
  store.requestOpenFile()
  const input = inputs[1]!
  const staleChange = input.onchange!
  store.newProject()
  input.files = [projectFile('Obsolete')]
  staleChange()
  assert.equal(FileReaderStub.instances.length, 0)
  assert.equal(store.document?.name, '未命名项目')
})

test('picker synchronous failures become visible errors rather than uncaught exceptions', (t) => {
  const { store, dom, inputs } = setup(t)
  dom.throwOnClick = true
  assert.doesNotThrow(() => store.requestOpenFile())
  assert.equal(store.fileMessage?.kind, 'error')
  assert.equal(inputs[0]!.onchange, null)
  assert.equal(inputs[0]!.oncancel, null)
})

test('export reports download failure and never hides an autosave error', (t) => {
  const { store, storage, downloads, revoked, dom } = setup(t)
  storage.failWrite = true
  store.updateDocumentName('Export:/name')
  assert.equal(store.persistDocument(), false)
  assert.equal(store.saveProject(), true)
  assert.equal(downloads[0]!.download, 'Export__name.rail.json')
  assert.equal(store.saveState, 'error')
  assert.equal(store.fileMessage?.kind, 'info')
  t.mock.timers.tick(500)
  assert.equal(revoked.length, 1)
  dom.throwOnDownload = true
  assert.equal(store.saveProject(), false)
  assert.equal(store.fileMessage?.kind, 'error')
  assert.equal(store.saveState, 'error')
  assert.equal(revoked.length, 2, 'a failed download releases its object URL immediately')
})

test('scope disposal clears timers/listeners, releases download URLs, and cancels reads', async (t) => {
  const { store, storage, window, revoked } = setup(t)
  store.updateDocumentName('Pending edit')
  assert.equal(store.saveProject(), true)
  const opening = store.openProject(projectFile('Late'))
  const reader = latestReader()
  const staleLoad = reader.onload!
  assert.equal(window.listeners.get('beforeunload')?.size, 1)
  store.$dispose()
  assert.equal((await opening).cancelled, true)
  assert.equal(window.listeners.get('beforeunload')?.size, 0)
  assert.equal(revoked.length, 1)
  reader.result = JSON.stringify(createDocument('Late'))
  staleLoad()
  window.dispatch('beforeunload')
  store.editor!.markDirty()
  t.mock.timers.tick(5000)
  assert.equal(storage.writes, 0)
  assert.equal(store.document?.name, 'Pending edit')
  assert.equal(revoked.length, 1)
})

test('scope disposal also removes outstanding file-picker handlers', (t) => {
  const { store, inputs } = setup(t)
  store.requestOpenFile()
  store.$dispose()
  assert.equal(inputs[0]!.onchange, null)
  assert.equal(inputs[0]!.oncancel, null)
})

test('updateCanvasGridSize rejects NaN and infinities while keeping finite clamping', (t) => {
  const { store, storage } = setup(t)
  const original = store.document!.canvas.gridSize
  const version = store.version
  for (const value of [NaN, Infinity, -Infinity]) store.updateCanvasGridSize(value)
  assert.equal(store.document!.canvas.gridSize, original)
  assert.equal(store.version, version)
  t.mock.timers.tick(500)
  assert.equal(storage.writes, 0)
  store.updateCanvasGridSize(0)
  assert.equal(store.document!.canvas.gridSize, 1)
  store.updateCanvasGridSize(12.5)
  assert.equal(store.document!.canvas.gridSize, 12.5)
})

test('editor changes synchronize the active layer exposed by the store', (t) => {
  const { store } = setup(t)
  store.editor!.state.activeLayerId = 'changed-by-history'
  store.editor!.markDirty()
  assert.equal(store.activeLayerId, 'changed-by-history')
})
