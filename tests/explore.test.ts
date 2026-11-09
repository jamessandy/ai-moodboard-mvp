import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  EXPLORE_CATALOG,
  DIRECTORY_BRANCHES,
  filterCatalog,
  getBranchItemCount,
} from '@/lib/explore-catalog'
import { compileBoardWithMetadata } from '@/lib/assembler'
import { BoardDoc } from '@/lib/board'

async function loadFixtureBoard(slug: string) {
  const safeName = slug.replace(/[^a-z0-9-]/g, '')
  const filePath = join(process.cwd(), 'fixtures', 'boards', `${safeName}.json`)
  const raw = await readFile(filePath, 'utf-8')
  return JSON.parse(raw)
}

test('creative directory has expected branches and items', () => {
  const branchIds = DIRECTORY_BRANCHES.map((b) => b.id)
  assert.ok(branchIds.includes('video_clips'))
  assert.ok(branchIds.includes('cover_art'))
  assert.ok(branchIds.includes('design_editorial'))
  assert.ok(branchIds.includes('photography'))
  assert.ok(branchIds.includes('fonts'))
  assert.ok(branchIds.includes('tools'))

  assert.ok(EXPLORE_CATALOG.length >= 25, 'Expected comprehensive directory catalog')
})

test('filterCatalog correctly filters by branch, subBranch, query, and tag', () => {
  const videoClips = filterCatalog({ branch: 'video_clips' })
  assert.ok(videoClips.length > 0)
  assert.ok(videoClips.every((i) => i.branch === 'video_clips'))

  const coverArt = filterCatalog({ branch: 'cover_art' })
  assert.ok(coverArt.length > 0)
  assert.ok(coverArt.every((i) => i.branch === 'cover_art'))

  const albumCovers = filterCatalog({ branch: 'cover_art', subBranch: 'Album Covers' })
  assert.ok(albumCovers.length > 0)
  assert.ok(albumCovers.every((i) => i.sub_branch === 'Album Covers'))

  const filmgrab = filterCatalog({ q: 'filmgrab' })
  assert.ok(filmgrab.length > 0)
  assert.equal(filmgrab[0].source_name, 'FILMGRAB')

  const moodItems = filterCatalog({ tag: 'mood' })
  assert.ok(moodItems.length > 0)
  assert.ok(moodItems.every((i) => i.extracted_tags.includes('mood')))

  const totalCount = getBranchItemCount('all')
  assert.equal(totalCount, EXPLORE_CATALOG.length)
})

test('all board templates in explore catalog map to valid fixtures and compile cleanly', async () => {
  const templates = EXPLORE_CATALOG.filter((i) => i.item_kind === 'board_template')
  assert.equal(templates.length, 4)

  for (const t of templates) {
    assert.ok(t.template_slug, `Template ${t.title} missing template_slug`)
    const fixture = await loadFixtureBoard(t.template_slug!)
    assert.ok(fixture, `Fixture ${t.template_slug} failed to load`)
    assert.ok(typeof fixture.brief === 'string')

    // Verify it compiles with assembler
    const { compiled, metadata } = await compileBoardWithMetadata(fixture as BoardDoc, {
      extractPalette: async () => ['#000000'],
    })
    assert.ok(compiled.prompt.length > 0)
    assert.ok(Array.isArray(metadata.palette))
  }
})

test('canvas assets with palette and tags feed directly into prompt compilation', async () => {
  const asset = EXPLORE_CATALOG.find((i) => i.item_kind === 'canvas_asset' && i.palette.length > 0)
  assert.ok(asset, 'Must have at least one canvas asset with palette')
  assert.ok(asset.media_url, 'Asset must have media_url')

  const board: BoardDoc = {
    brief: 'Cyberpunk nocturnal scene',
    elements: [
      {
        url: asset.media_url,
        label: asset.title,
        tags: asset.extracted_tags,
      },
    ],
    swatches: [{ colors: asset.palette }],
    typeSamples: [],
    notes: [],
  }

  let extractCalled = false
  const { compiled, metadata } = await compileBoardWithMetadata(board, {
    extractPalette: async () => {
      extractCalled = true
      return ['#ffffff']
    },
  })

  // Pre-computed swatches skip slow network extraction
  assert.equal(extractCalled, false)
  assert.equal(metadata.paletteSource, 'swatch')
  assert.deepEqual(metadata.palette, asset.palette)
  assert.match(compiled.prompt, new RegExp(`Color palette: ${asset.palette.join(', ')}`))
})

test('color_codes branch contains rich palettes and platforms with search templates', () => {
  const colorItems = filterCatalog({ branch: 'color_codes' })
  assert.ok(colorItems.length >= 6, 'Expected at least 6 color code platforms')
  
  const coolors = colorItems.find((i) => i.title.toLowerCase().includes('coolors'))
  assert.ok(coolors, 'Coolors platform must exist')
  assert.ok(coolors.search_url_template?.includes('%s'))
  assert.ok(coolors.palette.length >= 4, 'Coolors must have color swatches')
  assert.ok(coolors.palette.every((hex) => hex.startsWith('#')), 'Must be valid hex strings')

  const brandColors = colorItems.find((i) => i.title.toLowerCase().includes('brandcolors'))
  assert.ok(brandColors, 'BrandColors platform must exist')
  assert.ok(brandColors.palette.length >= 4)
})

test('vibe search differentiates Option A (direct) and Option B (AI query adaptation)', async () => {
  const { adaptQueryForBranch, buildDirectSearchUrl } = await import('@/lib/explore-catalog')
  
  const rawVibe = 'nostalgic midnight drive'

  // Option A preserves exact raw vibe
  const optionAVideo = adaptQueryForBranch(rawVibe, 'video_clips', 'option_a')
  const optionAPhoto = adaptQueryForBranch(rawVibe, 'photography', 'option_a')
  assert.equal(optionAVideo, rawVibe)
  assert.equal(optionAPhoto, rawVibe)

  // Option B adapts query per discipline
  const optionBVideo = adaptQueryForBranch(rawVibe, 'video_clips', 'option_b')
  const optionBPhoto = adaptQueryForBranch(rawVibe, 'photography', 'option_b')
  const optionBFonts = adaptQueryForBranch(rawVibe, 'fonts', 'option_b')
  const optionBColors = adaptQueryForBranch(rawVibe, 'color_codes', 'option_b')

  assert.match(optionBVideo, /cinematic motion/)
  assert.match(optionBPhoto, /35mm cinematic still/)
  assert.match(optionBFonts, /display typeface/)
  assert.match(optionBColors, /color palette/)

  // Test direct search URL generation
  const unsplashItem = filterCatalog({ branch: 'photography' }).find((i) => i.source_name?.includes('Unsplash') || i.title.includes('Unsplash'))
  if (unsplashItem) {
    const urlA = buildDirectSearchUrl(unsplashItem, rawVibe, 'option_a')
    assert.ok(urlA.includes('unsplash.com'))
    assert.ok(urlA.includes('nostalgic%20midnight%20drive'))

    const urlB = buildDirectSearchUrl(unsplashItem, rawVibe, 'option_b')
    assert.ok(urlB.includes('unsplash.com'))
    assert.ok(urlB.includes('35mm'))
  }
})

