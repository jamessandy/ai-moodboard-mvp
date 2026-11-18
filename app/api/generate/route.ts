import { NextRequest } from 'next/server'
import sharp from 'sharp'
import { BoardDoc } from '@/lib/board'
import { compileBoardWithMetadata } from '@/lib/assembler'
import { captureServerEvent } from '@/lib/analytics/server'
import { getAuthenticatedUser } from '@/lib/supabase/auth'
import {
  OUTPUT_BUCKET,
  createServiceSupabaseClientWithBucket,
  createServiceSupabaseClient,
} from '@/lib/supabase/server'
import { IMAGES_PER_GENERATION } from '@/lib/usage'
import { quoteFalAction } from '@/lib/credits/pricing'
import { refundCredits, reserveCredits } from '@/lib/credits/wallet'
import { GENERATION_MODEL_ID, MAX_GENERATION_REFERENCES } from '@/lib/generation'

export const runtime = 'nodejs'
export const maxDuration = 300

const MAX_GENERATE_REQUESTS_PER_WINDOW = Number(process.env.MAX_GENERATE_REQUESTS_PER_WINDOW ?? 5)
const RATE_LIMIT_WINDOW_MS = Number(process.env.GENERATE_RATE_LIMIT_WINDOW_MS ?? 60_000)
const GENERATION_TIMEOUT_MS = Number(process.env.GENERATION_TIMEOUT_MS ?? 180_000)
const DEFAULT_RUNPOD_ENDPOINT_ID = 'cu3rkjepnei4j2'
const RUNPOD_REFERENCE_FETCH_TIMEOUT_MS = 20_000
const MAX_REFERENCE_SOURCE_BYTES = 16 * 1024 * 1024
const REFERENCE_SHEET_SIZE = 1024
const REFERENCE_SHEET_GAP = 8
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>()

type GenerateRequest = {
  boardId?: string
  count?: number
  board: BoardDoc
}

type RunpodResponse = {
  id?: string
  status?: string
  output?: unknown
  error?: unknown
}

const encoder = new TextEncoder()

function writeEvent(controller: ReadableStreamDefaultController<Uint8Array>, value: unknown) {
  controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`))
}

function extensionFromType(contentType: string | null) {
  if (!contentType) return 'png'
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg'
  if (contentType.includes('webp')) return 'webp'
  if (contentType.includes('png')) return 'png'
  return 'png'
}

async function storeGeneratedImage(url: string, boardId: string, slot: number) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Could not fetch generated image (${response.status}).`)
  }

  const contentType = response.headers.get('content-type') ?? 'image/png'
  const buffer = Buffer.from(await response.arrayBuffer())
  return storeGeneratedBuffer(buffer, contentType, boardId, slot)
}

async function storeGeneratedBuffer(buffer: Buffer, contentType: string, boardId: string, slot: number) {
  const metadata = await sharp(buffer).metadata()
  const supabase = await createServiceSupabaseClientWithBucket(OUTPUT_BUCKET)
  const path = `${boardId}/${Date.now()}-${slot}-${crypto.randomUUID()}.${extensionFromType(contentType)}`
  const { error } = await supabase.storage.from(OUTPUT_BUCKET).upload(path, buffer, {
    contentType,
    upsert: false,
  })

  if (error) throw error

  const { data } = supabase.storage.from(OUTPUT_BUCKET).getPublicUrl(path)
  return { url: data.publicUrl, width: metadata.width, height: metadata.height }
}

type CompiledGenerationInput = Awaited<ReturnType<typeof compileBoardWithMetadata>>['compiled']

type RunpodImageCandidate = {
  value: string
  contentType?: string
}

type RunpodGenerationInput = {
  prompt: string
  width: number
  height: number
  image: string
  images: string[]
  image_urls: string[]
}

const RUNPOD_IMAGE_KEYS = [
  'image_url',
  'imageUrl',
  'output_url',
  'outputUrl',
  'url',
  'image',
  'output_image',
  'generated_image',
  'image_base64',
  'image_data',
  'message',
  'data',
  'base64',
  'b64_json',
] as const
const RUNPOD_COLLECTION_KEYS = [
  'images',
  'outputs',
  'result',
  'results',
  'artifacts',
  'files',
  'output',
  'response',
  'body',
] as const
const RUNPOD_DIAGNOSTIC_KEYS = new Set(['error', 'errors', 'traceback', 'logs'])

