import { NextRequest, NextResponse } from 'next/server'
import {
  CREATIVE_DIRECTORY,
  DirectoryBranchId,
  VibeSearchMode,
  adaptQueryForBranch,
  buildDirectSearchUrl,
} from '@/lib/explore-catalog'
import { Tag, TAGS } from '@/lib/tags'

export const runtime = 'nodejs'

// Simple rule-based tag extractor from user's vibe description
function extractTagsFromVibe(vibe: string): Tag[] {
  const lower = vibe.toLowerCase()
  const found: Tag[] = []

  const tagKeywords: Record<Tag, string[]> = {
    color: ['color', 'neon', 'pastel', 'vibrant', 'monochrome', 'saturated', 'red', 'blue', 'green', 'warm', 'cool', 'tone', 'palette'],
    lighting: ['lighting', 'light', 'dark', 'shadow', 'golden hour', 'sun', 'chiaroscuro', 'neon', 'glow', 'flash', 'direct', 'noir'],
    mood: ['mood', 'moody', 'cyber', 'noir', 'nostalgic', 'dreamy', 'melancholic', 'summer', 'pop', 'retro', 'vintage', 'dark', 'happy'],
    composition: ['composition', 'layout', 'grid', 'minimal', 'brutalist', 'split', 'framed', 'centered', 'rule of thirds', 'negative space'],
    texture: ['texture', 'grain', '35mm', 'analog', 'film', 'concrete', 'gloss', 'matte', 'paper', 'noise', 'dither', 'crt'],
    subject: ['portrait', 'fashion', 'model', 'album', 'streetwear', 'car', 'nature', 'landscape', 'object', 'product', 'mockup'],
  }

  for (const [tag, keywords] of Object.entries(tagKeywords) as [Tag, string[]][]) {
    if (keywords.some((k) => lower.includes(k))) {
      found.push(tag)
    }
  }

  return found.length > 0 ? found : ['mood', 'composition']
}

// Generate aesthetic color palette matching common vibes
function derivePaletteFromVibe(vibe: string): string[] {
  const lower = vibe.toLowerCase()
  if (lower.includes('cyber') || lower.includes('neon') || lower.includes('noir')) {
    return ['#0f051d', '#00ffcc', '#ff007f', '#38bdf8']
  }
  if (lower.includes('warm') || lower.includes('golden') || lower.includes('summer')) {
    return ['#f59e0b', '#f97316', '#ffedd5', '#1c1917']
  }
  if (lower.includes('minimal') || lower.includes('brutalist') || lower.includes('mono')) {
    return ['#000000', '#ffffff', '#71717a', '#e4e4e7']
  }
  if (lower.includes('pastel') || lower.includes('pop') || lower.includes('dreamy')) {
    return ['#f472b6', '#c084fc', '#38bdf8', '#fef08a']
  }
  if (lower.includes('vintage') || lower.includes('analog') || lower.includes('35mm')) {
    return ['#451a03', '#d97706', '#fef3c7', '#292524']
  }
  return ['#0f172a', '#2dd4bf', '#f8fafc', '#64748b']
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const query = typeof body.vibe === 'string' ? body.vibe.trim() : typeof body.query === 'string' ? body.query.trim() : ''
    const mode: VibeSearchMode = body.mode === 'option_b' ? 'option_b' : 'option_a'
    const branchFilter = typeof body.branch === 'string' ? (body.branch as DirectoryBranchId) : undefined

    if (!query) {
      return NextResponse.json({ error: 'Search query or vibe is required.' }, { status: 400 })
    }

    const extractedTags = extractTagsFromVibe(query)
    const vibePalette = derivePaletteFromVibe(query)

    // Filter platforms in the creative directory
    let platforms = CREATIVE_DIRECTORY
    if (branchFilter && branchFilter !== 'all') {
      platforms = platforms.filter((p) => p.branch === branchFilter)
    }

    const adaptedQueries: Record<string, string> = {}
    const results = platforms.map((item) => {
      const adaptedQuery = adaptQueryForBranch(query, item.branch, mode)
      adaptedQueries[item.branch] = adaptedQuery
      const directSearchUrl = buildDirectSearchUrl(item, query, mode)

      return {
        id: `search-${item.id}-${mode}`,
        site_id: item.id,
        title: item.title,
        source_name: item.source_name || item.title,
        branch: item.branch,
        sub_branch: item.sub_branch,
        media_url: item.media_url,
        source_url: item.source_url,
        direct_search_url: directSearchUrl,
        display_query: adaptedQuery,
        description: item.description,
        features: item.features,
        palette: item.palette.length > 0 ? item.palette : vibePalette,
        extracted_tags: extractedTags,
      }
    })

    return NextResponse.json({
      query,
      mode,
      adapted_queries: adaptedQueries,
      extracted_tags: extractedTags,
      vibe_palette: vibePalette,
      results,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Vibe search failed.' },
      { status: 500 }
    )
  }
}
