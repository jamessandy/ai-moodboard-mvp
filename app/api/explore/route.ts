import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  EXPLORE_CATALOG,
  filterCatalog,
  ExploreCategory,
  ExploreMediaFilter,
  ExploreItem,
} from '@/lib/explore-catalog'
import { isTag, Tag } from '@/lib/tags'

export const runtime = 'nodejs'

function isExploreCategory(value: string): value is ExploreCategory {
  return ['inspiration', 'visual_reference', 'stock', 'mockups_templates'].includes(value)
}

function isMediaFilter(value: string): value is ExploreMediaFilter {
  return ['all', 'images', 'videos', 'design', 'fonts', 'tool'].includes(value)
}

async function loadFixtureBoard(slug: string) {
  const safeName = slug.replace(/[^a-z0-9-]/g, '')
  const filePath = join(process.cwd(), 'fixtures', 'boards', `${safeName}.json`)
  try {
    const raw = await readFile(filePath, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function querySupabase(params: {
  category?: ExploreCategory
  mediaType?: ExploreMediaFilter
  query?: string
  tag?: Tag
}): Promise<ExploreItem[] | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return null

  try {
    // Dynamic import to avoid issues if supabase isn't configured
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    let query_builder = supabase.from('explore_items').select('*')

    if (params.category) {
      query_builder = query_builder.eq('category', params.category)
    }

    if (params.mediaType && params.mediaType !== 'all') {
      query_builder = query_builder.eq('media_type', params.mediaType)
    }

    if (params.tag) {
      query_builder = query_builder.contains('extracted_tags', [params.tag])
    }

    if (params.query) {
      query_builder = query_builder.or(
        `title.ilike.%${params.query}%,description.ilike.%${params.query}%,source_name.ilike.%${params.query}%`
      )
    }

    query_builder = query_builder.order('created_at', { ascending: false }).limit(100)

    const { data, error } = await query_builder
    if (error) throw error
    return (data ?? []) as ExploreItem[]
  } catch {
    return null
  }
}

function deduplicateById(items: ExploreItem[]): ExploreItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const rawBranch = searchParams.get('branch') ?? undefined
  const rawSubBranch = searchParams.get('subBranch') ?? undefined
  const rawCategory = searchParams.get('category') ?? undefined
  const rawMediaType = searchParams.get('mediaType') ?? undefined
  const rawQuery = searchParams.get('q') ?? undefined
  const rawTag = searchParams.get('tag') ?? undefined
  const templateSlug = searchParams.get('template') ?? undefined

  // If a specific template board was requested, return its fixture payload
  if (templateSlug) {
    const board = await loadFixtureBoard(templateSlug)
    if (!board) {
      return NextResponse.json({ error: 'Template not found.' }, { status: 404 })
    }
    return NextResponse.json({ template: board, slug: templateSlug })
  }

  const branch = (rawBranch as any) || (rawCategory as any) || undefined
  const subBranch = rawSubBranch || undefined
  const category = rawCategory && isExploreCategory(rawCategory) ? rawCategory : undefined
  const mediaType = rawMediaType && isMediaFilter(rawMediaType) ? rawMediaType : undefined
  const tag = rawTag && isTag(rawTag) ? rawTag : undefined
  const query = rawQuery?.trim() || undefined

  // Try Supabase first, fall back to local catalog
  const supabaseItems = await querySupabase({ category, mediaType, query, tag })
  const catalogItems = filterCatalog({ branch, subBranch, category, mediaType, query, tag })

  // Merge Supabase results with local catalog (supabase takes priority)
  const merged = supabaseItems
    ? deduplicateById([...supabaseItems, ...catalogItems])
    : catalogItems

  // Resolve board_template items: attach the fixture brief as a preview
  const enriched = await Promise.all(
    merged.map(async (item) => {
      if (item.item_kind === 'board_template' && item.template_slug) {
        const board = await loadFixtureBoard(item.template_slug)
        if (board) {
          return { ...item, _template_brief: board.brief }
        }
      }
      return item
    })
  )

  return NextResponse.json({ items: enriched })
}
