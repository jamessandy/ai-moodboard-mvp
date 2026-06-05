export const TAGS = ['color', 'composition', 'mood', 'subject', 'texture', 'lighting'] as const

export type Tag = (typeof TAGS)[number]

export function isTag(value: string): value is Tag {
  return (TAGS as readonly string[]).includes(value)
}
