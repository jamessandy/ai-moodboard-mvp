import { fal } from '@fal-ai/client'
import { NextRequest } from 'next/server'
import sharp from 'sharp'
import {
  ELEMENT_BUCKET,
  createServiceSupabaseClient,
  createServiceSupabaseClientWithBucket,
} from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_EXTRACT_REQUESTS_PER_WINDOW = Number(process.env.MAX_EXTRACT_REQUESTS_PER_WINDOW ?? 8)
const MAX_EXTRACTIONS_PER_USER = Number(process.env.MAX_EXTRACTIONS_PER_USER ?? 80)
const EXTRACT_RATE_LIMIT_WINDOW_MS = Number(process.env.EXTRACT_RATE_LIMIT_WINDOW_MS ?? 60_000)
const EXTRACTION_TIMEOUT_MS = Number(process.env.EXTRACTION_TIMEOUT_MS ?? 180_000)
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>()
const extractionCounts = new Map<string, number>()

type ExtractRequest = {
  sourceUrl: string
  mode: 'subject' | 'describe'
  prompt?: string
}

type ExtractResult = {
  image?: {
    url?: string
    width?: number
    height?: number
  }
  mask?: {
    url?: string
    width?: number
    height?: number
  }
  images?: Array<{
    url?: string
    width?: number
    height?: number
  }>
}

type CutoutResult = {
  buffer: Buffer
  width: number
  height: number
}

type MaskAnalysis = {
  buffer: Buffer
  width: number
  height: number
  keepRatio: number
  box: { left: number; top: number; width: number; height: number } | null
  source: 'luminance' | 'inverted-luminance' | 'alpha' | 'inverted-alpha'
}

const DEFAULT_SUBJECT_PROMPT =
  'only the main subject object or character, excluding background, room, floor, window, frame, decoration, and other objects'
const MIN_MASK_KEEP_RATIO = 0.002
const INVERTED_MASK_KEEP_RATIO = 0.55
const ALPHA_THRESHOLD = 4
const MASK_FOREGROUND_THRESHOLD = 128
const MASK_FEATHER_RADIUS = 0.7

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s.`)), timeoutMs)
    }),
  ])
}

async function requesterKey(request: NextRequest) {
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
    rateLimitBuckets.set(key, { count: 1, resetAt: now + EXTRACT_RATE_LIMIT_WINDOW_MS })
    return null
  }

  if (bucket.count >= MAX_EXTRACT_REQUESTS_PER_WINDOW) {
    return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
  }

  bucket.count += 1
  return null
}

async function fetchImageBuffer(url: string, label: string) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Could not fetch ${label} (${response.status}).`)
  }

  const contentType = response.headers.get('content-type')
  if (contentType && !contentType.startsWith('image/')) {
    throw new Error(`${label} was not an image.`)
  }

  return Buffer.from(await response.arrayBuffer())
}

async function storeElement(cutout: CutoutResult) {
  const supabase = await createServiceSupabaseClientWithBucket(ELEMENT_BUCKET)
  const path = `elements/${Date.now()}-${crypto.randomUUID()}.png`
  const { error } = await supabase.storage.from(ELEMENT_BUCKET).upload(path, cutout.buffer, {
    contentType: 'image/png',
    upsert: false,
  })

  if (error) throw error

  const { data } = supabase.storage.from(ELEMENT_BUCKET).getPublicUrl(path)
  return data.publicUrl
}

function getFalImageUrl(result: ExtractResult) {
  return result.mask?.url ?? result.image?.url ?? result.images?.find((image) => image.url)?.url
}

async function getEvfSamMask(sourceUrl: string, prompt: string, revertMask = false) {
  const result = await fal.subscribe('fal-ai/evf-sam', {
    input: {
      prompt,
      image_url: sourceUrl,
      mask_only: true,
      fill_holes: true,
      expand_mask: 0,
      ...(revertMask ? { revert_mask: true } : {}),
    },
  })

  const maskUrl = getFalImageUrl(result.data as ExtractResult)
  if (!maskUrl) {
    throw new Error('No segmentation mask was returned.')
  }

  return fetchImageBuffer(maskUrl, 'segmentation mask')
}

