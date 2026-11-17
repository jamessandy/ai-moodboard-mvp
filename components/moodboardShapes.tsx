'use client'

import { PointerEvent as ReactPointerEvent, SyntheticEvent, useState } from 'react'
import { dragDeltaToCanvas } from '@/lib/canvas-camera'
import { CanvasNode, CanvasStore } from '@/lib/canvas-store'
import { TAGS, Tag } from '@/lib/tags'

export type CommentReply = { author: string; text: string; createdAt: string }

type NodeViewProps = {
  node: CanvasNode
  store: CanvasStore
  readOnly?: boolean
  showResolvedComments?: boolean
  panMode?: boolean
}

function text(value: unknown, fallback = '') { return typeof value === 'string' ? value : fallback }
function strings(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [] }

function stop(event: SyntheticEvent) { event.stopPropagation() }

function ToggleChips({ node, store, readOnly }: NodeViewProps) {
  const currentTags = strings(node.props.tags).filter((tag): tag is Tag => (TAGS as readonly string[]).includes(tag))
  if (readOnly) return null
  return (
    <div className="absolute bottom-2 left-2 right-2 flex flex-wrap gap-1" onPointerDown={stop}>
      {TAGS.map((tag) => {
        const active = currentTags.includes(tag)
        return (
          <button key={tag} type="button"
            className={`rounded px-1.5 py-1 text-[10px] font-semibold uppercase leading-none shadow-sm transition ${active ? 'bg-neutral-950 text-white' : 'bg-white/85 text-neutral-700'}`}
            onClick={() => store.updateShape({ id: node.id, props: { tags: active ? currentTags.filter((item) => item !== tag) : [...currentTags, tag] } })}>
            {tag}
          </button>
        )
      })}
    </div>
  )
}

function ImageNode({ node, store, readOnly }: NodeViewProps) {
  const isElement = node.type === 'element'
  const url = text(node.props.url)
  const label = text(node.props.label, isElement ? 'element' : 'reference')
  return (
    <div className={`relative h-full w-full ${isElement ? 'overflow-visible' : 'overflow-hidden rounded border border-neutral-950/15 bg-neutral-100 shadow-sm'}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={label} draggable={false} decoding="async"
        className={`h-full w-full select-none ${isElement ? 'object-contain' : 'object-cover'}`} />
      {!isElement ? <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" /> : null}
      {readOnly ? (
        label ? <div className="absolute left-2 top-2 max-w-[calc(100%-16px)] truncate rounded bg-white/90 px-2 py-1 text-xs font-semibold text-neutral-900 shadow">{label}</div> : null
      ) : (
        <input value={label} placeholder="Reference name" aria-label="Reference name"
          className="absolute left-2 top-2 max-w-[calc(100%-16px)] rounded bg-white/90 px-2 py-1 text-xs font-semibold text-neutral-900 shadow placeholder:text-neutral-400"
          onPointerDown={stop} onChange={(event) => store.updateShape({ id: node.id, props: { label: event.target.value } })} />
      )}
      <ToggleChips node={node} store={store} readOnly={readOnly} />
    </div>
  )
}

function SwatchNode({ node }: NodeViewProps) {
  const colors = strings(node.props.colors)
  return (
    <div className="flex h-full w-full overflow-hidden rounded border border-neutral-950/15 bg-white shadow-sm">
      {colors.map((color, index) => (
        <div key={`${color}-${index}`} className="relative flex-1" style={{ background: color }}>
          <span className="absolute bottom-1 left-1 rounded bg-white/80 px-1 font-mono text-[10px] text-neutral-900">{color}</span>
        </div>
      ))}
    </div>
  )
}

function TypeNode({ node, store, readOnly }: NodeViewProps) {
  const label = text(node.props.label, 'Condensed grotesk / wide tracking')
  return (
    <div className="flex h-full w-full items-center rounded border border-neutral-950 bg-[#f9f4e7] px-5 shadow-sm">
      {readOnly ? <div className="w-full truncate font-mono text-lg font-semibold uppercase text-neutral-950">{label}</div> :
        <input value={label} onPointerDown={stop} onChange={(event) => store.updateShape({ id: node.id, props: { label: event.target.value } })}
          className="w-full bg-transparent font-mono text-lg font-semibold uppercase text-neutral-950 outline-none" />}
    </div>
  )
}

function NoteNode({ node, store, readOnly }: NodeViewProps) {
  const value = text(node.props.text, text(node.props.label, ''))
  return (
    <div className="h-full w-full rounded border border-yellow-700/20 bg-[#fff4a8] p-4 shadow-sm">
      {readOnly ? <p className="m-0 whitespace-pre-wrap text-base font-medium leading-snug text-neutral-900">{value}</p> :
        <textarea value={value} onPointerDown={stop} onChange={(event) => store.updateShape({ id: node.id, props: { text: event.target.value } })}
          className="h-full w-full resize-none bg-transparent text-base font-medium leading-snug text-neutral-900 outline-none" />}
    </div>
  )
}

function drawPath(node: CanvasNode) {
  const segments: unknown[] = Array.isArray(node.props.segments) ? node.props.segments : []
  return segments.map((segment) => {
    if (!segment || typeof segment !== 'object' || !('points' in segment) || !Array.isArray(segment.points)) return ''
    return (segment.points as unknown[]).map((point: unknown, index: number) => {
      if (!point || typeof point !== 'object') return ''
      const x = 'x' in point && typeof point.x === 'number' ? point.x : 0
      const y = 'y' in point && typeof point.y === 'number' ? point.y : 0
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`
    }).join(' ')
  }).join(' ')
}

