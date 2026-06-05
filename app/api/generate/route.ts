import { fal } from '@fal-ai/client'
import { NextRequest } from 'next/server'
import sharp from 'sharp'
import { BoardDoc } from '@/lib/board'
import { compileBoardWithMetadata } from '@/lib/assembler'
import {
  OUTPUT_BUCKET,
  createServiceSupabaseClient,
  createServiceSupabaseClientWithBucket,
} from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 60

const DEFAULT_VARIATIONS = 6
const MAX_GENERATIONS_PER_BOARD = Number(process.env.MAX_GENERATIONS_PER_BOARD ?? 40)
const MAX_GENERATIONS_PER_USER = Number(process.env.MAX_GENERATIONS_PER_USER ?? 80)
const MAX_GENERATE_REQUESTS_PER_WINDOW = Number(process.env.MAX_GENERATE_REQUESTS_PER_WINDOW ?? 5)
const RATE_LIMIT_WINDOW_MS = Number(process.env.GENERATE_RATE_LIMIT_WINDOW_MS ?? 60_000)
const GENERATION_TIMEOUT_MS = Number(process.env.GENERATION_TIMEOUT_MS ?? 180_000)
const generationCounts = new Map<string, number>()
const userGenerationCounts = new Map<string, number>()
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>()

type GenerateRequest = {
  boardId?: string
  count?: number
  board: BoardDoc
}

type FalImage = {
  url: string
  content_type?: string
  file_name?: string
  width?: number
  height?: number
}

type FalResult = {
  images?: FalImage[]
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

async function runGeneration(input: CompiledGenerationInput, boardId: string, slot: number) {
  const seed = Math.floor(Math.random() * 1_000_000_000)
  const result = await withTimeout(
    fal.subscribe(input.model, {
      input: {
        prompt: input.prompt,
        image_urls: input.image_urls,
        num_images: 1,
        seed,
        output_format: 'png',
      },
    }),
    GENERATION_TIMEOUT_MS,
    'fal.ai generation'
  )

  const data = result.data as FalResult
  const image = data.images?.[0]
  if (!image?.url) {
    throw new Error('fal.ai did not return an image URL.')
  }

  const storedImage = await withTimeout(
    storeGeneratedImage(image.url, boardId, slot),
    30_000,
    'Generated image storage'
  )
  return { slot, url: storedImage.url, width: storedImage.width ?? image.width, height: storedImage.height ?? image.height, seed }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as GenerateRequest
    const boardId = body.boardId?.trim() || 'anonymous'
    const requestedCount = Math.max(1, Math.min(body.count ?? DEFAULT_VARIATIONS, DEFAULT_VARIATIONS))
    const requesterKey = await getRequesterKey(request)
    const retryAfter = checkRateLimit(requesterKey)

    if (retryAfter) {
      return Response.json(
        { error: `Too many generation requests. Try again in ${retryAfter}s.` },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      )
    }

    const used = generationCounts.get(boardId) ?? 0
    const usedByRequester = userGenerationCounts.get(requesterKey) ?? 0
    const remaining = Math.max(0, MAX_GENERATIONS_PER_BOARD - used)
    const remainingForRequester = Math.max(0, MAX_GENERATIONS_PER_USER - usedByRequester)
    const count = Math.min(requestedCount, remaining, remainingForRequester)

    if (!body.board?.brief?.trim()) {
      return Response.json({ error: 'Add a brief before generating.' }, { status: 400 })
    }

    if (!body.board.elements?.length && !body.board.imageRefs?.length) {
      return Response.json({ error: 'Extract at least one element before generating.' }, { status: 400 })
    }

    if (count <= 0) {
      return Response.json({ error: 'Generation cap reached.' }, { status: 429 })
    }

    if (!process.env.FAL_KEY) {
      return Response.json({ error: 'Missing FAL_KEY.' }, { status: 500 })
    }

    fal.config({ credentials: process.env.FAL_KEY })

    generationCounts.set(boardId, used + count)
    userGenerationCounts.set(requesterKey, usedByRequester + count)
    const { compiled, metadata } = await compileBoardWithMetadata(body.board)

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        writeEvent(controller, {
          type: 'start',
          count,
          remainingAfterRequest: remaining - count,
          prompt: compiled.prompt,
          palette: metadata.palette,
          paletteSource: metadata.paletteSource,
        })

        const jobs = Array.from({ length: count }, (_, slot) =>
          runGeneration(compiled, boardId, slot)
            .then((output) => writeEvent(controller, { type: 'output', ...output }))
            .catch((error) =>
              writeEvent(controller, {
                type: 'error',
                slot,
                error: error instanceof Error ? error.message : 'Generation failed.',
              })
            )
        )

        Promise.allSettled(jobs)
          .then(() => writeEvent(controller, { type: 'done' }))
          .finally(() => controller.close())
      },
      cancel() {
        generationCounts.set(boardId, Math.max(used, (generationCounts.get(boardId) ?? used) - count))
        userGenerationCounts.set(
          requesterKey,
          Math.max(usedByRequester, (userGenerationCounts.get(requesterKey) ?? usedByRequester) - count)
        )
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