async function analyzeMask(maskBuffer: Buffer, width: number, height: number): Promise<MaskAnalysis> {
  const { data } = await sharp(maskBuffer)
    .resize(width, height, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const candidates: MaskAnalysis[] = await Promise.all([
    createMaskCandidate(data, width, height, 'luminance', (r, g, b) => Math.round((r + g + b) / 3)),
    createMaskCandidate(data, width, height, 'inverted-luminance', (r, g, b) => 255 - Math.round((r + g + b) / 3)),
    createMaskCandidate(data, width, height, 'alpha', (_r, _g, _b, a) => a),
    createMaskCandidate(data, width, height, 'inverted-alpha', (_r, _g, _b, a) => 255 - a),
  ])

  const valid = candidates.filter((candidate) => candidate.box && candidate.keepRatio >= MIN_MASK_KEEP_RATIO)
  if (!valid.length) {
    return { ...candidates[0], box: null, keepRatio: 0 }
  }

  const plausible = valid.filter((candidate) => candidate.keepRatio <= INVERTED_MASK_KEEP_RATIO)
  return [...(plausible.length ? plausible : valid)].sort(
    (a, b) => Math.abs(a.keepRatio - 0.2) - Math.abs(b.keepRatio - 0.2)
  )[0]
}

async function createMaskCandidate(
  data: Buffer,
  width: number,
  height: number,
  source: MaskAnalysis['source'],
  valueFromPixel: (r: number, g: number, b: number, a: number) => number
): Promise<MaskAnalysis> {
  const binary = Uint8Array.from({ length: width * height }, (_, index) => {
    const rawIndex = index * 4
    const value = valueFromPixel(data[rawIndex], data[rawIndex + 1], data[rawIndex + 2], data[rawIndex + 3])
    return value >= MASK_FOREGROUND_THRESHOLD ? 255 : 0
  })
  const cleaned = keepLargestConnectedComponent(fillMaskHoles(binary, width, height), width, height)
  const alpha = await featherMask(cleaned, width, height)
  const bounds = getMaskBounds(alpha, width, height)

  return {
    buffer: alpha,
    width,
    height,
    source,
    keepRatio: bounds.kept / (width * height),
    box: bounds.box,
  }
}

function getMaskBounds(mask: Buffer | Uint8Array, width: number, height: number) {
  let kept = 0
  let left = width
  let top = height
  let right = -1
  let bottom = -1

  for (let index = 0; index < width * height; index += 1) {
    if (mask[index] <= ALPHA_THRESHOLD) continue

    kept += 1
    const x = index % width
    const y = Math.floor(index / width)
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, x)
    bottom = Math.max(bottom, y)
  }

  return {
    kept,
    box:
      right >= left && bottom >= top
        ? { left, top, width: right - left + 1, height: bottom - top + 1 }
        : null,
  }
}

function fillMaskHoles(mask: Uint8Array, width: number, height: number) {
  const visited = new Uint8Array(width * height)
  const queue: number[] = []
  const enqueueBackground = (index: number) => {
    if (mask[index] || visited[index]) return
    visited[index] = 1
    queue.push(index)
  }

  for (let x = 0; x < width; x += 1) {
    enqueueBackground(x)
    enqueueBackground((height - 1) * width + x)
  }
  for (let y = 0; y < height; y += 1) {
    enqueueBackground(y * width)
    enqueueBackground(y * width + width - 1)
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor]
    const x = index % width
    const y = Math.floor(index / width)
    if (x > 0) enqueueBackground(index - 1)
    if (x < width - 1) enqueueBackground(index + 1)
    if (y > 0) enqueueBackground(index - width)
    if (y < height - 1) enqueueBackground(index + width)
  }

  const filled = new Uint8Array(mask)
  for (let index = 0; index < filled.length; index += 1) {
    if (!filled[index] && !visited[index]) filled[index] = 255
  }
  return filled
}

