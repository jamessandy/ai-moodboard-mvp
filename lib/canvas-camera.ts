export type CanvasPoint = { x: number; y: number }
export type CanvasCamera = { x: number; y: number; zoom: number }
export type CanvasViewport = { width: number; height: number }
export type CanvasBounds = { minX: number; minY: number; maxX: number; maxY: number }

export const MIN_CANVAS_ZOOM = 0.1
export const MAX_CANVAS_ZOOM = 8

function finite(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback
}

export function clampZoom(value: number, min = MIN_CANVAS_ZOOM, max = MAX_CANVAS_ZOOM) {
  const safeMin = Math.max(0.001, finite(min, MIN_CANVAS_ZOOM))
  const safeMax = Math.max(safeMin, finite(max, MAX_CANVAS_ZOOM))
  return Math.min(safeMax, Math.max(safeMin, finite(value, 1)))
}

export function sanitizeCamera(camera: Partial<CanvasCamera> | null | undefined): CanvasCamera {
  return { x: finite(camera?.x ?? 0, 0), y: finite(camera?.y ?? 0, 0), zoom: clampZoom(camera?.zoom ?? 1) }
}

export function panCamera(camera: CanvasCamera, dx: number, dy: number): CanvasCamera {
  const safe = sanitizeCamera(camera)
  return { ...safe, x: safe.x + finite(dx, 0), y: safe.y + finite(dy, 0) }
}

export function zoomCameraAt(camera: CanvasCamera, nextZoom: number, screenPoint: CanvasPoint): CanvasCamera {
  const safe = sanitizeCamera(camera)
  const zoom = clampZoom(nextZoom)
  const point = { x: finite(screenPoint.x, 0), y: finite(screenPoint.y, 0) }
  const worldX = (point.x - safe.x) / safe.zoom
  const worldY = (point.y - safe.y) / safe.zoom
  return { x: point.x - worldX * zoom, y: point.y - worldY * zoom, zoom }
}

export function screenToCanvas(point: CanvasPoint, camera: CanvasCamera): CanvasPoint {
  const safe = sanitizeCamera(camera)
  return { x: (finite(point.x, 0) - safe.x) / safe.zoom, y: (finite(point.y, 0) - safe.y) / safe.zoom }
}

export function canvasToScreen(point: CanvasPoint, camera: CanvasCamera): CanvasPoint {
  const safe = sanitizeCamera(camera)
  return { x: finite(point.x, 0) * safe.zoom + safe.x, y: finite(point.y, 0) * safe.zoom + safe.y }
}

export function dragDeltaToCanvas(dx: number, dy: number, zoom: number): CanvasPoint {
  const safeZoom = clampZoom(zoom)
  return { x: finite(dx, 0) / safeZoom, y: finite(dy, 0) / safeZoom }
}

export function boundsOverlap(first: CanvasBounds, second: CanvasBounds) {
  const values = [first?.minX, first?.maxX, first?.minY, first?.maxY, second?.minX, second?.maxX, second?.minY, second?.maxY]
  if (values.some((value) => !Number.isFinite(value))) return false
  return !(first.maxX < second.minX || first.minX > second.maxX || first.maxY < second.minY || first.minY > second.maxY)
}

export function fitToBounds(
  bounds: CanvasBounds | null | undefined,
  viewport: CanvasViewport,
  padding = 64,
  minZoom = 0.1,
  maxZoom = 2
): CanvasCamera {
  const width = finite(viewport.width, 0)
  const height = finite(viewport.height, 0)
  if (!bounds || width <= 0 || height <= 0) return { x: 0, y: 0, zoom: 1 }
  const contentWidth = finite(bounds.maxX - bounds.minX, 0)
  const contentHeight = finite(bounds.maxY - bounds.minY, 0)
  if (contentWidth <= 0 || contentHeight <= 0) return { x: width / 2, y: height / 2, zoom: 1 }
  const safePadding = Math.max(0, finite(padding, 64))
  const availableWidth = Math.max(1, width - safePadding * 2)
  const availableHeight = Math.max(1, height - safePadding * 2)
  const zoom = clampZoom(Math.min(availableWidth / contentWidth, availableHeight / contentHeight), minZoom, maxZoom)
  return sanitizeCamera({
    x: (width - contentWidth * zoom) / 2 - bounds.minX * zoom,
    y: (height - contentHeight * zoom) / 2 - bounds.minY * zoom,
    zoom,
  })
}

export function viewportCanvasBounds(camera: CanvasCamera, viewport: CanvasViewport): CanvasBounds {
  const topLeft = screenToCanvas({ x: 0, y: 0 }, camera)
  const bottomRight = screenToCanvas({ x: Math.max(0, finite(viewport.width, 0)), y: Math.max(0, finite(viewport.height, 0)) }, camera)
  return {
    minX: Math.min(topLeft.x, bottomRight.x), minY: Math.min(topLeft.y, bottomRight.y),
    maxX: Math.max(topLeft.x, bottomRight.x), maxY: Math.max(topLeft.y, bottomRight.y),
  }
}