function LegacyNode({ node }: NodeViewProps) {
  if (node.type === 'draw') {
    const color = text(node.props.color, '#111827')
    return <svg className="h-full w-full overflow-visible" viewBox={`0 0 ${node.w} ${node.h}`}><path d={drawPath(node)} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
  }
  return <div className="flex h-full w-full items-center overflow-hidden rounded border border-slate-300 bg-white/90 p-3 text-sm text-slate-800 shadow-sm">{text(node.props.text, text(node.props.label, node.type))}</div>
}

function CommentPin({ node, store, readOnly, showResolvedComments = true }: NodeViewProps) {
  const [open, setOpen] = useState(!text(node.props.text))
  const [draft, setDraft] = useState(text(node.props.text))
  const [reply, setReply] = useState('')
  const resolved = node.props.resolved === true
  const replies = Array.isArray(node.props.replies) ? node.props.replies.filter((item): item is CommentReply => Boolean(item && typeof item === 'object' && 'text' in item)) : []
  const author = text(node.props.author, 'Anonymous')
  if (resolved && !showResolvedComments) return null
  const update = (props: Record<string, unknown>) => store.updateShape({ id: node.id, props })
  return (
    <div className="comment-pin pointer-events-auto relative h-7 w-7 overflow-visible" data-resolved={resolved ? 'true' : 'false'} onPointerDown={stop} onPointerUp={stop} onClick={stop}>
      <button type="button" className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold shadow ${resolved ? 'border-neutral-400 bg-neutral-200 text-neutral-500' : 'border-white bg-[#0f766e] text-white'}`}
        onClick={() => setOpen((current) => !current)}>{resolved ? 'OK' : replies.length + 1}</button>
      {open ? <div className="absolute left-8 top-0 z-[1000] w-72 rounded border border-neutral-300 bg-white p-3 text-neutral-950 shadow-xl">
        <div className="mb-2 flex items-center justify-between gap-2"><span className="truncate text-xs font-semibold text-neutral-500">{author}</span>
          {!readOnly ? <button type="button" className="rounded border border-neutral-300 px-2 py-1 text-xs font-semibold" onClick={() => update({ resolved: !resolved })}>{resolved ? 'Reopen' : 'Resolve'}</button> : null}</div>
        {text(node.props.text) ? <p className="m-0 whitespace-pre-wrap text-sm leading-snug">{text(node.props.text)}</p> :
          !readOnly ? <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Comment" className="h-20 w-full resize-none rounded border border-neutral-300 px-2 py-1 text-sm outline-none" /> : null}
        {replies.length ? <div className="mt-3 space-y-2 border-t border-neutral-200 pt-2">{replies.map((item) => <div key={`${item.createdAt}-${item.author}`}><div className="text-xs font-semibold text-neutral-500">{item.author}</div><p className="m-0 text-sm">{item.text}</p></div>)}</div> : null}
        {!readOnly && text(node.props.text) ? <div className="mt-3 flex gap-2"><input value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Reply" className="min-w-0 flex-1 rounded border px-2 py-1 text-sm" /><button type="button" disabled={!reply.trim()} className="rounded bg-neutral-950 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50" onClick={() => { const value = reply.trim(); if (!value) return; update({ replies: [...replies, { author, text: value, createdAt: new Date().toISOString() }] }); setReply('') }}>Reply</button></div> : null}
        {!readOnly && !text(node.props.text) ? <button type="button" disabled={!draft.trim()} className="mt-2 h-8 w-full rounded bg-neutral-950 text-xs font-semibold text-white disabled:opacity-50" onClick={() => update({ text: draft.trim() })}>Save comment</button> : null}
      </div> : null}
    </div>
  )
}

type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se'
function ResizeHandle({ corner, onPointerDown }: { corner: ResizeCorner; onPointerDown: (event: ReactPointerEvent) => void }) {
  const position = { nw: '-left-1.5 -top-1.5', ne: '-right-1.5 -top-1.5', sw: '-bottom-1.5 -left-1.5', se: '-bottom-1.5 -right-1.5' }[corner]
  const cursor = { nw: 'cursor-nwse-resize', ne: 'cursor-nesw-resize', sw: 'cursor-nesw-resize', se: 'cursor-nwse-resize' }[corner]
  return <button type="button" aria-label={`Resize ${corner}`} onPointerDown={onPointerDown} className={`absolute z-50 h-3 w-3 rounded-sm border border-white bg-[#0F0C59] shadow ${position} ${cursor}`} />
}

export function CanvasNodeView({ node, store, readOnly = false, showResolvedComments = true, panMode = false }: NodeViewProps) {
  const selected = store.isSelected(node.id)
  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (readOnly || panMode || event.button !== 0) return
    event.stopPropagation(); event.preventDefault()
    if (event.shiftKey) {
      store.toggleSelectedShape(node.id)
      if (!store.isSelected(node.id)) return
    }
    else if (!selected) store.setSelectedShapes([node.id])
    const ids = store.getSelectedShapeIds().includes(node.id) ? store.getSelectedShapeIds() : [node.id]
    store.beginInteraction(); store.bringToFront(ids)
    const start = { x: event.clientX, y: event.clientY }
    const initial = ids.map((id) => store.getNode(id)).filter((item): item is CanvasNode => Boolean(item))
    const move = (moveEvent: PointerEvent) => {
      const delta = dragDeltaToCanvas(moveEvent.clientX - start.x, moveEvent.clientY - start.y, store.getZoomLevel())
      store.updateNodes(initial.map((item) => ({ id: item.id, x: item.x + delta.x, y: item.y + delta.y })), false)
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); store.endInteraction() }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up, { once: true })
  }
  const beginResize = (corner: ResizeCorner, event: ReactPointerEvent) => {
    if (readOnly) return
    event.stopPropagation(); event.preventDefault(); store.beginInteraction()
    const start = { x: event.clientX, y: event.clientY }; const initial = { ...node }
    const move = (moveEvent: PointerEvent) => {
      const delta = dragDeltaToCanvas(moveEvent.clientX - start.x, moveEvent.clientY - start.y, store.getZoomLevel())
      let x = initial.x, y = initial.y, w = initial.w, h = initial.h
      if (corner.includes('e')) w = Math.max(48, initial.w + delta.x)
      if (corner.includes('s')) h = Math.max(48, initial.h + delta.y)
      if (corner.includes('w')) { w = Math.max(48, initial.w - delta.x); x = initial.x + initial.w - w }
      if (corner.includes('n')) { h = Math.max(48, initial.h - delta.y); y = initial.y + initial.h - h }
      store.updateShape({ id: node.id, x, y, w, h, props: { w, h } }, false)
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); store.endInteraction() }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up, { once: true })
  }
  let content = <LegacyNode node={node} store={store} readOnly={readOnly} />
  if (node.type === 'image-ref' || node.type === 'element') content = <ImageNode node={node} store={store} readOnly={readOnly} />
  else if (node.type === 'swatch') content = <SwatchNode node={node} store={store} readOnly={readOnly} />
  else if (node.type === 'type-sample') content = <TypeNode node={node} store={store} readOnly={readOnly} />
  else if (node.type === 'moodboard-note' || node.type === 'text') content = <NoteNode node={node} store={store} readOnly={readOnly} />
  else if (node.type === 'comment-pin') content = <CommentPin node={node} store={store} readOnly={readOnly} showResolvedComments={showResolvedComments} />
  return (
    <div data-canvas-node={node.id} onPointerDown={beginDrag}
      className={`absolute select-none ${readOnly ? '' : 'touch-none'} ${selected && !readOnly ? 'ring-2 ring-[#0F0C59] ring-offset-2' : ''}`}
      style={{ width: node.w, height: node.h, zIndex: node.z, opacity: node.opacity,
        transform: `translate3d(${node.x}px, ${node.y}px, 0) rotate(${node.rotation}rad)`, transformOrigin: 'center' }}>
      {content}
      {selected && !readOnly ? <>
        <button type="button" title="Delete" onPointerDown={stop} onClick={(event) => { stop(event); store.deleteShapes([node.id]) }} className="absolute -right-2 -top-8 z-50 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white shadow">×</button>
        {(['nw', 'ne', 'sw', 'se'] as ResizeCorner[]).map((corner) => <ResizeHandle key={corner} corner={corner} onPointerDown={(event) => beginResize(corner, event)} />)}
      </> : null}
    </div>
  )
}
