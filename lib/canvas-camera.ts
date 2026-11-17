import type { Editor } from 'tldraw'

type BoundsLike = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export function boundsOverlap(first: BoundsLike, second: BoundsLike) {
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
  return boundsOverlap(content, editor.getViewportPageBounds())
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

  editor.stopCameraAnimation()
  editor.zoomToBounds(bounds, {
    force: true,
    immediate: duration === 0,
    inset: Math.min(96, Math.max(32, rect.width * 0.08)),
    ...(duration > 0 ? { animation: { duration } } : {}),
  })
  return true
}
