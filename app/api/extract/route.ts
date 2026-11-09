import { NextRequest } from 'next/server'
import { extractForegroundGrabCut } from '@/lib/grabcut-server'
import { ELEMENT_BUCKET, createServiceSupabaseClientWithBucket } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const RATE_LIMIT_WINDOW_MS = 60_000
const MAX_REQUESTS_PER_WINDOW = 6
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>()

function getClientKey(request: NextRequest) {
  return request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}

function checkRateLimit(key: string) {
  const now = Date.now()
  const bucket = rateLimitBuckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return null
  }
  if (bucket.count >= MAX_REQUESTS_PER_WINDOW) {
    return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
  }
  bucket.count += 1
  return null
}

async function fetchImageBuffer(sourceUrl: string) {
  if (sourceUrl.startsWith('data:')) {
    const match = sourceUrl.match(/^data:(image\/[a-z\d.+-]+);base64,([\s\S]*)$/i)
    if (!match) throw new Error('Provide a base64-encoded image data URL.')
    if (match[2].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 8) {
      throw new Error('Image is larger than 12MB.')
    }
    const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64')
    return { buffer, contentType: match[1].toLowerCase() }
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(sourceUrl)
  } catch {
    throw new Error('Provide a valid image URL.')
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (
    parsedUrl.protocol !== 'https:' ||
    !supabaseUrl ||
    parsedUrl.hostname !== new URL(supabaseUrl).hostname ||
    parsedUrl.username ||
    parsedUrl.password ||
    !parsedUrl.pathname.startsWith('/storage/v1/object/public/moodboard-imports/')
  ) {
    throw new Error('Server extraction only accepts HTTPS images stored in this app.')
  }

  const response = await fetch(parsedUrl, {
    redirect: 'error',
    headers: {
      accept: 'image/*',
      'user-agent': 'Moodblendy image extraction/1.0',
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`Could not fetch source image (${response.status}).`)

  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? ''
  if (!contentType.startsWith('image/')) throw new Error('The source URL did not return an image.')
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
    throw new Error('Image is larger than 12MB.')
  }
  if (!response.body) throw new Error('The source image response was empty.')

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel()
      throw new Error('Image is larger than 12MB.')
    }
    chunks.push(value)
  }
  return { buffer: Buffer.concat(chunks), contentType }
}

async function storeElement(buffer: Buffer) {
  const supabase = await createServiceSupabaseClientWithBucket(ELEMENT_BUCKET)
  const path = `elements/${Date.now()}-${crypto.randomUUID()}.png`
  const { error } = await supabase.storage.from(ELEMENT_BUCKET).upload(path, buffer, {
    contentType: 'image/png',
    upsert: false,
  })
  if (error) throw error

  return supabase.storage.from(ELEMENT_BUCKET).getPublicUrl(path).data.publicUrl
}

export async function POST(request: NextRequest) {
  const bodyLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(bodyLength) && bodyLength > MAX_IMAGE_BYTES * 2) {
    return Response.json({ error: 'Extraction request is too large.' }, { status: 413 })
  }

  const retryAfter = checkRateLimit(getClientKey(request))
  if (retryAfter) {
    return Response.json(
      { error: `Too many local extraction requests. Try again in ${retryAfter}s.` },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    )
  }

  try {
    const body = (await request.json()) as { sourceUrl?: string }
    if (typeof body.sourceUrl !== 'string' || !body.sourceUrl) {
      return Response.json({ error: 'Provide sourceUrl.' }, { status: 400 })
    }

    const source = await fetchImageBuffer(body.sourceUrl)
    if (source.buffer.byteLength > MAX_IMAGE_BYTES) {
      return Response.json({ error: 'Image is larger than 12MB.' }, { status: 413 })
    }

    const cutout = await extractForegroundGrabCut(source.buffer)
    const url = await storeElement(cutout.buffer)
    return Response.json({ url, width: cutout.width, height: cutout.height })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Local extraction failed.'
    const status = /valid image URL|base64-encoded|only accepts|did not return an image|Provide sourceUrl/i.test(message)
      ? 400
      : /larger than 12MB/i.test(message)
        ? 413
        : 500
    return Response.json({ error: message }, { status })
  }
}
