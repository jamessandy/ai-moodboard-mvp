'use client'

import { type SyntheticEvent, useState } from 'react'
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  TLBaseShape,
  TLResizeInfo,
  resizeBox,
  type Editor,
} from 'tldraw'
import { TAGS, Tag } from '@/lib/tags'

export type ImageRefShape = TLBaseShape<
  'image-ref',
  {
    url: string
    assetId?: string
    tags: Tag[]
    w: number
    h: number
  }
>

export type ElementShape = TLBaseShape<
  'element',
  {
    url: string
    assetId?: string
    label: string
    sourceId: string
    tags: Tag[]
    w: number
    h: number
  }
>

export type SwatchShape = TLBaseShape<
  'swatch',
  {
    colors: string[]
    w: number
    h: number
  }
>

export type TypeSampleShape = TLBaseShape<
  'type-sample',
  {
    label: string
    w: number
    h: number
  }
>

export type NoteShape = TLBaseShape<
  'moodboard-note',
  {
    text: string
    w: number
    h: number
  }
>

export type CommentReply = {
  author: string
  text: string
  createdAt: string
}

export type CommentPinShape = TLBaseShape<
  'comment-pin',
  {
    author: string
    text: string
    replies: CommentReply[]
    resolved: boolean
    createdAt: string
  }
>

declare module 'tldraw' {
  interface TLGlobalShapePropsMap {
    'image-ref': ImageRefShape['props']
    element: ElementShape['props']
    swatch: SwatchShape['props']
    'type-sample': TypeSampleShape['props']
    'moodboard-note': NoteShape['props']
    'comment-pin': CommentPinShape['props']
  }
}

function rectPath(w: number, h: number) {
  const path = new Path2D()
  path.rect(0, 0, w, h)
  return path
}

function ToggleChips({ editor, shape }: { editor: Editor; shape: ImageRefShape | ElementShape }) {
  const toggleTag = (tag: Tag) => {
    const nextTags = shape.props.tags.includes(tag)
      ? shape.props.tags.filter((item) => item !== tag)
      : [...shape.props.tags, tag]

    editor.updateShape({
      id: shape.id,
      type: shape.type,
      props: { tags: nextTags },
    })
  }

  return (
    <div
      className="absolute bottom-2 left-2 right-2 flex flex-wrap gap-1"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {TAGS.map((tag) => {
        const active = shape.props.tags.includes(tag)
        return (
          <button
            key={tag}
            type="button"
            className={`rounded px-1.5 py-1 text-[10px] font-semibold uppercase leading-none shadow-sm transition ${
              active ? 'bg-neutral-950 text-white' : 'bg-white/85 text-neutral-700'
            }`}
            onClick={() => toggleTag(tag)}
          >
            {tag}
          </button>
        )
      })}
    </div>
  )
}

function EditableElementLabel({ editor, shape }: { editor: Editor; shape: ElementShape }) {
  return (
    <input
      value={shape.props.label}
      className="absolute left-2 top-2 max-w-[calc(100%-16px)] rounded bg-white/90 px-2 py-1 text-xs font-semibold text-neutral-900 shadow"
      onPointerDown={(event) => event.stopPropagation()}
      onChange={(event) => {
        editor.updateShape<ElementShape>({
          id: shape.id,
          type: 'element',
          props: { label: event.target.value },
        })
      }}
      aria-label="Element label"
    />
  )
}

export class ImageRefShapeUtil extends ShapeUtil<ImageRefShape> {
  static override type = 'image-ref' as const
  static override props = {
    url: T.string,
    assetId: T.string.optional(),
    tags: T.arrayOf(T.string),
    w: T.number,
    h: T.number,
  }

  getDefaultProps(): ImageRefShape['props'] {
    return { url: '', tags: [], w: 280, h: 220 }
  }

  override canResize() {
    return true
  }

  override isAspectRatioLocked() {
    return false
  }

  getGeometry(shape: ImageRefShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }

  override onResize(shape: ImageRefShape, info: TLResizeInfo<ImageRefShape>) {
    return resizeBox(shape, info)
  }

  component(shape: ImageRefShape) {
    return (
      <HTMLContainer className="overflow-hidden rounded border border-neutral-950/15 bg-neutral-100 shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={shape.props.url}
          alt=""
          draggable={false}
          className="h-full w-full select-none object-cover"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
        <ToggleChips editor={this.editor} shape={shape} />
      </HTMLContainer>
    )
  }

  getIndicatorPath(shape: ImageRefShape) {
    return rectPath(shape.props.w, shape.props.h)
  }
}

export class ElementShapeUtil extends ShapeUtil<ElementShape> {
  static override type = 'element' as const
  static override props = {
    url: T.string,
    assetId: T.string.optional(),
    label: T.string,
    sourceId: T.string,
    tags: T.arrayOf(T.string),
    w: T.number,
    h: T.number,
  }