function keepLargestConnectedComponent(mask: Uint8Array, width: number, height: number) {
  const labels = new Int32Array(width * height)
  let bestStart = -1
  let bestSize = 0
  let label = 0
  const queue: number[] = []

  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index] || labels[index]) continue

    label += 1
    let size = 0
    queue.length = 0
    queue.push(index)
    labels[index] = label

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor]
      size += 1
      const x = current % width
      const y = Math.floor(current / width)
      const neighbors = [
        x > 0 ? current - 1 : -1,
        x < width - 1 ? current + 1 : -1,
        y > 0 ? current - width : -1,
        y < height - 1 ? current + width : -1,
      ]

      for (const next of neighbors) {
        if (next < 0 || !mask[next] || labels[next]) continue
        labels[next] = label
        queue.push(next)
      }
    }

    if (size > bestSize) {
      bestSize = size
      bestStart = label
    }
  }

  const kept = new Uint8Array(mask.length)
  if (bestStart < 0) return kept

  for (let index = 0; index < labels.length; index += 1) {
    if (labels[index] === bestStart) kept[index] = 255
  }
  return kept
}

async function featherMask(mask: Uint8Array, width: number, height: number) {
  return sharp(Buffer.from(mask), { raw: { width, height, channels: 1 } })
    .median(3)
    .blur(MASK_FEATHER_RADIUS)
    .greyscale()
    .raw()
    .toBuffer()
}

async function createTransparentCutout(sourceBuffer: Buffer, maskBuffer: Buffer): Promise<CutoutResult> {
  const normalizedSource = await sharp(sourceBuffer).rotate().png().toBuffer()
  const metadata = await sharp(normalizedSource).metadata()
  const width = metadata.width
  const height = metadata.height

  if (!width || !height) {
    throw new Error('Could not read source image dimensions.')
  }

  const mask = await analyzeMask(maskBuffer, width, height)
  if (!mask.box || mask.keepRatio < MIN_MASK_KEEP_RATIO) {
    throw new Error('The segmentation mask did not contain a usable object.')
  }

  const croppedMask = cropMaskBuffer(mask.buffer, width, mask.box)
  const croppedSource = await sharp(normalizedSource).extract(mask.box).removeAlpha().png().toBuffer()
  const { data, info } = await sharp(croppedSource)
    .joinChannel(croppedMask, { raw: { width: mask.box.width, height: mask.box.height, channels: 1 } })
    .png()
    .toBuffer({ resolveWithObject: true })

  return { buffer: data, width: info.width, height: info.height }
}

function cropMaskBuffer(
  mask: Buffer,
  sourceWidth: number,
  box: { left: number; top: number; width: number; height: number }
) {
  const cropped = Buffer.alloc(box.width * box.height)

  for (let y = 0; y < box.height; y += 1) {
    const sourceStart = (box.top + y) * sourceWidth + box.left
    const targetStart = y * box.width
    mask.copy(cropped, targetStart, sourceStart, sourceStart + box.width)
  }

  return cropped
}

