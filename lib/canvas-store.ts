import {
  CanvasBounds, CanvasCamera, CanvasPoint, canvasToScreen, fitToBounds, panCamera,
  sanitizeCamera, screenToCanvas, viewportCanvasBounds, zoomCameraAt,
} from '@/lib/canvas-camera'

export type CanvasNodeProps = Record<string, unknown>
export type CanvasNode = {
  id: string; type: string; x: number; y: number; w: number; h: number; z: number
  rotation: number; opacity: number; props: CanvasNodeProps
}
export type NativeCanvasDocument = { version: 1; nodes: CanvasNode[] }
export type CanvasShapeInput = {
  id?: string; type: string; x?: number; y?: number; props?: CanvasNodeProps
  w?: number; h?: number; rotation?: number; opacity?: number
}
export type CanvasShapeUpdate = {
  id: string; type?: string; x?: number; y?: number; w?: number; h?: number
  rotation?: number; opacity?: number; props?: CanvasNodeProps
}
type ViewportRect = { left: number; top: number; width: number; height: number }
type Listener = () => void
const EMPTY_DOCUMENT: NativeCanvasDocument = { version: 1, nodes: [] }

function finite(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
function defaultSize(type: string) {
  if (type === 'comment-pin') return { w: 28, h: 28 }
  if (type === 'swatch') return { w: 220, h: 92 }
  if (type === 'type-sample') return { w: 320, h: 96 }
  if (type === 'moodboard-note' || type === 'note' || type === 'text') return { w: 240, h: 150 }
  return { w: 280, h: 220 }
}
function cloneNode(node: CanvasNode): CanvasNode { return { ...node, props: structuredClone(node.props) } }
function cloneDocument(document: NativeCanvasDocument): NativeCanvasDocument { return { version: 1, nodes: document.nodes.map(cloneNode) } }
function documentChanged(first: NativeCanvasDocument, second: NativeCanvasDocument) { return JSON.stringify(first) !== JSON.stringify(second) }
export function createCanvasId(prefix = 'node') {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `${prefix}:${id}`
}
export function emptyCanvasDocument(): NativeCanvasDocument { return cloneDocument(EMPTY_DOCUMENT) }
export function getNodesBounds(nodes: CanvasNode[]): CanvasBounds | null {
  if (!nodes.length) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const node of nodes) {
    if (![node.x, node.y, node.w, node.h].every(Number.isFinite)) continue
    minX = Math.min(minX, node.x); minY = Math.min(minY, node.y)
    maxX = Math.max(maxX, node.x + Math.max(1, node.w)); maxY = Math.max(maxY, node.y + Math.max(1, node.h))
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null
}

export class CanvasStore {
  private document: NativeCanvasDocument
  private camera: CanvasCamera = { x: 0, y: 0, zoom: 1 }
  private viewport: ViewportRect = { left: 0, top: 0, width: 1, height: 1 }
  private selectedIds = new Set<string>()
  private documentListeners = new Set<Listener>()
  private sessionListeners = new Set<Listener>()
  private listeners = new Set<Listener>()
  private revision = 0
  private undoStack: NativeCanvasDocument[] = []
  private redoStack: NativeCanvasDocument[] = []
  private transactionDepth = 0
  private transactionBefore: NativeCanvasDocument | null = null

  constructor(document: NativeCanvasDocument = EMPTY_DOCUMENT) { this.document = cloneDocument(document) }
  subscribe = (listener: Listener) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  subscribeDocument = (listener: Listener) => { this.documentListeners.add(listener); return () => this.documentListeners.delete(listener) }
  subscribeSession = (listener: Listener) => { this.sessionListeners.add(listener); return () => this.sessionListeners.delete(listener) }
  getRevision = () => this.revision
  private emitDocument() { this.revision++; this.documentListeners.forEach((fn) => fn()); this.listeners.forEach((fn) => fn()) }
  private emitSession() { this.revision++; this.sessionListeners.forEach((fn) => fn()); this.listeners.forEach((fn) => fn()) }
  private mutate(mutator: () => void, recordHistory = true) {
    const before = recordHistory && this.transactionDepth === 0 ? this.getSnapshot() : null
    mutator()
    if (before) { this.undoStack.push(before); this.redoStack = [] }
    this.emitDocument()
  }
  run(action: () => void) { this.beginInteraction(); try { action() } finally { this.endInteraction() } }
  beginInteraction() { if (this.transactionDepth === 0) this.transactionBefore = this.getSnapshot(); this.transactionDepth++ }
  endInteraction() {
    if (this.transactionDepth === 0) return
    this.transactionDepth--
    if (this.transactionDepth > 0) return
    const before = this.transactionBefore; this.transactionBefore = null
    if (before && documentChanged(before, this.document)) { this.undoStack.push(before); this.redoStack = [] }
  }
  getSnapshot() { return cloneDocument(this.document) }
  loadSnapshot(document: NativeCanvasDocument) {
    this.document = cloneDocument(document); this.selectedIds.clear(); this.undoStack = []; this.redoStack = []
    this.emitDocument(); this.emitSession()
  }
  getCurrentPageShapes() { return this.document.nodes.map(cloneNode).sort((a, b) => a.z - b.z) }
  getNode(id: string) { const node = this.document.nodes.find((item) => item.id === id); return node ? cloneNode(node) : undefined }
  createShape(input: CanvasShapeInput) {
    const props = { ...(input.props ?? {}) }; const defaults = defaultSize(input.type)
    const w = Math.max(24, finite(input.w ?? props.w, defaults.w)); const h = Math.max(24, finite(input.h ?? props.h, defaults.h))
    const nextZ = this.document.nodes.reduce((max, node) => Math.max(max, node.z), 0) + 1
    const node: CanvasNode = {
      id: input.id ?? createCanvasId('shape'), type: input.type === 'note' ? 'moodboard-note' : input.type,
      x: finite(input.x, 0), y: finite(input.y, 0), w, h, z: nextZ,
      rotation: finite(input.rotation, 0), opacity: Math.min(1, Math.max(0, finite(input.opacity, 1))), props: { ...props, w, h },
    }
    this.mutate(() => this.document.nodes.push(node), this.transactionDepth === 0)
    return node.id
  }
  updateShape(update: CanvasShapeUpdate, recordHistory = true) {
    this.mutate(() => {
      const index = this.document.nodes.findIndex((node) => node.id === update.id); if (index < 0) return
      const current = this.document.nodes[index]
      const w = Math.max(24, finite(update.w ?? update.props?.w, current.w)); const h = Math.max(24, finite(update.h ?? update.props?.h, current.h))
      this.document.nodes[index] = {
        ...current, ...(update.type ? { type: update.type } : {}), x: finite(update.x, current.x), y: finite(update.y, current.y),
        w, h, rotation: finite(update.rotation, current.rotation), opacity: Math.min(1, Math.max(0, finite(update.opacity, current.opacity))),
        props: update.props ? { ...current.props, ...update.props, w, h } : current.props,
      }
    }, recordHistory && this.transactionDepth === 0)
  }
  updateNodes(updates: CanvasShapeUpdate[], recordHistory = true) {
    this.mutate(() => {
      for (const update of updates) {
        const index = this.document.nodes.findIndex((node) => node.id === update.id); if (index < 0) continue
        const current = this.document.nodes[index]
        const w = Math.max(24, finite(update.w ?? update.props?.w, current.w)); const h = Math.max(24, finite(update.h ?? update.props?.h, current.h))
        this.document.nodes[index] = { ...current, x: finite(update.x, current.x), y: finite(update.y, current.y), w, h,
          props: update.props ? { ...current.props, ...update.props, w, h } : { ...current.props, w, h } }
      }
    }, recordHistory && this.transactionDepth === 0)
  }
  deleteShapes(ids: string[]) {
    const set = new Set(ids)
    this.mutate(() => { this.document.nodes = this.document.nodes.filter((node) => !set.has(node.id)); ids.forEach((id) => this.selectedIds.delete(id)) })
    this.emitSession()
  }
  deleteSelected() { this.deleteShapes([...this.selectedIds]) }
  bringToFront(ids: string[]) {
    if (!ids.length) return
    const set = new Set(ids)
    this.mutate(() => { let z = this.document.nodes.reduce((max, node) => Math.max(max, node.z), 0); for (const node of this.document.nodes.filter((item) => set.has(item.id))) node.z = ++z })
  }
  setSelectedShapes(ids: string[]) { this.selectedIds = new Set(ids.filter((id) => this.document.nodes.some((node) => node.id === id))); this.emitSession() }
  toggleSelectedShape(id: string) { if (this.selectedIds.has(id)) this.selectedIds.delete(id); else this.selectedIds.add(id); this.emitSession() }
  getSelectedShapeIds() { return [...this.selectedIds] }
  isSelected(id: string) { return this.selectedIds.has(id) }
  undo() { const previous = this.undoStack.pop(); if (!previous) return; this.redoStack.push(this.getSnapshot()); this.document = cloneDocument(previous); this.selectedIds.clear(); this.emitDocument(); this.emitSession() }
  redo() { const next = this.redoStack.pop(); if (!next) return; this.undoStack.push(this.getSnapshot()); this.document = cloneDocument(next); this.selectedIds.clear(); this.emitDocument(); this.emitSession() }
  setViewport(rect: ViewportRect) {
    const next = { left: finite(rect.left, 0), top: finite(rect.top, 0), width: Math.max(1, finite(rect.width, 1)), height: Math.max(1, finite(rect.height, 1)) }
    if (JSON.stringify(next) === JSON.stringify(this.viewport)) return
    this.viewport = next; this.emitSession()
  }
  getViewportRect() { return { ...this.viewport } }
  getCamera() { return { x: this.camera.x, y: this.camera.y, z: this.camera.zoom } }
  getCameraState() { return { ...this.camera } }
  setCamera(camera: Partial<CanvasCamera> & { z?: number }) {
    this.camera = sanitizeCamera({ x: camera.x ?? this.camera.x, y: camera.y ?? this.camera.y, zoom: camera.zoom ?? camera.z ?? this.camera.zoom }); this.emitSession()
  }
  panBy(dx: number, dy: number) { this.camera = panCamera(this.camera, dx, dy); this.emitSession() }
  zoomAtScreenPoint(nextZoom: number, point: CanvasPoint) { this.camera = zoomCameraAt(this.camera, nextZoom, point); this.emitSession() }
  zoomIn() { this.zoomAtScreenPoint(this.camera.zoom * 1.2, this.getViewportScreenCenter()) }
  zoomOut() { this.zoomAtScreenPoint(this.camera.zoom / 1.2, this.getViewportScreenCenter()) }
  getZoomLevel() { return this.camera.zoom }
  getViewportScreenCenter() { return { x: this.viewport.width / 2, y: this.viewport.height / 2 } }
  screenToPage(point: CanvasPoint) { return screenToCanvas({ x: point.x - this.viewport.left, y: point.y - this.viewport.top }, this.camera) }
  pageToScreen(point: CanvasPoint) { const local = canvasToScreen(point, this.camera); return { x: local.x + this.viewport.left, y: local.y + this.viewport.top } }
  getViewportPageBounds() {
    const bounds = viewportCanvasBounds(this.camera, this.viewport)
    return { x: bounds.minX, y: bounds.minY, w: bounds.maxX - bounds.minX, h: bounds.maxY - bounds.minY,
      minX: bounds.minX, minY: bounds.minY, maxX: bounds.maxX, maxY: bounds.maxY,
      center: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 } }
  }
  getCurrentPageBounds() { const bounds = getNodesBounds(this.document.nodes); return bounds ? { ...bounds, w: bounds.maxX - bounds.minX, h: bounds.maxY - bounds.minY } : null }
  fitToContent(padding = 72) { this.camera = fitToBounds(getNodesBounds(this.document.nodes), this.viewport, padding, 0.1, 2); this.emitSession() }
  zoomToSelection() { const selected = this.document.nodes.filter((node) => this.selectedIds.has(node.id)); this.camera = fitToBounds(getNodesBounds(selected), this.viewport, 96, 0.1, 2); this.emitSession() }
  resetZoom() { this.camera = { x: 0, y: 0, zoom: 1 }; this.emitSession() }
  createAssets() { /* Native nodes store URLs directly. */ }
}

export type CanvasController = CanvasStore
export function listenToCanvasChanges(store: CanvasStore, handlers: { onDocumentChange: () => void; onSessionChange: () => void }) {
  const offDocument = store.subscribeDocument(handlers.onDocumentChange); const offSession = store.subscribeSession(handlers.onSessionChange)
  return () => { offDocument(); offSession() }
}
export function createCanvasStore(document?: NativeCanvasDocument) { return new CanvasStore(document) }