function runpodEndpointUrl() {
  const configuredUrl = process.env.RUNPOD_ENDPOINT_URL?.trim()
  if (configuredUrl) {
    const url = new URL(configuredUrl)
    if (url.protocol !== 'https:' || url.hostname !== 'api.runpod.ai') {
      throw new Error('RUNPOD_ENDPOINT_URL must be an HTTPS api.runpod.ai URL.')
    }
    return url.toString()
  }

  const endpointId = process.env.RUNPOD_ENDPOINT_ID?.trim() || DEFAULT_RUNPOD_ENDPOINT_ID
  return `https://api.runpod.ai/v2/${encodeURIComponent(endpointId)}/runsync`
}

function runpodImageDimension(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(2048, Math.max(256, Math.round(parsed / 64) * 64))
}

function looksLikeImageValue(value: string) {
  const normalized = value.trim()
  return (
    /^https?:\/\//i.test(normalized) ||
    /^data:image\/[a-z0-9.+-]+;base64,/i.test(normalized) ||
    (normalized.length > 256 && /^[a-z0-9+/_=\s-]+$/i.test(normalized))
  )
}

type ReferencePanel = { left: number; top: number; width: number; height: number }

function referencePanelLayout(count: number): ReferencePanel[] {
  if (count <= 1) {
    return [{ left: 0, top: 0, width: REFERENCE_SHEET_SIZE, height: REFERENCE_SHEET_SIZE }]
  }

  const half = Math.floor((REFERENCE_SHEET_SIZE - REFERENCE_SHEET_GAP) / 2)
  if (count === 2) {
    return [
      { left: 0, top: 0, width: half, height: REFERENCE_SHEET_SIZE },
      { left: half + REFERENCE_SHEET_GAP, top: 0, width: half, height: REFERENCE_SHEET_SIZE },
    ]
  }

  const panels = [
    { left: 0, top: 0, width: half, height: half },
    { left: half + REFERENCE_SHEET_GAP, top: 0, width: half, height: half },
    { left: 0, top: half + REFERENCE_SHEET_GAP, width: half, height: half },
    {
      left: half + REFERENCE_SHEET_GAP,
      top: half + REFERENCE_SHEET_GAP,
      width: half,
      height: half,
    },
  ]

  if (count === 3) {
    panels[2] = { ...panels[2], left: Math.floor((REFERENCE_SHEET_SIZE - half) / 2) }
  }
  return panels.slice(0, count)
}

export function runpodReferencePrompt(count: number) {
  const positions =
    count <= 1
      ? ['full-frame reference']
      : count === 2
        ? ['left panel', 'right panel']
        : count === 3
          ? ['top-left panel', 'top-right panel', 'bottom-center panel']
          : ['top-left panel', 'top-right panel', 'bottom-left panel', 'bottom-right panel']
  const mapping = positions.slice(0, count).map((position, index) => `Element ${index + 1} is the ${position}`).join('; ')

  return `Use the attached visual references, not only their text labels. ${mapping}. Treat every panel as a separate source and apply only the role assigned to that Element. Do not reproduce the sheet, panel layout, borders, or unrelated people and backgrounds. Produce one cohesive final image, never a collage.`
}

export async function buildRunpodReferenceSheet(images: Buffer[]) {
  if (!images.length || images.length > MAX_GENERATION_REFERENCES) {
    throw new Error(`FLUX.2 Klein requires between 1 and ${MAX_GENERATION_REFERENCES} reference images.`)
  }

  const layout = referencePanelLayout(images.length)
  const background = { r: 245, g: 245, b: 245 }
  const panels = await Promise.all(
    images.map(async (image, index) => {
      const panel = layout[index]
      const input = await sharp(image)
        .rotate()
        .resize(panel.width, panel.height, { fit: 'contain', background })
        .flatten({ background })
        .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
        .toBuffer()
      return { input, left: panel.left, top: panel.top }
    })
  )

  return sharp({
    create: {
      width: REFERENCE_SHEET_SIZE,
      height: REFERENCE_SHEET_SIZE,
      channels: 3,
      background: { r: 17, g: 24, b: 39 },
    },
  })
    .composite(panels)
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toBuffer()
}

