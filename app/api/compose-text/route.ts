import { NextRequest } from 'next/server'
import * as opentype from 'opentype.js'
import sharp from 'sharp'
import {
  OUTPUT_BUCKET,
  createServiceSupabaseClient,
  createServiceSupabaseClientWithBucket,
} from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_COMPOSE_REQUESTS_PER_WINDOW = 8
const MAX_COMPOSITIONS_PER_USER = 80
const COMPOSE_RATE_LIMIT_WINDOW_MS = 60_000
const COMPOSE_TIMEOUT_MS = 60_000
const FETCH_TIMEOUT_MS = 25_000
const MAX_FONT_BYTES = 8 * 1024 * 1024
const MAX_IMAGE_BYTES = 24 * 1024 * 1024
const GOOGLE_FONTS_TTL_MS = 12 * 60 * 60 * 1000
const namedColors = new Set(['black', 'white', 'red', 'green', 'blue', 'yellow', 'orange', 'purple', 'pink', 'gray'])
const colorPattern = /^#[0-9a-fA-F]{3,8}$/
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>()
const compositionCounts = new Map<string, number>()

type ComposeTextRequest = {
  imageUrl?: string
  text?: string
  fontName?: string
  fontUrl?: string
  fontWeight?: number
  fontSizeRatio?: number
  color?: string
  x?: number
  y?: number
  outlineColor?: string
  outlineWidthRatio?: number
}

type GoogleFontItem = {
  family: string
  files: Record<string, string>
}

type GoogleFontsCache = {
  expiresAt: number
  items: GoogleFontItem[]
}

let googleFontsCache: GoogleFontsCache | null = null

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s.`)), timeoutMs)
    }),
  ])
}

async function getRequesterKey(request: NextRequest) {
  const authorization = request.headers.get('authorization')
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]

  if (token) {
    const supabase = createServiceSupabaseClient()
    const { data } = await supabase.auth.getUser(token)
    if (data.user) return `user:${data.user.id}`
  }

  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const realIp = request.headers.get('x-real-ip')?.trim()
  return `ip:${forwardedFor || realIp || 'local'}`
}

function checkRateLimit(key: string) {
  const now = Date.now()
  const bucket = rateLimitBuckets.get(key)

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + COMPOSE_RATE_LIMIT_WINDOW_MS })
    return null
  }

  if (bucket.count >= MAX_COMPOSE_REQUESTS_PER_WINDOW) {
    return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
  }

  bucket.count += 1
  return null
}

function getUrl(value: string, label: string, protocols = ['https:']) {
  try {
    const url = new URL(value)
    if (!protocols.includes(url.protocol)) {
      throw new Error(`${label} must use ${protocols.join(' or ')}.`)
    }
    return url
  } catch (error) {
    if (error instanceof Error && error.message.includes('must use')) throw error
    throw new Error(`${label} must be a valid URL.`)
  }
}

function validateColor(value: string, label: string) {
  const trimmed = value.trim()
  if (colorPattern.test(trimmed) || namedColors.has(trimmed.toLowerCase())) return trimmed
  throw new Error(`${label} must be a hex color or a supported named color.`)
}

function clamp(value: number | undefined, min: number, max: number, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function isFontContentType(contentType: string | null, pathname: string) {
  if (pathname.toLowerCase().endsWith('.woff2')) return false
  if (/\.(ttf|otf|woff)$/i.test(pathname)) return true
  if (!contentType) return false

  const normalized = contentType.toLowerCase().split(';')[0].trim()
  return [
    'font/ttf',
    'font/otf',
    'font/woff',
    'application/font-sfnt',
    'application/font-woff',
    'application/x-font-ttf',
    'application/x-font-otf',
    'application/x-font-woff',
  ].includes(normalized)
}

async function fetchBuffer(url: string, label: string, maxBytes: number) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`Could not fetch ${label} (${response.status}).`)

    const contentLength = Number(response.headers.get('content-length') ?? 0)
    if (contentLength > maxBytes) {
      throw new Error(`${label} is too large. Maximum size is ${Math.round(maxBytes / 1024 / 1024)} MB.`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.byteLength > maxBytes) {
      throw new Error(`${label} is too large. Maximum size is ${Math.round(maxBytes / 1024 / 1024)} MB.`)
    }

    return { buffer, contentType: response.headers.get('content-type') }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${label} fetch timed out.`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function getGoogleFonts() {
  const now = Date.now()
  if (googleFontsCache && googleFontsCache.expiresAt > now) return googleFontsCache.items

  const key = process.env.GOOGLE_FONTS_API_KEY
  if (!key) {
    throw new Error('Missing GOOGLE_FONTS_API_KEY. Paste a direct .ttf, .otf, or .woff font URL instead.')
  }

  const response = await fetch(
    `https://www.googleapis.com/webfonts/v1/webfonts?key=${encodeURIComponent(key)}`,
    { next: { revalidate: 43_200 } }
  )
  if (!response.ok) throw new Error(`Could not fetch Google Fonts list (${response.status}).`)

  const data = (await response.json()) as { items?: GoogleFontItem[] }
  const items = data.items ?? []
  googleFontsCache = { items, expiresAt: now + GOOGLE_FONTS_TTL_MS }
  return items
}

