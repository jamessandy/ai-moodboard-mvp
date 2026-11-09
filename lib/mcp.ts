export type MoodblendyToolInput = {
  brief?: string
  style?: string
  colors?: string[]
  references?: string[]
  notes?: string[]
}

export function buildMoodblendyToolPayload(input: MoodblendyToolInput) {
  const brief = input.brief?.trim() || 'Create a cohesive moodboard'
  const style = input.style?.trim() || 'editorial'
  const colors = (input.colors || []).map((color) => color.trim()).filter(Boolean)
  const references = (input.references || []).map((ref) => ref.trim()).filter(Boolean)
  const notes = (input.notes || []).map((note) => note.trim()).filter(Boolean)

  const promptParts = [
    `Create a moodboard for: ${brief}`,
    `Style: ${style}`,
    colors.length ? `Colors: ${colors.join(', ')}` : '',
    references.length ? `References: ${references.join(', ')}` : '',
    notes.length ? `Notes: ${notes.join('; ')}` : '',
  ].filter(Boolean)

  return {
    brief,
    style,
    colors,
    references,
    notes,
    prompt: promptParts.join(' | '),
  }
}