async function fetchRunpodReference(url: string, index: number) {
  const response = await withTimeout(
    fetch(url, { redirect: 'follow', headers: { Accept: 'image/*' } }),
    RUNPOD_REFERENCE_FETCH_TIMEOUT_MS,
    `Reference image ${index + 1}`
  )
  if (!response.ok) throw new Error(`Could not fetch reference image ${index + 1} (${response.status}).`)

  const contentType = response.headers.get('content-type')
  if (contentType && !contentType.startsWith('image/')) {
    throw new Error(`Reference image ${index + 1} did not return image data.`)
  }

  const declaredSize = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredSize) && declaredSize > MAX_REFERENCE_SOURCE_BYTES) {
    throw new Error(`Reference image ${index + 1} is too large.`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (!buffer.byteLength || buffer.byteLength > MAX_REFERENCE_SOURCE_BYTES) {
    throw new Error(`Reference image ${index + 1} is empty or too large.`)
  }
  return buffer
}

export async function prepareRunpodGenerationInput(input: CompiledGenerationInput): Promise<RunpodGenerationInput> {
  const imageUrls = [...new Set(input.image_urls)].slice(0, MAX_GENERATION_REFERENCES)
  if (!imageUrls.length) throw new Error('Add at least one usable visual reference before generating.')

  const image =
    imageUrls.length === 1
      ? imageUrls[0]
      : (await buildRunpodReferenceSheet(await Promise.all(imageUrls.map(fetchRunpodReference)))).toString('base64')

  return {
    prompt: `${input.prompt} ${runpodReferencePrompt(imageUrls.length)}`.replace(/\s+/g, ' ').trim(),
    width: runpodImageDimension(process.env.RUNPOD_IMAGE_WIDTH, 1024),
    height: runpodImageDimension(process.env.RUNPOD_IMAGE_HEIGHT, 1024),
    image,
    // These original URLs let an upgraded worker use FLUX.2 Klein's native
    // multi-reference path; `image` remains compatible with the current
    // single-image Runpod handler by carrying an ordered reference sheet.
    images: imageUrls,
    image_urls: imageUrls,
  }
}

function parseEmbeddedJson(value: string) {
  const normalized = value.trim()
  const looksLikeJson =
    (normalized.startsWith('{') && normalized.endsWith('}')) ||
    (normalized.startsWith('[') && normalized.endsWith(']'))
  if (!looksLikeJson) return null

  try {
    return JSON.parse(normalized) as unknown
  } catch {
    return null
  }
}

function byteArrayCandidate(value: unknown[]): RunpodImageCandidate | null {
  if (value.length < 64 || !value.every((entry) => Number.isInteger(entry) && Number(entry) >= 0 && Number(entry) <= 255)) {
    return null
  }
  return { value: Buffer.from(value as number[]).toString('base64') }
}

export function findRunpodImage(value: unknown, depth = 0): RunpodImageCandidate | null {
  if (depth > 10) return null
  if (typeof value === 'string') {
    if (looksLikeImageValue(value)) return { value: value.trim() }
    const parsed = parseEmbeddedJson(value)
    return parsed === null ? null : findRunpodImage(parsed, depth + 1)
  }
  if (Array.isArray(value)) {
    const bytes = byteArrayCandidate(value)
    if (bytes) return bytes
    for (const item of value) {
      const candidate = findRunpodImage(item, depth + 1)
      if (candidate) return candidate
    }
    return null
  }
  if (!value || typeof value !== 'object') return null

  const record = value as Record<string, unknown>
  const contentType = [record.content_type, record.contentType, record.mime_type, record.mimeType, record.mime, record.type]
    .find((entry): entry is string => typeof entry === 'string' && entry.startsWith('image/'))

  const visitedKeys = new Set<string>()
  for (const key of RUNPOD_IMAGE_KEYS) {
    visitedKeys.add(key)
    const candidate = findRunpodImage(record[key], depth + 1)
    if (candidate) return { ...candidate, contentType: candidate.contentType ?? contentType }
  }
  for (const key of RUNPOD_COLLECTION_KEYS) {
    visitedKeys.add(key)
    const candidate = findRunpodImage(record[key], depth + 1)
    if (candidate) return { ...candidate, contentType: candidate.contentType ?? contentType }
  }

  // Custom Runpod workers often add a payload or response wrapper. Traverse
  // remaining fields so those wrappers do not require another deployment.
  for (const [key, nestedValue] of Object.entries(record)) {
    if (visitedKeys.has(key) || RUNPOD_DIAGNOSTIC_KEYS.has(key)) continue
    const candidate = findRunpodImage(nestedValue, depth + 1)
    if (candidate) return { ...candidate, contentType: candidate.contentType ?? contentType }
  }
  return null
}

export function describeRunpodShape(value: unknown, depth = 0): string {
  if (depth > 3) return '...'
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    const first = value.length ? describeRunpodShape(value[0], depth + 1) : 'empty'
    return `array(${value.length})<${first}>`
  }
  if (typeof value === 'string') {
    const parsed = parseEmbeddedJson(value)
    if (parsed !== null) return `json-string<${describeRunpodShape(parsed, depth + 1)}>`
    return `string(${value.length})`
  }
  if (typeof value !== 'object') return typeof value

  const entries = Object.entries(value as Record<string, unknown>).slice(0, 12)
  return `object{${entries.map(([key, nestedValue]) => `${key}:${describeRunpodShape(nestedValue, depth + 1)}`).join(',')}}`
}

