import assert from 'node:assert/strict'
import test from 'node:test'
import {
  boundsOverlap,
  canvasToScreen,
  dragDeltaToCanvas,
  fitToBounds,
  screenToCanvas,
  zoomCameraAt,
} from '@/lib/canvas-camera'

test('detects separated and overlapping canvas bounds', () => {
  assert.equal(boundsOverlap(
    { minX: -3400, maxX: -800, minY: -900, maxY: 400 },
    { minX: 0, maxX: 3000, minY: 0, maxY: 1800 }
  ), false)
  assert.equal(boundsOverlap(
    { minX: 10, maxX: 30, minY: 10, maxY: 30 },
    { minX: 20, maxX: 40, minY: 20, maxY: 40 }
  ), true)
})

test('fits offscreen content into the viewport with finite camera values', () => {
  const camera = fitToBounds(
    { minX: -3400, maxX: -800, minY: -900, maxY: 400 },
    { width: 1200, height: 800 },
    96
  )
  assert.ok(Number.isFinite(camera.x))
  assert.ok(Number.isFinite(camera.y))
  assert.ok(Number.isFinite(camera.zoom))
  assert.ok(camera.zoom > 0)
})

test('guards fit math against zero, NaN, and non-finite dimensions', () => {
  for (const camera of [
    fitToBounds(null, { width: 0, height: 0 }),
    fitToBounds({ minX: 0, minY: 0, maxX: Number.NaN, maxY: Infinity }, { width: 900, height: 600 }),
    fitToBounds({ minX: 2, minY: 2, maxX: 2, maxY: 2 }, { width: 900, height: 600 }),
  ]) {
    assert.ok([camera.x, camera.y, camera.zoom].every(Number.isFinite))
    assert.ok(camera.zoom > 0)
  }
})

test('zoom-to-cursor preserves the world point under the cursor', () => {
  const camera = { x: 120, y: -40, zoom: 0.75 }
  const cursor = { x: 640, y: 360 }
  const before = screenToCanvas(cursor, camera)
  const zoomed = zoomCameraAt(camera, 1.8, cursor)
  const after = screenToCanvas(cursor, zoomed)
  assert.deepEqual(after, before)
  assert.deepEqual(canvasToScreen(before, zoomed), cursor)
})

test('drag deltas are compensated by the active zoom', () => {
  assert.deepEqual(dragDeltaToCanvas(80, -40, 2), { x: 40, y: -20 })
  assert.deepEqual(dragDeltaToCanvas(80, -40, 0.5), { x: 160, y: -80 })
})
