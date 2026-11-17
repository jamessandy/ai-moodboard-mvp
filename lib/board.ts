import { TAGS, Tag } from '@/lib/tags'
import {
  CanvasNode,
  NativeCanvasDocument,
  createCanvasId,
  emptyCanvasDocument,
} from '@/lib/canvas-store'

export const SOURCE_ROLES = [
  'pose',
  'outfit',
  'background',
  'lighting',
  'composition',
  'color-palette',
  'hair',
  'makeup',
  'props',
  'identity',
] as const

export type SourceRole = (typeof SOURCE_ROLES)[number]

export const SOURCE_ROLE_LABELS: Record<SourceRole, string> = {
  pose: 'Pose',
  outfit: 'Outfit',
  background: 'Background',
  lighting: 'Lighting',
  composition: 'Composition',
  'color-palette': 'Color Palette',
  hair: 'Hair',
  makeup: 'Makeup',
  props: 'Props',
  identity: 'Identity',
}

export const SOURCE_ROLE_PHRASES: Record<SourceRole, string> = {
  pose: 'pose and body position reference',
  outfit: 'outfit and styling reference',
  background: 'background or environment reference',
  lighting: 'lighting reference',
  composition: 'composition and framing reference',
  'color-palette': 'color palette reference',
  hair: 'hair reference',
  makeup: 'makeup reference',
  props: 'props or object reference',
  identity: 'identity or likeness reference',
}

export interface BoardDoc {
  brief: string
  elements: { url: string; label: string; tags: Tag[] }[]
  imageRefs?: { url: string; label?: string; tags: Tag[] }[]
  sources?: { url: string; label?: string; role?: SourceRole }[]
  swatches: { colors: string[] }[]
  typeSamples: { label: string }[]
  notes: { text: string }[]
}

export type SourceImage = {
  id: string
  url: string
  name?: string
  role?: SourceRole
}

export type ChatImage = {
  url: string
  name?: string
  width?: number
  height?: number
  seed?: number
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  generationPrompt?: string
  images?: ChatImage[]
  status?: 'thinking' | 'generating' | 'done' | 'error'
}

export type MoodboardDocument = {
  version: 2 | 3
  sources: SourceImage[]
  canvas?: NativeCanvasDocument
  chat?: ChatMessage[]
} & Record<string, unknown>

export interface CompiledRequest {
  prompt: string
  image_urls: string[]
  model: string
}

export const TAG_PHRASES: Record<Tag, string> = {
  color: 'the color palette',
  composition: 'the composition and framing',
  mood: 'the mood and atmosphere',
  subject: 'the subject matter',
  texture: 'the texture and surface quality',
  lighting: 'the lighting',
}