  getDefaultProps(): ElementShape['props'] {
    return { url: '', label: 'element', sourceId: '', tags: [], w: 320, h: 320 }
  }

  override canResize() {
    return true
  }

  override isAspectRatioLocked() {
    return false
  }

  getGeometry(shape: ElementShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }

  override onResize(shape: ElementShape, info: TLResizeInfo<ElementShape>) {
    return resizeBox(shape, info)
  }

  component(shape: ElementShape) {
    const isGeneratedOutput = shape.props.sourceId === 'generated'

    return (
      <HTMLContainer className="overflow-visible">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={shape.props.url}
          alt=""
          draggable={false}
          className="h-full w-full select-none object-contain"
        />
        {isGeneratedOutput ? null : (
          <>
            <EditableElementLabel editor={this.editor} shape={shape} />
            <ToggleChips editor={this.editor} shape={shape} />
          </>
        )}
      </HTMLContainer>
    )
  }

  getIndicatorPath(shape: ElementShape) {
    return rectPath(shape.props.w, shape.props.h)
  }
}

export class SwatchShapeUtil extends ShapeUtil<SwatchShape> {
  static override type = 'swatch' as const
  static override props = {
    colors: T.arrayOf(T.string),
    w: T.number,
    h: T.number,
  }

  getDefaultProps(): SwatchShape['props'] {
    return { colors: ['#1f2937', '#ef4444', '#f8fafc'], w: 220, h: 92 }
  }

  override canResize() {
    return true
  }

  getGeometry(shape: SwatchShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }

  override onResize(shape: SwatchShape, info: TLResizeInfo<SwatchShape>) {
    return resizeBox(shape, info)
  }

  component(shape: SwatchShape) {
    return (
      <HTMLContainer className="overflow-hidden rounded border border-neutral-950/15 bg-white shadow-sm">
        <div className="flex h-full w-full">
          {shape.props.colors.map((color, index) => (
            <div key={`${color}-${index}`} className="relative flex-1" style={{ background: color }}>
              <span className="absolute bottom-1 left-1 rounded bg-white/80 px-1 font-mono text-[10px] text-neutral-900">
                {color}
              </span>
            </div>
          ))}
        </div>
      </HTMLContainer>
    )
  }

  getIndicatorPath(shape: SwatchShape) {
    return rectPath(shape.props.w, shape.props.h)
  }
}

export class TypeSampleShapeUtil extends ShapeUtil<TypeSampleShape> {
  static override type = 'type-sample' as const
  static override props = {
    label: T.string,
    w: T.number,
    h: T.number,
  }

  getDefaultProps(): TypeSampleShape['props'] {
    return { label: 'Condensed grotesk / wide tracking', w: 320, h: 96 }
  }

  override canResize() {
    return true
  }

  getGeometry(shape: TypeSampleShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }

  override onResize(shape: TypeSampleShape, info: TLResizeInfo<TypeSampleShape>) {
    return resizeBox(shape, info)
  }

  component(shape: TypeSampleShape) {
    return (
      <HTMLContainer className="flex items-center rounded border border-neutral-950 bg-[#f9f4e7] px-5 shadow-sm">
        <div className="w-full truncate font-mono text-lg font-semibold uppercase tracking-normal text-neutral-950">
          {shape.props.label}
        </div>
      </HTMLContainer>
    )
  }

  getIndicatorPath(shape: TypeSampleShape) {
    return rectPath(shape.props.w, shape.props.h)
  }
}

export class NoteShapeUtil extends ShapeUtil<NoteShape> {
  static override type = 'moodboard-note' as const
  static override props = {
    text: T.string,
    w: T.number,
    h: T.number,
  }

  getDefaultProps(): NoteShape['props'] {
    return { text: 'sun-bleached, intimate, tactile', w: 240, h: 150 }
  }

  override canResize() {
    return true
  }

  getGeometry(shape: NoteShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
  }

  override onResize(shape: NoteShape, info: TLResizeInfo<NoteShape>) {
    return resizeBox(shape, info)
  }

  component(shape: NoteShape) {
    return (
      <HTMLContainer className="rounded border border-yellow-700/20 bg-[#fff4a8] p-4 shadow-sm">
        <p className="m-0 line-clamp-[7] whitespace-pre-wrap text-base font-medium leading-snug text-neutral-900">
          {shape.props.text}
        </p>
      </HTMLContainer>
    )
  }

  getIndicatorPath(shape: NoteShape) {
    return rectPath(shape.props.w, shape.props.h)
  }
}