function pickGoogleFontFile(font: GoogleFontItem, fontWeight: number) {
  const weightKey = fontWeight === 400 ? 'regular' : String(fontWeight)
  return font.files[weightKey] ?? font.files.regular ?? Object.values(font.files)[0]
}

async function resolveFontBuffer({
  fontName,
  fontUrl,
  fontWeight,
}: {
  fontName?: string
  fontUrl?: string
  fontWeight: number
}) {
  if (fontUrl) {
    const url = getUrl(fontUrl, 'Font URL')
    if (url.pathname.toLowerCase().endsWith('.woff2')) {
      throw new Error('WOFF2 font URLs are not supported yet. Use a .ttf, .otf, or .woff URL.')
    }

    const font = await fetchBuffer(url.toString(), 'font file', MAX_FONT_BYTES)
    if (!isFontContentType(font.contentType, url.pathname)) {
      throw new Error('Font URL must point to a .ttf, .otf, or .woff file.')
    }
    return font.buffer
  }

  if (!fontName) throw new Error('Enter a Google Fonts name or paste a direct font-file URL.')

  const fonts = await getGoogleFonts()
  const font = fonts.find((item) => item.family.toLowerCase() === fontName.toLowerCase())
  if (!font) {
    throw new Error(`Google Font "${fontName}" was not found. Paste a direct font-file URL instead.`)
  }

  const file = pickGoogleFontFile(font, fontWeight)
  if (!file) throw new Error(`Google Font "${fontName}" does not have a downloadable file.`)

  const url = new URL(file)
  if (url.protocol === 'http:' && url.hostname === 'fonts.gstatic.com') url.protocol = 'https:'
  if (url.pathname.toLowerCase().endsWith('.woff2')) {
    throw new Error('Google returned a WOFF2 font, which is not supported yet. Paste a .ttf, .otf, or .woff URL.')
  }

  const downloaded = await fetchBuffer(url.toString(), 'Google font file', MAX_FONT_BYTES)
  return downloaded.buffer
}

