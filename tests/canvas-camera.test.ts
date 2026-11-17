import assert from 'node:assert/strict'
import test from 'node:test'
import type { Editor } from 'tldraw'
import { boundsOverlap, canvasContentIsVisible, focusCanvasContent } from '@/lib/canvas-camera'

test('detects when saved canvas content is outside the viewport', () => {
  assert.equal(
    boundsOverlap(
      { minX: -3400, maxX: -800, minY: -900, maxY: 400 },
      { minX: 0, maxX: 3000, minY: 0, maxY: 1800 }
    ),
    false
  )

  const editor = {
    getCurrentPageBounds: () => ({ minX: -3400, maxX: -800, minY: -900, maxY: 400 }),
    getViewportPageBounds: () => ({ minX: 0, maxX: 3000, minY: 0, maxY: 1800 }),
  } as unknown as Editor
  assert.equal(canvasContentIsVisible(editor), false)
})

test('forces the camera to the saved board bounds after hydration', () => {
  const calls: Array<{ name: string; value?: unknown }> = []
  const container = { getBoundingClientRect: () => ({ width: 1200, height: 800 }) }
  const bounds = { minX: -3400, maxX: -800, minY: -900, maxY: 400 }
  const editor = {
    getContainer: () => container,
    updateViewportScreenBounds: (value: unknown) => calls.push({ name: 'viewport', value }),
    getCurrentPageBounds: () => bounds,
    stopCameraAnimation: () => calls.push({ name: 'stop' }),
    zoomToBounds: (value: unknown, options: unknown) => calls.push({ name: 'zoom', value: { value, options } }),
  } as unknown as Editor

  assert.equal(focusCanvasContent(editor), true)
  assert.deepEqual(calls.map((call) => call.name), ['viewport', 'stop', 'zoom'])
  assert.deepEqual((calls[2].value as { options: unknown }).options, {
    force: true,
    immediate: true,
    inset: 96,
  })
})