export const ELEMENT_ROLE_PHRASES: Record<Tag, string> = {
  color: 'color influence',
  composition: 'composition reference',
  mood: 'mood reference',
  subject: 'subject or object',
  texture: 'texture or surface quality',
  lighting: 'lighting reference',
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i

export function cleanTags(tags: string[]): Tag[] {
  return tags.filter((tag): tag is Tag => (TAGS as readonly string[]).includes(tag))
}

export function cleanSourceRole(role: string | undefined): SourceRole | undefined {
  return role && (SOURCE_ROLES as readonly string[]).includes(role) ? (role as SourceRole) : undefined
}

export function cleanHexColors(colors: string[]) {
  return colors.map((color) => color.trim()).filter((color) => HEX_COLOR.test(color))
}

export function isMoodboardDocument(document: unknown): document is MoodboardDocument {
  const legacyKey = ['tl', 'draw'].join('')
  return Boolean(
    document &&
      typeof document === 'object' &&
      'version' in document &&
      ((document as { version?: unknown }).version === 2 || (document as { version?: unknown }).version === 3) &&
      ('canvas' in document || legacyKey in document)
  )
}

export function countSnapshotShapes(snapshot: unknown) {
  return normalizeCanvasDocument(snapshot).nodes.length
}

function hasCompleteImageAssets(snapshot: unknown) {
  return normalizeCanvasDocument(snapshot).nodes.every((node) => {
    if (!['image', 'image-ref', 'element'].includes(node.type)) return true
    return typeof node.props.url === 'string' && node.props.url.trim().length > 0
  })
}

export function selectBoardSnapshot(remoteSnapshot: unknown, currentSnapshot: unknown) {
  const remoteShapeCount = countSnapshotShapes(remoteSnapshot)
  const localShapeCount = countSnapshotShapes(currentSnapshot)
  const remoteIncomplete = remoteShapeCount > 0 && !hasCompleteImageAssets(remoteSnapshot)
  const preserveCurrent =
    localShapeCount > 0 &&
    (remoteShapeCount === 0 || remoteIncomplete || localShapeCount >= remoteShapeCount)

  return {
    snapshot: preserveCurrent ? currentSnapshot : remoteSnapshot,
    preserveCurrent,
    remoteShapeCount,
    localShapeCount,
    remoteIncomplete,
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function finite(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function textFromRichValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(textFromRichValue).filter(Boolean).join(' ')
  if (!isObject(value)) return ''
  if (typeof value.text === 'string') return value.text
  return textFromRichValue(value.content)
}

function legacyStore(snapshot: unknown) {
  if (!isObject(snapshot)) return null
  if (isObject(snapshot.store)) return snapshot.store
  if (isObject(snapshot.document) && isObject(snapshot.document.store)) return snapshot.document.store
  return null
}

function drawSize(props: Record<string, unknown>) {
  let maxX = 0
  let maxY = 0
  const segments = Array.isArray(props.segments) ? props.segments : []
  for (const segment of segments) {
    if (!isObject(segment) || !Array.isArray(segment.points)) continue
    for (const point of segment.points) {
      if (!isObject(point)) continue
      maxX = Math.max(maxX, finite(point.x, 0))
      maxY = Math.max(maxY, finite(point.y, 0))
    }
  }
  return { w: Math.max(40, maxX), h: Math.max(40, maxY) }
}

function normalizeLegacySnapshot(snapshot: unknown): NativeCanvasDocument | null {
  const store = legacyStore(snapshot)
  if (!store) return null
  const records = Object.entries(store)
  const assets = new Map<string, string>()
  for (const [key, value] of records) {
    if (!isObject(value) || value.typeName !== 'asset' || !isObject(value.props)) continue
    const src = value.props.src
    const id = typeof value.id === 'string' ? value.id : key
    if (typeof src === 'string') assets.set(id, src)
  }

  const shapes = records
    .filter(([key, value]) => key.startsWith('shape:') || (isObject(value) && value.typeName === 'shape'))
    .sort(([, first], [, second]) => {
      const a = isObject(first) && typeof first.index === 'string' ? first.index : ''
      const b = isObject(second) && typeof second.index === 'string' ? second.index : ''
      return a.localeCompare(b)
    })

  const nodes: CanvasNode[] = shapes.flatMap(([key, value], index) => {
    if (!isObject(value)) return []
    const props = isObject(value.props) ? { ...value.props } : {}
    let type = typeof value.type === 'string' ? value.type : 'moodboard-note'
    if (type === 'note') type = 'moodboard-note'
    if (type === 'image') type = 'image-ref'
    const assetId = typeof props.assetId === 'string' ? props.assetId : ''
    const url = typeof props.url === 'string' ? props.url : assets.get(assetId) ?? ''
    const draw = type === 'draw' ? drawSize(props) : null
    const w = Math.max(24, finite(props.w, draw?.w ?? (type === 'comment-pin' ? 28 : 240)))
    const h = Math.max(24, finite(props.h, draw?.h ?? (type === 'comment-pin' ? 28 : 160)))
    const text = typeof props.text === 'string' ? props.text : textFromRichValue(props.richText)
    const normalizedProps: Record<string, unknown> = { ...props, w, h }
    if (url) normalizedProps.url = url
    if (text) normalizedProps.text = text
    if (type === 'text' && text) normalizedProps.label = text

    return [{
      id: typeof value.id === 'string' ? value.id : key,
      type,
      x: finite(value.x, 0),
      y: finite(value.y, 0),
      w,
      h,
      z: index + 1,
      rotation: finite(value.rotation, 0),
      opacity: Math.min(1, Math.max(0, finite(value.opacity, 1))),
      props: normalizedProps,
    }]
  })
  return { version: 1, nodes }
}

function normalizeFixtureBoard(value: Record<string, unknown>): NativeCanvasDocument | null {
  if (!Array.isArray(value.elements) && !Array.isArray(value.swatches) && !Array.isArray(value.notes)) return null
  const nodes: CanvasNode[] = []
  const push = (type: string, x: number, y: number, props: Record<string, unknown>, w: number, h: number) => {
    nodes.push({ id: createCanvasId('shape'), type, x, y, w, h, z: nodes.length + 1, rotation: 0, opacity: 1, props: { ...props, w, h } })
  }
  ;(Array.isArray(value.elements) ? value.elements : []).forEach((item, index) => {
    if (!isObject(item)) return
    push('element', index * 340, 0, {
      url: typeof item.url === 'string' ? item.url : '',
      label: typeof item.label === 'string' ? item.label : 'element',
      sourceId: '',
      tags: Array.isArray(item.tags) ? cleanTags(item.tags.filter((tag): tag is string => typeof tag === 'string')) : [],
    }, 300, 300)
  })
  ;(Array.isArray(value.swatches) ? value.swatches : []).forEach((item, index) => {
    if (isObject(item)) push('swatch', index * 250, 340, { colors: Array.isArray(item.colors) ? item.colors : [] }, 220, 92)
  })
  ;(Array.isArray(value.typeSamples) ? value.typeSamples : []).forEach((item, index) => {
    if (isObject(item)) push('type-sample', 260 + index * 340, 460, { label: typeof item.label === 'string' ? item.label : '' }, 320, 96)
  })
  ;(Array.isArray(value.notes) ? value.notes : []).forEach((item, index) => {
    if (isObject(item)) push('moodboard-note', index * 260, 580, { text: typeof item.text === 'string' ? item.text : '' }, 240, 150)
  })
  return { version: 1, nodes }
}

export function isNativeCanvasDocument(value: unknown): value is NativeCanvasDocument {
  return Boolean(isObject(value) && value.version === 1 && Array.isArray(value.nodes))
}

export function getStoredCanvasSnapshot(document: unknown) {
  if (!isMoodboardDocument(document)) return document
  if (isNativeCanvasDocument(document.canvas)) return document.canvas
  return document[['tl', 'draw'].join('')]
}

export function normalizeCanvasDocument(value: unknown): NativeCanvasDocument {
  const snapshot = isMoodboardDocument(value) ? getStoredCanvasSnapshot(value) : value
  if (isNativeCanvasDocument(snapshot)) {
    return {
      version: 1,
      nodes: snapshot.nodes.flatMap((value, index) => {
        if (!isObject(value)) return []
        const type = typeof value.type === 'string' ? value.type : 'moodboard-note'
        const w = Math.max(24, finite(value.w, type === 'comment-pin' ? 28 : 240))
        const h = Math.max(24, finite(value.h, type === 'comment-pin' ? 28 : 160))
        return [{
          id: typeof value.id === 'string' ? value.id : createCanvasId('shape'),
          type,
          z: finite(value.z, index + 1),
          x: finite(value.x, 0),
          y: finite(value.y, 0),
          w,
          h,
          rotation: finite(value.rotation, 0),
          opacity: Math.min(1, Math.max(0, finite(value.opacity, 1))),
          props: isObject(value.props) ? { ...value.props, w, h } : { w, h },
        }]
      }),
    }
  }
  return normalizeLegacySnapshot(snapshot) ?? (isObject(snapshot) ? normalizeFixtureBoard(snapshot) : null) ?? emptyCanvasDocument()
}