async function trimTransparentCutout(buffer: Buffer): Promise<CutoutResult> {
  const normalized = await sharp(buffer).rotate().ensureAlpha().png().toBuffer()
  const metadata = await sharp(normalized).metadata()
  const width = metadata.width
  const height = metadata.height

  if (!width || !height) {
    throw new Error('Could not read extracted image dimensions.')
  }

  const { data } = await sharp(normalized).raw().toBuffer({ resolveWithObject: true })
  let left = width
  let top = height
  let right = -1
  let bottom = -1

  for (let index = 3; index < data.length; index += 4) {
    if (data[index] <= ALPHA_THRESHOLD) continue

    const pixel = (index - 3) / 4
    const x = pixel % width
    const y = Math.floor(pixel / width)
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, x)
    bottom = Math.max(bottom, y)
  }

  if (right < left || bottom < top) {
    throw new Error('The extracted image did not contain visible pixels.')
  }

  const box = { left, top, width: right - left + 1, height: bottom - top + 1 }
  const { data: trimmed, info } = await sharp(normalized)
    .extract(box)
    .png()
    .toBuffer({ resolveWithObject: true })

  return { buffer: trimmed, width: info.width, height: info.height }
}

async function extractWithBirefnetFallback(sourceUrl: string): Promise<CutoutResult> {
  const result = await fal.subscribe('fal-ai/birefnet', {
    input: {
      image_url: sourceUrl,
      model: 'General Use (Heavy)',
      operating_resolution: '1024x1024',
      refine_foreground: true,
      output_format: 'png',
    },
  })

  const imageUrl = getFalImageUrl(result.data as ExtractResult)
  if (!imageUrl) {
    throw new Error('Fallback extraction did not return an image URL.')
  }

  return trimTransparentCutout(await fetchImageBuffer(imageUrl, 'fallback extracted element'))
}

async function extractWithFal(body: ExtractRequest): Promise<CutoutResult> {
  if (!process.env.FAL_KEY) throw new Error('Missing FAL_KEY.')
  fal.config({ credentials: process.env.FAL_KEY })

  const requestedPrompt = body.prompt?.trim()
  if (body.mode === 'describe' && !requestedPrompt) throw new Error('Describe the object to extract.')

  const prompt =
    body.mode === 'describe'
      ? `only ${requestedPrompt}, excluding background, room, floor, window, frame, decoration, and other objects`
      : DEFAULT_SUBJECT_PROMPT

  const sourceBuffer = await fetchImageBuffer(body.sourceUrl, 'source image')

  try {
    const maskBuffer = await getEvfSamMask(body.sourceUrl, prompt)
    const metadata = await sharp(sourceBuffer).rotate().metadata()

    if (!metadata.width || !metadata.height) {
      throw new Error('Could not read source image dimensions.')
    }

    const mask = await analyzeMask(maskBuffer, metadata.width, metadata.height)
    const finalMaskBuffer =
      mask.keepRatio > INVERTED_MASK_KEEP_RATIO
        ? await getEvfSamMask(body.sourceUrl, prompt, true)
        : maskBuffer

    return createTransparentCutout(sourceBuffer, finalMaskBuffer)
  } catch (error) {
    if (body.mode !== 'subject') throw error
    return extractWithBirefnetFallback(body.sourceUrl)
  }
}

export async function POST(request: NextRequest) {
  try {
    const key = await requesterKey(request)
    const retryAfter = checkRateLimit(key)
    if (retryAfter) {
      return Response.json(
        { error: `Too many extraction requests. Try again in ${retryAfter}s.` },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      )
    }

    const body = (await request.json()) as ExtractRequest
    if (!body.sourceUrl || !['subject', 'describe'].includes(body.mode)) {
      return Response.json({ error: 'Provide sourceUrl and extraction mode.' }, { status: 400 })
    }

    const used = extractionCounts.get(key) ?? 0
    if (used >= MAX_EXTRACTIONS_PER_USER) {
      return Response.json({ error: 'Extraction cap reached.' }, { status: 429 })
    }

    const cutout = await withTimeout(extractWithFal(body), EXTRACTION_TIMEOUT_MS, 'Extraction')
    const url = await withTimeout(storeElement(cutout), 30_000, 'Element storage')
    extractionCounts.set(key, used + 1)
    return Response.json({
      url,
      width: cutout.width,
      height: cutout.height,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Extraction failed.'
    return Response.json({ error: message }, { status: 500 })
  }
}
