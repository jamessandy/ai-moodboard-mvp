import assert from 'node:assert/strict'
import test from 'node:test'
import { createCanvasStore, listenToCanvasChanges } from '@/lib/canvas-store'

test('keeps camera session changes out of the document autosave listener', () => {
  const store = createCanvasStore()
  let documentChanges = 0
  let sessionChanges = 0
  const unlisten = listenToCanvasChanges(store, {
    onDocumentChange: () => documentChanges++,
    onSessionChange: () => sessionChanges++,
  })

  store.setViewport({ left: 0, top: 0, width: 1200, height: 800 })
  store.zoomAtScreenPoint(1.5, { x: 600, y: 400 })
  assert.equal(documentChanges, 0)
  assert.equal(sessionChanges, 2)

  store.createShape({ type: 'moodboard-note', x: 40, y: 20, props: { text: 'Ready immediately' } })
  assert.equal(documentChanges, 1)
  assert.equal(sessionChanges, 2)
  unlisten()
  store.createShape({ type: 'swatch', props: { colors: ['#ffffff'] } })
  assert.equal(documentChanges, 1)
})

test('creates, selects, layers, and deletes nodes synchronously', () => {
  const store = createCanvasStore()
  const first = store.createShape({ type: 'moodboard-note', x: 10, y: 20 })
  const second = store.createShape({ type: 'swatch', x: 30, y: 40 })
  store.setSelectedShapes([first, second])
  store.bringToFront([first])

  assert.deepEqual(store.getSelectedShapeIds(), [first, second])
  assert.ok((store.getNode(first)?.z ?? 0) > (store.getNode(second)?.z ?? 0))
  store.deleteSelected()
  assert.equal(store.getCurrentPageShapes().length, 0)
})

test('coalesces pointer movement into one undo step', () => {
  const store = createCanvasStore()
  const id = store.createShape({ type: 'moodboard-note', x: 0, y: 0 })
  store.beginInteraction()
  store.updateShape({ id, x: 40, y: 20 }, false)
  store.updateShape({ id, x: 80, y: 50 }, false)
  store.endInteraction()
  assert.deepEqual({ x: store.getNode(id)?.x, y: store.getNode(id)?.y }, { x: 80, y: 50 })

  store.undo()
  assert.deepEqual({ x: store.getNode(id)?.x, y: store.getNode(id)?.y }, { x: 0, y: 0 })
  store.redo()
  assert.deepEqual({ x: store.getNode(id)?.x, y: store.getNode(id)?.y }, { x: 80, y: 50 })
})
