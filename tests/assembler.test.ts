import assert from 'node:assert/strict'
import test from 'node:test'
import { compileBoard, compileBoardWithMetadata } from '@/lib/assembler'
import { BoardDoc } from '@/lib/board'

const emptyBoard: BoardDoc = {
  brief: 'Editorial streetwear lookbook in an abandoned tennis court',
  elements: [],
  swatches: [],
  typeSamples: [],
  notes: [],
}

test('injects swatch colors directly and skips extraction when a curated palette exists', async () => {
  let extracted = false
  const { compiled, metadata } = await compileBoardWithMetadata(
    {
      ...emptyBoard,
      elements: [{ url: 'https://storage.example/ref.jpg', label: 'bear cutout', tags: ['color', 'mood'] }],
      swatches: [{ colors: ['#111827', '#F97316', 'not-a-color'] }],
    },
    {
      extractPalette: async () => {
        extracted = true
        return ['#00ff00']
      },
    }
  )

  assert.equal(extracted, false)
  assert.equal(metadata.paletteSource, 'swatch')
  assert.deepEqual(metadata.palette, ['#111827', '#F97316'])
  assert.equal(compiled.image_urls.length, 1)
  assert.match(compiled.prompt, /Color palette: #111827, #F97316\./)
  assert.doesNotMatch(compiled.prompt, /#00ff00/)
})

test('extracts hex colors from color-tagged references when no swatch exists', async () => {
  const { compiled, metadata } = await compileBoardWithMetadata(
    {
      ...emptyBoard,
      elements: [
        { url: 'https://storage.example/color.png', label: 'bear', tags: ['color'] },
        { url: 'https://storage.example/light.png', label: 'chair', tags: ['lighting'] },
      ],
    },
    {
      extractPalette: async (url) => (url.includes('color') ? ['#aa0000', '#00aa88'] : ['#ffffff']),
    }
  )

  assert.equal(metadata.paletteSource, 'extracted')
  assert.deepEqual(metadata.palette, ['#aa0000', '#00aa88'])
  assert.match(compiled.prompt, /Color palette: #aa0000, #00aa88\./)
  assert.doesNotMatch(compiled.prompt, /#ffffff/)
  assert.match(compiled.prompt, /Element 1 — bear: include as color influence\./)
  assert.match(compiled.prompt, /Element 2 — chair: include as lighting reference\./)
})

test('caps reference images at ten and includes notes and type-sample instruction', async () => {
  const compiled = await compileBoard({
    ...emptyBoard,
    elements: Array.from({ length: 12 }, (_, index) => ({
      url: `https://storage.example/ref-${index}.jpg`,
      label: `element ${index}`,
      tags: index === 0 ? ['composition'] : [],
    })),
    typeSamples: [{ label: 'Sharp condensed sans' }],
    notes: [{ text: 'humid night energy' }, { text: 'flash-lit but premium' }],
  })

  assert.equal(compiled.image_urls.length, 10)
  assert.equal(compiled.image_urls.at(-1), 'https://storage.example/ref-9.jpg')
  assert.match(compiled.prompt, /Mood and intent: humid night energy; flash-lit but premium\./)
  assert.match(compiled.prompt, /Set any typography in the style of Sharp condensed sans/)
})