export class CommentPinShapeUtil extends ShapeUtil<CommentPinShape> {
  static override type = 'comment-pin' as const
  static override props = {
    author: T.string,
    text: T.string,
    replies: T.arrayOf(
      T.object({
        author: T.string,
        text: T.string,
        createdAt: T.string,
      })
    ),
    resolved: T.boolean,
    createdAt: T.string,
  }

  getDefaultProps(): CommentPinShape['props'] {
    return {
      author: 'Anonymous',
      text: '',
      replies: [],
      resolved: false,
      createdAt: new Date().toISOString(),
    }
  }

  override canResize() {
    return false
  }

  getGeometry() {
    return new Rectangle2d({ width: 28, height: 28, isFilled: true })
  }

  component(shape: CommentPinShape) {
    return <CommentPin editor={this.editor} shape={shape} />
  }

  getIndicatorPath() {
    const path = new Path2D()
    path.arc(14, 14, 14, 0, Math.PI * 2)
    return path
  }
}

function CommentPin({ editor, shape }: { editor: Editor; shape: CommentPinShape }) {
  const [open, setOpen] = useState(!shape.props.text)
  const [draft, setDraft] = useState(shape.props.text)
  const [reply, setReply] = useState('')
  const resolved = shape.props.resolved

  const updateProps = (props: Partial<CommentPinShape['props']>) => {
    editor.updateShape<CommentPinShape>({
      id: shape.id,
      type: 'comment-pin',
      props,
    })
  }
  const handleUiEvent = (event: SyntheticEvent) => {
    editor.markEventAsHandled(event)
    event.stopPropagation()
  }

  return (
    <HTMLContainer
      className="comment-pin pointer-events-auto overflow-visible"
      data-resolved={resolved ? 'true' : 'false'}
      onPointerDown={handleUiEvent}
      onPointerUp={handleUiEvent}
      onClick={handleUiEvent}
      onKeyDown={handleUiEvent}
    >
      <button
        type="button"
        className={`pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold shadow ${
          resolved ? 'border-neutral-400 bg-neutral-200 text-neutral-500' : 'border-white bg-[#0f766e] text-white'
        }`}
        onClick={() => setOpen((current) => !current)}
      >
        {resolved ? 'OK' : shape.props.replies.length + 1}
      </button>
      {open ? (
        <div className="pointer-events-auto absolute left-8 top-0 z-50 w-72 rounded border border-neutral-300 bg-white p-3 text-neutral-950 shadow-xl">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="truncate text-xs font-semibold text-neutral-500">{shape.props.author}</span>
            <button
              type="button"
              className="pointer-events-auto rounded border border-neutral-300 px-2 py-1 text-xs font-semibold"
              onClick={() => updateProps({ resolved: !resolved })}
            >
              {resolved ? 'Reopen' : 'Resolve'}
            </button>
          </div>
          {shape.props.text ? (
            <p className="m-0 whitespace-pre-wrap text-sm leading-snug">{shape.props.text}</p>
          ) : (
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Comment"
              className="pointer-events-auto h-20 w-full resize-none rounded border border-neutral-300 px-2 py-1 text-sm outline-none focus:border-neutral-950"
            />
          )}
          {shape.props.replies.length ? (
            <div className="mt-3 space-y-2 border-t border-neutral-200 pt-2">
              {shape.props.replies.map((item) => (
                <div key={`${item.createdAt}-${item.author}`}>
                  <div className="text-xs font-semibold text-neutral-500">{item.author}</div>
                  <p className="m-0 whitespace-pre-wrap text-sm leading-snug">{item.text}</p>
                </div>
              ))}
            </div>
          ) : null}
          {shape.props.text ? (
            <div className="mt-3 flex gap-2">
              <input
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                placeholder="Reply"
                className="pointer-events-auto min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-sm outline-none focus:border-neutral-950"
              />
              <button
                type="button"
                className="pointer-events-auto rounded bg-neutral-950 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                disabled={!reply.trim()}
                onClick={() => {
                  const text = reply.trim()
                  if (!text) return
                  updateProps({
                    replies: [
                      ...shape.props.replies,
                      { author: shape.props.author, text, createdAt: new Date().toISOString() },
                    ],
                  })
                  setReply('')
                }}
              >
                Reply
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="pointer-events-auto mt-2 h-8 w-full rounded bg-neutral-950 px-2 text-xs font-semibold text-white disabled:opacity-50"
              disabled={!draft.trim()}
              onClick={() => updateProps({ text: draft.trim() })}
            >
              Save comment
            </button>
          )}
        </div>
      ) : null}
    </HTMLContainer>
  )
}

export const moodboardShapeUtils = [
  ImageRefShapeUtil,
  ElementShapeUtil,
  SwatchShapeUtil,
  TypeSampleShapeUtil,
  NoteShapeUtil,
  CommentPinShapeUtil,
]
