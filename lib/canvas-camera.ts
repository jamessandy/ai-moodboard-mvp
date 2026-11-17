import type { Editor } from 'tldraw'

type BoundsLike = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export function boundsOverlap(first: BoundsLike, second: BoundsLike) {
  if (
    !first ||
    !second ||
    !Number.isFinite(first.minX) ||
    !Number.isFinite(first.maxX) ||
    !Number.isFinite(first.minY) ||
    !Number.isFinite(first.maxY) ||
    !Number.isFinite(second.minX) ||
    !Number.isFinite(second.maxX) ||
    !Number.isFinite(second.minY) ||
    !Number.isFinite(second.maxY)
  ) {
    return true
  }
  return !(
    first.maxX < second.minX ||
    first.minX > second.maxX ||
    first.maxY < second.minY ||
    first.minY > second.maxY
  )
}

export function canvasContentIsVisible(editor: Editor) {
  const content = editor.getCurrentPageBounds()
  if (!content) return true
  const viewport = editor.getViewportPageBounds()
  if (!viewport) return true
  return boundsOverlap(content, viewport)
}

export function focusCanvasContent(editor: Editor, duration = 0) {
  const container = editor.getContainer()
  const rect = container?.getBoundingClientRect()
  if (!container || !rect || rect.width < 100 || rect.height < 100) return false

  editor.updateViewportScreenBounds(container)
  const bounds = editor.getCurrentPageBounds()
  if (!bounds) {
    editor.resetZoom(editor.getViewportScreenCenter(), { force: true, immediate: duration === 0 })
    return true
  }

  const w = 'w' in bounds && typeof (bounds as { w: number }).w === 'number' ? (bounds as { w: number }).w : bounds.maxX - bounds.minX
  const h = 'h' in bounds && typeof (bounds as { h: number }).h === 'number' ? (bounds as { h: number }).h : bounds.maxY - bounds.minY
  if (w <= 0 || h <= 0) {
    editor.resetZoom(editor.getViewportScreenCenter(), { force: true, immediate: duration === 0 })
    return true
  }

  editor.stopCameraAnimation()
  editor.zoomToBounds(bounds, {
    force: true,
    immediate: duration === 0,
    inset: Math.min(96, Math.max(32, rect.width * 0.08)),
    ...(duration > 0 ? { animation: { duration } } : {}),
  })
  return true
}