function svgPathFromFont({
  fontBuffer,
  text,
  width,
  height,
  fontSizeRatio,
  x,
  y,
  color,
  outlineColor,
  outlineWidthRatio,
}: {
  fontBuffer: Buffer
  text: string
  width: number
  height: number
  fontSizeRatio: number
  x: number
  y: number
  color: string
  outlineColor?: string
  outlineWidthRatio: number
}) {
  const fontData = fontBuffer.buffer.slice(fontBuffer.byteOffset, fontBuffer.byteOffset + fontBuffer.byteLength)
  const font = opentype.parse(fontData)
  const fontSize = fontSizeRatio * height
  const probe = font.getPath(text, 0, 0, fontSize).getBoundingBox()
  const textWidth = probe.x2 - probe.x1
  const textHeight = probe.y2 - probe.y1

  if (!Number.isFinite(textWidth) || !Number.isFinite(textHeight) || textWidth <= 0 || textHeight <= 0) {
    throw new Error('Could not render that text with the selected font.')
  }

  const path = font.getPath(text, x * width - textWidth / 2 - probe.x1, y * height - textHeight / 2 - probe.y1, fontSize)
  const d = path.toPathData(2)
  const stroke = outlineColor
    ? `stroke="${outlineColor}" stroke-width="${Math.max(1, outlineWidthRatio * fontSize).toFixed(2)}" stroke-linejoin="round" paint-order="stroke fill"`
    : ''

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><path d="${d}" fill="${color}" ${stroke}/></svg>`
}

async function storeComposition(buffer: Buffer, width: number, height: number) {
  const supabase = await createServiceSupabaseClientWithBucket(OUTPUT_BUCKET)
  const path = `compositions/${Date.now()}-${crypto.randomUUID()}.png`
  const { error } = await supabase.storage.from(OUTPUT_BUCKET).upload(path, buffer, {
    contentType: 'image/png',
    upsert: false,
  })

  if (error) throw error

  const { data } = supabase.storage.from(OUTPUT_BUCKET).getPublicUrl(path)
  return { url: data.publicUrl, width, height }
}

async function composeText(body: ComposeTextRequest) {
  const imageUrl = body.imageUrl?.trim()
  const text = body.text?.trim()
  const fontName = body.fontName?.trim()
  const fontUrl = body.fontUrl?.trim()

  if (!imageUrl) throw new Error('Choose a generated output first.')
  if (!text) throw new Error('Enter headline text to compose.')
  if (text.length > 120) throw new Error('Headline text must be 120 characters or fewer.')
  if (Boolean(fontName) === Boolean(fontUrl)) {
    throw new Error('Enter either a Google Fonts name or a direct font-file URL, not both.')
  }

  const imageSource = getUrl(imageUrl, 'Image URL', ['http:', 'https:'])
  const color = validateColor(body.color ?? '#ffffff', 'Text color')
  const outlineColor = body.outlineColor ? validateColor(body.outlineColor, 'Outline color') : undefined
  const fontWeight = Math.round(clamp(body.fontWeight, 100, 900, 400))
  const fontSizeRatio = clamp(body.fontSizeRatio, 0.02, 0.5, 0.12)
  const x = clamp(body.x, 0, 1, 0.5)
  const y = clamp(body.y, 0, 1, 0.5)
  const outlineWidthRatio = clamp(body.outlineWidthRatio, 0, 0.2, 0.04)
  const baseImage = await fetchBuffer(imageSource.toString(), 'base image', MAX_IMAGE_BYTES)

  if (baseImage.contentType && !baseImage.contentType.startsWith('image/')) {
    throw new Error('The selected output did not return an image.')
  }

  const metadata = await sharp(baseImage.buffer).metadata()
  const width = metadata.width
  const height = metadata.height
  if (!width || !height) throw new Error('Could not read selected output dimensions.')

  const fontBuffer = await resolveFontBuffer({ fontName, fontUrl, fontWeight })
  const svg = svgPathFromFont({
    fontBuffer,
    text,
    width,
    height,
    fontSizeRatio,
    x,
    y,
    color,
    outlineColor,
    outlineWidthRatio,
  })
  const output = await sharp(baseImage.buffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer()

  return storeComposition(output, width, height)
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ComposeTextRequest
    const requesterKey = await getRequesterKey(request)
    const retryAfter = checkRateLimit(requesterKey)

    if (retryAfter) {
      return Response.json(
        { error: `Too many text composition requests. Try again in ${retryAfter}s.` },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      )
    }

    const used = compositionCounts.get(requesterKey) ?? 0
    if (used >= MAX_COMPOSITIONS_PER_USER) {
      return Response.json({ error: 'Text composition cap reached.' }, { status: 429 })
    }
    compositionCounts.set(requesterKey, used + 1)

    const result = await withTimeout(composeText(body), COMPOSE_TIMEOUT_MS, 'Text composition')
    return Response.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Text composition failed.'
    const status = /rate|cap/.test(message.toLowerCase()) ? 429 : 400
    return Response.json({ error: message }, { status })
  }
}
