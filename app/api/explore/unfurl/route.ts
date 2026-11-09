import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

const OG_IMAGE_REGEX = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
const OG_TITLE_REGEX = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
const OG_SITE_NAME_REGEX = /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i
const TITLE_TAG_REGEX = /<title[^>]*>([^<]+)<\/title>/i

// Also support reversed attribute order (content before property)
const OG_IMAGE_REGEX_ALT = /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i
const OG_TITLE_REGEX_ALT = /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i
const OG_SITE_NAME_REGEX_ALT = /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i

function extractMeta(html: string, primary: RegExp, alt: RegExp): string | null {
  const match = html.match(primary) ?? html.match(alt)
  return match?.[1]?.trim() || null
}

function isDirectImageUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase()
    return /\.(jpg|jpeg|png|gif|webp|avif|svg|bmp|tiff?)$/i.test(path)
  } catch {
    return false
  }
}

function resolveUrl(relative: string, base: string): string {
  try {
    return new URL(relative, base).href
  } catch {
    return relative
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const inputUrl = typeof body.url === 'string' ? body.url.trim() : ''

    if (!inputUrl) {
      return NextResponse.json({ error: 'Provide a URL to unfurl.' }, { status: 400 })
    }

    let parsed: URL
    try {
      parsed = new URL(inputUrl)
    } catch {
      return NextResponse.json({ error: 'Invalid URL.' }, { status: 400 })
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return NextResponse.json({ error: 'Only HTTP/HTTPS URLs are supported.' }, { status: 400 })
    }

    // If the URL is already a direct image link, return it immediately
    if (isDirectImageUrl(inputUrl)) {
      return NextResponse.json({
        image_url: inputUrl,
        title: null,
        site_name: parsed.hostname,
        source_url: inputUrl,
        is_direct_image: true,
      })
    }

    // Fetch the page and extract OG metadata
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)

    let html: string
    try {
      const response = await fetch(inputUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MoodboardBot/1.0)',
          Accept: 'text/html,application/xhtml+xml,*/*',
        },
        redirect: 'follow',
        signal: controller.signal,
      })

      // If the response is an image, treat it as a direct image
      const contentType = response.headers.get('content-type') ?? ''
      if (contentType.startsWith('image/')) {
        clearTimeout(timeout)
        return NextResponse.json({
          image_url: inputUrl,
          title: null,
          site_name: parsed.hostname,
          source_url: inputUrl,
          is_direct_image: true,
        })
      }

      if (!response.ok) {
        clearTimeout(timeout)
        return NextResponse.json({ error: `Could not fetch URL (${response.status}).` }, { status: 502 })
      }

      // Only read the first ~256KB to extract OG tags
      const reader = response.body?.getReader()
      if (!reader) {
        clearTimeout(timeout)
        return NextResponse.json({ error: 'Could not read response body.' }, { status: 502 })
      }

      const chunks: Uint8Array[] = []
      let totalBytes = 0
      const maxBytes = 256 * 1024

      while (totalBytes < maxBytes) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        totalBytes += value.length
      }
      reader.cancel().catch(() => null)

      html = new TextDecoder('utf-8', { fatal: false }).decode(
        chunks.length === 1 ? chunks[0] : Buffer.concat(chunks)
      )
    } finally {
      clearTimeout(timeout)
    }

    const ogImage = extractMeta(html, OG_IMAGE_REGEX, OG_IMAGE_REGEX_ALT)
    const ogTitle = extractMeta(html, OG_TITLE_REGEX, OG_TITLE_REGEX_ALT)
    const ogSiteName = extractMeta(html, OG_SITE_NAME_REGEX, OG_SITE_NAME_REGEX_ALT)
    const titleTag = html.match(TITLE_TAG_REGEX)?.[1]?.trim() || null

    const imageUrl = ogImage ? resolveUrl(ogImage, inputUrl) : null
    const title = ogTitle || titleTag
    const siteName = ogSiteName || parsed.hostname

    if (!imageUrl) {
      return NextResponse.json({
        image_url: null,
        title,
        site_name: siteName,
        source_url: inputUrl,
        is_direct_image: false,
        error: 'No og:image found on this page.',
      })
    }

    return NextResponse.json({
      image_url: imageUrl,
      title,
      site_name: siteName,
      source_url: inputUrl,
      is_direct_image: false,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unfurl failed.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
