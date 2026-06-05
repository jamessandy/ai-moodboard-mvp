'use client'

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
  'note',
  {
    text: string
    w: number
    h: number
  }
>

declare module 'tldraw' {
  interface TLGlobalShapePropsMap {
    'image-ref': ImageRefShape['props']
    element: ElementShape['props']
    swatch: SwatchShape['props']
    'type-sample': TypeSampleShape['props']
    note: NoteShape['props']
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
  static override type = 'note' as const
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

export const moodboardShapeUtils = [
  ImageRefShapeUtil,
  ElementShapeUtil,
  SwatchShapeUtil,
  TypeSampleShapeUtil,
  NoteShapeUtil,
]
