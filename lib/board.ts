import { TAGS, Tag } from '@/lib/tags'

export interface BoardDoc {
  brief: string
  elements: { url: string; label: string; tags: Tag[] }[]
  imageRefs?: { url: string; tags: Tag[] }[]
  swatches: { colors: string[] }[]
  typeSamples: { label: string }[]
  notes: { text: string }[]
}

export type SourceImage = {
  id: string
  url: string
}

export type MoodboardDocument = {
  version: 2
  sources: SourceImage[]
  tldraw: unknown
}

export interface CompiledRequest {
  prompt: string
  image_urls: string[]
  model: 'fal-ai/nano-banana-pro/edit'
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
