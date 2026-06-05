import { Vibrant } from 'node-vibrant/node'
import { BoardDoc, CompiledRequest, ELEMENT_ROLE_PHRASES, TAG_PHRASES, cleanHexColors } from '@/lib/board'

export type PaletteExtractor = (url: string) => Promise<string[]>
export type CompileMetadata = {
  palette: string[]
  paletteSource: 'none' | 'swatch' | 'extracted'
}

async function fetchImageBuffer(url: string) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { accept: 'image/*' },
  })

  if (!response.ok) {
    throw new Error(`Could not fetch color-tagged image (${response.status}).`)
  }

  const contentType = response.headers.get('content-type')
  if (contentType && !contentType.startsWith('image/')) {
    throw new Error('Color-tagged reference did not return image bytes.')
  }

  return Buffer.from(await response.arrayBuffer())
}

export const extractPaletteFromImage: PaletteExtractor = async (url) => {
  const buffer = await fetchImageBuffer(url)
  const palette = await Vibrant.from(buffer).getPalette()

  return Object.values(palette)
    .filter((swatch): swatch is NonNullable<typeof swatch> => Boolean(swatch))
    .sort((a, b) => b.population - a.population)
    .map((swatch) => swatch.hex.toLowerCase())
    .slice(0, 6)
}

function unique<T>(items: T[]) {
  return [...new Set(items)]
}

export async function compileBoard(
  board: BoardDoc,
  options: { extractPalette?: PaletteExtractor } = {}
): Promise<CompiledRequest> {
  const { compiled } = await compileBoardWithMetadata(board, options)
  return compiled
}

export async function compileBoardWithMetadata(
  board: BoardDoc,
  options: { extractPalette?: PaletteExtractor } = {}
): Promise<{ compiled: CompiledRequest; metadata: CompileMetadata }> {
  const elements = (board.elements?.length
    ? board.elements
    : (board.imageRefs ?? []).map((ref, index) => ({
        url: ref.url,
        label: `reference ${index + 1}`,
        tags: ref.tags,
      }))
  ).slice(0, 10)
  const image_urls = elements.map((element) => element.url)
  const palette = cleanHexColors(board.swatches.flatMap((swatch) => swatch.colors))
  const hasCuratedPalette = palette.length > 0
  const extractPalette = options.extractPalette ?? extractPaletteFromImage
  let paletteSource: CompileMetadata['paletteSource'] = hasCuratedPalette ? 'swatch' : 'none'

  for (const element of elements) {
    if (element.tags.includes('color') && !hasCuratedPalette) {
      palette.push(...(await extractPalette(element.url)))
    }
  }

  const uniquePalette = unique(palette)
  if (!hasCuratedPalette && uniquePalette.length) paletteSource = 'extracted'

  const paletteLine = uniquePalette.length ? `Color palette: ${uniquePalette.join(', ')}.` : ''
  const referenceLines = elements
    .map((element, index) => {
      if (!element.tags.length) return `Element ${index + 1} — ${element.label}: include in the composition.`
      return `Element ${index + 1} — ${element.label}: include as ${element.tags
        .map((tag) => ELEMENT_ROLE_PHRASES[tag] ?? TAG_PHRASES[tag])
        .join(', ')}.`
    })
    .filter(Boolean)
    .join(' ')
  const notesLine = board.notes.length
    ? `Mood and intent: ${board.notes.map((note) => note.text).join('; ')}.`
    : ''
  const typeLine = board.typeSamples.length
    ? `Set any typography in the style of ${board.typeSamples
        .map((sample) => sample.label)
        .join(', ')}; do not render text unless the brief asks for it.`
    : ''

  return {
    compiled: {
      prompt: `${board.brief}. ${paletteLine} ${referenceLines} ${notesLine} ${typeLine} Generate a single cohesive image that combines the above.`
        .replace(/\s+/g, ' ')
        .trim(),
      image_urls,
      model: 'fal-ai/nano-banana-pro/edit',
    },
    metadata: {
      palette: uniquePalette,
      paletteSource,
    },
  }
}
