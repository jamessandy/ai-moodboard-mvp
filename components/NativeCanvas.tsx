'use client'

import { KeyboardEvent, PointerEvent, WheelEvent, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { boundsOverlap } from '@/lib/canvas-camera'
import { CanvasStore } from '@/lib/canvas-store'
import { CanvasNodeView } from '@/components/moodboardShapes'

type Marquee = { startX: number; startY: number; x: number; y: number; w: number; h: number }

type NativeCanvasProps = {
  store: CanvasStore
  readOnly?: boolean
  theme?: 'light' | 'dark'
  showResolvedComments?: boolean
  commentMode?: boolean
  onDropComment?: (point: { x: number; y: number }) => void
  onReady?: (store: CanvasStore) => void
  className?: string
}

export function NativeCanvas({
  store,
  readOnly = false,
  theme = 'light',
  showResolvedComments = true,
  commentMode = false,
  onDropComment,
  onReady,
  className = '',
}: NativeCanvasProps) {
  useSyncExternalStore(store.subscribe, store.getRevision, store.getRevision)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [spaceDown, setSpaceDown] = useState(false)
  const [marquee, setMarquee] = useState<Marquee | null>(null)
  const camera = store.getCameraState()
  const nodes = store.getCurrentPageShapes()

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    let fitted = false
    const update = () => {
      const rect = viewport.getBoundingClientRect()
      store.setViewport({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
      if (!fitted && rect.width >= 100 && rect.height >= 100) {
        fitted = true
        store.fitToContent()
        onReady?.(store)
      }
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(viewport)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [onReady, store])

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    store.zoomAtScreenPoint(store.getZoomLevel() * Math.exp(-event.deltaY * 0.0015), point)
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const panGesture = readOnly || event.button === 1 || spaceDown
    if (!panGesture && event.target !== event.currentTarget && event.target !== event.currentTarget.firstElementChild) return
    event.currentTarget.focus()
    if (commentMode && event.button === 0 && !readOnly) {
      onDropComment?.({ x: event.clientX, y: event.clientY })
      return
    }

    const rect = event.currentTarget.getBoundingClientRect()
    const startX = event.clientX - rect.left
    const startY = event.clientY - rect.top
    if (event.shiftKey && event.button === 0 && !readOnly) {
      event.preventDefault()
      setMarquee({ startX, startY, x: startX, y: startY, w: 0, h: 0 })
      const move = (moveEvent: globalThis.PointerEvent) => {
        const x = moveEvent.clientX - rect.left
        const y = moveEvent.clientY - rect.top
        setMarquee({ startX, startY, x: Math.min(startX, x), y: Math.min(startY, y), w: Math.abs(x - startX), h: Math.abs(y - startY) })
      }
      const up = (upEvent: globalThis.PointerEvent) => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        const endX = upEvent.clientX - rect.left
        const endY = upEvent.clientY - rect.top
        const first = store.screenToPage({ x: Math.min(startX, endX) + rect.left, y: Math.min(startY, endY) + rect.top })
        const second = store.screenToPage({ x: Math.max(startX, endX) + rect.left, y: Math.max(startY, endY) + rect.top })
        const selection = store.getCurrentPageShapes().filter((node) => boundsOverlap(
          { minX: node.x, minY: node.y, maxX: node.x + node.w, maxY: node.y + node.h },
          { minX: first.x, minY: first.y, maxX: second.x, maxY: second.y }
        )).map((node) => node.id)
        store.setSelectedShapes(selection)
        setMarquee(null)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up, { once: true })
      return
    }

    if (event.button !== 0 && event.button !== 1 && !spaceDown) return
    event.preventDefault()
    if (!readOnly) store.setSelectedShapes([])
    const start = { x: event.clientX, y: event.clientY }
    const initial = store.getCameraState()
    const move = (moveEvent: globalThis.PointerEvent) => {
      store.setCamera({ x: initial.x + moveEvent.clientX - start.x, y: initial.y + moveEvent.clientY - start.y, zoom: initial.zoom })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === ' ') {
      event.preventDefault()
      setSpaceDown(true)
      return
    }
    if (readOnly) return
    if (event.key === 'Backspace' || event.key === 'Delete') {
      const target = event.target as HTMLElement
      if (target.matches('input, textarea, [contenteditable="true"]')) return
      event.preventDefault()
      store.deleteSelected()
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) store.redo()
      else store.undo()
    }
  }

  return (
    <div ref={viewportRef} tabIndex={0} role="application" aria-label="Moodboard canvas"
      className={`native-canvas-viewport relative h-full w-full overflow-hidden outline-none ${theme === 'dark' ? 'canvas-dark' : 'canvas-light'} ${commentMode ? 'cursor-crosshair' : spaceDown ? 'cursor-grabbing' : 'cursor-grab'} ${className}`}
      onPointerDownCapture={() => viewportRef.current?.focus({ preventScroll: true })}
      onWheel={handleWheel} onPointerDown={handlePointerDown} onKeyDown={handleKeyDown}
      onKeyUp={(event) => { if (event.key === ' ') setSpaceDown(false) }} onBlur={() => setSpaceDown(false)}
      onContextMenu={(event) => event.preventDefault()}>
      <div className="native-canvas-world absolute left-0 top-0 h-0 w-0"
        style={{ transform: `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.zoom})`, transformOrigin: '0 0', willChange: 'transform' }}>
        {nodes.map((node) => <CanvasNodeView key={node.id} node={node} store={store} readOnly={readOnly} panMode={spaceDown} showResolvedComments={showResolvedComments} />)}
      </div>
      {marquee ? <div className="pointer-events-none absolute border border-[#0F0C59] bg-[#0F0C59]/10" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} /> : null}
      {!nodes.length ? <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><div className="rounded-full border border-slate-200 bg-white/80 px-4 py-2 font-mono text-[11px] font-semibold text-slate-500 shadow-sm">Drop references here to begin</div></div> : null}
    </div>
  )
}