function runpodWorkerError(output: unknown): string | null {
  if (typeof output === 'string') {
    const parsed = parseEmbeddedJson(output)
    return parsed === null ? null : runpodWorkerError(parsed)
  }
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null
  const record = output as Record<string, unknown>
  if (record.error !== undefined) return runpodErrorMessage(record.error)
  if (Array.isArray(record.errors) && record.errors.length) return runpodErrorMessage(record.errors)

  const status = typeof record.status === 'string' ? record.status.toLowerCase() : ''
  if (['error', 'failed', 'failure'].includes(status)) {
    return runpodErrorMessage(record.message ?? record.status)
  }
  return null
}

function runpodErrorMessage(error: unknown) {
  if (typeof error === 'string') return error.slice(0, 1000)
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const message = record.message ?? record.error
    if (typeof message === 'string') return message.slice(0, 1000)
    try {
      return JSON.stringify(error).slice(0, 1000)
    } catch {
      return 'Unknown Runpod error.'
    }
  }
  return 'Unknown Runpod error.'
}

async function storeRunpodImage(candidate: RunpodImageCandidate, boardId: string, slot: number) {
  if (/^https?:\/\//i.test(candidate.value)) {
    return withTimeout(storeGeneratedImage(candidate.value, boardId, slot), 30_000, 'Generated image storage')
  }

  const dataUrl = candidate.value.match(/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i)
  const contentType = dataUrl?.[1] ?? candidate.contentType ?? 'image/png'
  const encoded = (dataUrl?.[2] ?? candidate.value).replace(/\s/g, '')
  const buffer = Buffer.from(encoded, 'base64')
  if (!buffer.byteLength) throw new Error('Runpod returned an empty image.')
  return storeGeneratedBuffer(buffer, contentType, boardId, slot)
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s.`)), timeoutMs)
    }),
  ])
}

function checkRateLimit(key: string) {
  const now = Date.now()
  const bucket = rateLimitBuckets.get(key)

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return null
  }

  if (bucket.count >= MAX_GENERATE_REQUESTS_PER_WINDOW) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
    return retryAfterSeconds
  }

  bucket.count += 1
  return null
}

async function runGeneration(input: RunpodGenerationInput, boardId: string, slot: number) {
  const apiKey = process.env.RUNPOD_API_KEY?.trim()
  if (!apiKey) throw new Error('Missing RUNPOD_API_KEY.')

  const seed = Math.floor(Math.random() * 1_000_000_000)
  const response = await withTimeout(
    fetch(runpodEndpointUrl(), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: {
          ...input,
          seed,
        },
      }),
    }),
    GENERATION_TIMEOUT_MS,
    'Runpod generation'
  )

  const responseText = await response.text()
  let result: RunpodResponse
  try {
    result = JSON.parse(responseText) as RunpodResponse
  } catch {
    throw new Error(`Runpod returned invalid JSON (${response.status}).`)
  }

  if (!response.ok) {
    throw new Error(`Runpod ${response.status}: ${runpodErrorMessage(result.error ?? result.output)}`)
  }
  if (result.status && result.status !== 'COMPLETED') {
    throw new Error(`Runpod job ${result.id ?? ''} ended with status ${result.status}: ${runpodErrorMessage(result.error)}`)
  }

  const candidate = findRunpodImage(result.output) ?? findRunpodImage(result)
  if (!candidate) {
    const workerError = runpodWorkerError(result.output)
    if (workerError) throw new Error(`Runpod worker error: ${workerError}`)

    const outputShape = describeRunpodShape(result.output)
    console.error('Runpod completed without a supported image.', {
      jobId: result.id ?? null,
      status: result.status ?? null,
      outputShape,
    })
    throw new Error(`Runpod completed without returning a supported image. Output shape: ${outputShape}`)
  }

  const stored = await storeRunpodImage(candidate, boardId, slot)
  const outputSeed =
    result.output && typeof result.output === 'object' && Number.isFinite(Number((result.output as Record<string, unknown>).seed))
      ? Number((result.output as Record<string, unknown>).seed)
      : seed
  return { slot, ...stored, seed: outputSeed }
}

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getAuthenticatedUser(request)
    if (!user) return Response.json({ error: authError }, { status: 401 })

    const body = (await request.json()) as GenerateRequest
    const boardId = body.boardId?.trim() || 'anonymous'
    const count = IMAGES_PER_GENERATION
    const requesterKey = `user:${user.id}`
    const retryAfter = checkRateLimit(requesterKey)

    if (retryAfter) {
      return Response.json(
        { error: `Too many generation requests. Try again in ${retryAfter}s.` },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      )
    }

    if (!body.board?.brief?.trim()) {
      return Response.json({ error: 'Add a brief before generating.' }, { status: 400 })
    }

    if (!body.board.elements?.length && !body.board.imageRefs?.length && !body.board.sources?.length) {
      return Response.json({ error: 'Add at least one source or reference before generating.' }, { status: 400 })
    }

    const { compiled, metadata } = await compileBoardWithMetadata(body.board)
    compiled.model = GENERATION_MODEL_ID

    if (!process.env.RUNPOD_API_KEY?.trim()) {
      return Response.json({ error: 'Missing RUNPOD_API_KEY.' }, { status: 500 })
    }

    const runpodInput = await prepareRunpodGenerationInput(compiled)

    const supabase = createServiceSupabaseClient()
    const actionId = crypto.randomUUID()
    const quote = quoteFalAction('generate_image', count)
    const perImageQuote = quoteFalAction('generate_image', 1)

    // Developer override: allow certain emails unlimited generation without charging credits
    const DEV_UNLIMITED_EMAILS = new Set([ 'mondaysandy3@gmail.com' ])
    const isDevUnlimited = process.env.NODE_ENV !== 'production' || Boolean(user.email && DEV_UNLIMITED_EMAILS.has(user.email))

    let reservation: { reserved: boolean; creditsBalance: number }
    if (isDevUnlimited) {
      reservation = { reserved: true, creditsBalance: Number.MAX_SAFE_INTEGER }
    } else {
      reservation = await reserveCredits({
        supabase, userId: user.id, amount: quote.credits, actionId, actionType: 'generate_image',
        metadata: {
          provider: 'runpod', model: compiled.model, requested_output_count: count, estimated_usd: quote.falUsd,
        },
      })
    }

    if (!reservation.reserved) {
      await captureServerEvent('limit_reached', user.id, {
        requested_output_count: count, required_credits: quote.credits, credits_balance: reservation.creditsBalance,
      })

      return Response.json(
        {
          error: 'Not enough credits.', code: 'insufficient_credits',
          requiredCredits: quote.credits, creditsBalance: reservation.creditsBalance,
        },
        { status: 402 }
      )
    }

    let successfulOutputs = 0
    let reservationSettled = false

    const settleReservation = async () => {
      if (reservationSettled) return { creditsBalance: reservation.creditsBalance }
      reservationSettled = true

      const failedOutputs = Math.max(0, count - successfulOutputs)
      const refundAmount = failedOutputs * perImageQuote.credits
      if (!refundAmount) return { creditsBalance: reservation.creditsBalance }

      try {
        return await refundCredits({
          supabase, userId: user.id, amount: refundAmount, actionId, actionType: 'generate_image',
          metadata: { reason: 'failed_outputs', failed_outputs: failedOutputs },
        }) ?? { creditsBalance: reservation.creditsBalance }
      } catch {
        return { creditsBalance: reservation.creditsBalance }
      }
    }

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        writeEvent(controller, {
          type: 'start',
          count,
          model: compiled.model,
          creditsBalance: reservation.creditsBalance,
          requiredCredits: quote.credits,
          prompt: runpodInput.prompt,
          palette: metadata.palette,
          paletteSource: metadata.paletteSource,
        })

        const runSlot = (slot: number) =>
          runGeneration(runpodInput, boardId, slot)
            .then((output) => {
              successfulOutputs += 1
              writeEvent(controller, { type: 'output', ...output })
            })
            .catch((error) =>
              writeEvent(controller, {
                type: 'error',
                slot,
                error: error instanceof Error ? error.message : 'Generation failed.',
              })
            )

        const jobs = Promise.allSettled(Array.from({ length: count }, (_, slot) => runSlot(slot)))

        jobs
          .then(async () => {
            const finalQuota = await settleReservation()

            await captureServerEvent('generate', user.id, {
              output_count: successfulOutputs,
              requested_output_count: count,
              credits_balance: finalQuota.creditsBalance,
            })

            writeEvent(controller, {
              type: 'done',
              outputCount: successfulOutputs,
              creditsBalance: finalQuota.creditsBalance,
            })
          })
          .finally(() => controller.close())
      },
      cancel() {
        void settleReservation()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Generation failed.'
    return Response.json({ error: message }, { status: 500 })
  }
}
