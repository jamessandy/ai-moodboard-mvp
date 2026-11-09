import { TAGS, Tag } from '@/lib/tags'

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
  version: 2
  sources: SourceImage[]
  tldraw: unknown
  chat?: ChatMessage[]
}

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
  return Boolean(
    document &&
      typeof document === 'object' &&
      'version' in document &&
      (document as { version?: unknown }).version === 2 &&
      'tldraw' in document
  )
}
