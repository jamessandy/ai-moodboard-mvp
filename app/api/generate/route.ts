import { fal } from '@fal-ai/client'
import { Client, handle_file } from '@gradio/client'
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

export const runtime = 'nodejs'
export const maxDuration = 300

const MAX_GENERATE_REQUESTS_PER_WINDOW = Number(process.env.MAX_GENERATE_REQUESTS_PER_WINDOW ?? 5)
const RATE_LIMIT_WINDOW_MS = Number(process.env.GENERATE_RATE_LIMIT_WINDOW_MS ?? 60_000)
const GENERATION_TIMEOUT_MS = Number(process.env.GENERATION_TIMEOUT_MS ?? 180_000)
// FLUX.2's ZeroGPU duration grows by 0.8x per reference. At 30 steps,
// two references request about 88 seconds; larger boards exceed its cap.
const MAX_HF_REFERENCE_IMAGES = 2
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>()

type GenerateRequest = {
  boardId?: string
  count?: number
  board: BoardDoc
  model?: string
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

type GradioImage = {
  url?: string
  path?: string
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

async function runGeneration(input: CompiledGenerationInput, boardId: string, slot: number) {
  const seed = Math.floor(Math.random() * 1_000_000_000)
  const seedVal = seed

  if (input.model.startsWith('pollinations/')) {
    const model = input.model.slice('pollinations/'.length) || 'flux'
    const url = new URL(`https://gen.pollinations.ai/image/${encodeURIComponent(input.prompt)}`)
    url.searchParams.set('model', model)
    url.searchParams.set('width', '1024')
    url.searchParams.set('height', '1024')
    url.searchParams.set('seed', String(seedVal))
    const response = await withTimeout(
      fetch(url, { headers: { Authorization: `Bearer ${process.env.POLLINATIONS_API_KEY}` } }),
      GENERATION_TIMEOUT_MS,
      'Pollinations generation'
    )
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`Pollinations ${response.status}: ${detail || response.statusText}`)
    }
    const contentType = response.headers.get('content-type') ?? 'image/jpeg'
    if (!contentType.startsWith('image/')) throw new Error('Pollinations did not return an image.')
    const stored = await storeGeneratedBuffer(Buffer.from(await response.arrayBuffer()), contentType, boardId, slot)
    return { slot, ...stored, seed: seedVal }
  }

  if (input.model.startsWith('hf-spaces/')) {
    const parts = input.model.split('/')
    const owner = parts[1]
    const space = parts[2]
    if (!owner || !space) throw new Error('Invalid HF Spaces model identifier.')

    const token = process.env.HF_TOKEN ?? process.env.HUGGINGFACE_TOKEN ?? process.env.HUGGING_FACE_HUB_TOKEN
    const client = await withTimeout(
      Client.connect(`${owner}/${space}`, token ? { token: token as `hf_${string}` } : undefined),
      30_000,
      'HF Spaces connection'
    )
    let result
    try {
      const hfReferenceUrls = (input.image_urls ?? []).slice(0, MAX_HF_REFERENCE_IMAGES)
      result = await withTimeout(
        client.predict<unknown[]>('/infer', {
          prompt: input.prompt,
          input_images: hfReferenceUrls.map((url) => ({ image: handle_file(url), caption: null })),
          seed: seedVal,
          randomize_seed: false,
          width: 1024,
          height: 1024,
          num_inference_steps: 30,
          guidance_scale: 4,
          prompt_upsampling: true,
        }),
        GENERATION_TIMEOUT_MS,
        'HF Spaces generation'
      )
    } finally {
      client.close()
    }

    const out = Array.isArray(result.data) ? result.data[0] : result.data

    let buffer: Buffer | null = null
    let contentType = 'image/png'

    if (typeof out === 'string') {
      if (out.startsWith('data:')) {
        const match = out.match(/^data:(.+);base64,(.+)$/)
        if (!match) throw new Error('HF Spaces returned unexpected data URL.')
        contentType = match[1]
        buffer = Buffer.from(match[2], 'base64')
      } else if (/^https?:\/\//.test(out)) {
        // it's a URL — store via the existing helper
        const stored = await withTimeout(storeGeneratedImage(out, boardId, slot), 30_000, 'Generated image storage')
        return { slot, url: stored.url, width: stored.width, height: stored.height, seed: seedVal }
      } else {
        // assume base64
        buffer = Buffer.from(out, 'base64')
      }
    } else if (out && typeof out === 'object') {
      const image = out as GradioImage
      const imageUrl = image.url ?? image.path
      if (imageUrl && /^https?:\/\//.test(imageUrl)) {
        const stored = await withTimeout(storeGeneratedImage(imageUrl, boardId, slot), 30_000, 'Generated image storage')
        return { slot, url: stored.url, width: stored.width, height: stored.height, seed: seedVal }
      }
    }

    if (!buffer) throw new Error('HF Spaces did not return an image.')

    const metadata = await sharp(buffer).metadata()
    const supabase = await createServiceSupabaseClientWithBucket(OUTPUT_BUCKET)
    const path = `${boardId}/${Date.now()}-${slot}-${crypto.randomUUID()}.${extensionFromType(contentType)}`
    const { error } = await supabase.storage.from(OUTPUT_BUCKET).upload(path, buffer, {
      contentType,
      upsert: false,
    })
    if (error) throw error
    const { data } = supabase.storage.from(OUTPUT_BUCKET).getPublicUrl(path)
    return { slot, url: data.publicUrl, width: metadata.width, height: metadata.height, seed: seedVal }
  }

  // Default: fal.ai path
  const result = await withTimeout(
    fal.subscribe(input.model, {
      input: {
        prompt: input.prompt,
        image_urls: input.image_urls,
        num_images: 1,
        seed: seedVal,
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
  return { slot, url: storedImage.url, width: storedImage.width ?? image.width, height: storedImage.height ?? image.height, seed: seedVal }
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
    // Allow client to override the compiled model (e.g. use an HF Spaces model)
    if (body.model && typeof body.model === 'string') {
      compiled.model = body.model
    }
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
        metadata: { fal_model: compiled.model, requested_output_count: count, fal_usd: quote.falUsd },
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

    if (compiled.model.startsWith('fal-ai/')) {
      if (!process.env.FAL_KEY) {
        return Response.json({ error: 'Missing FAL_KEY.' }, { status: 500 })
      }
      fal.config({ credentials: process.env.FAL_KEY })
    }
    if (compiled.model.startsWith('pollinations/') && !process.env.POLLINATIONS_API_KEY) {
      return Response.json({ error: 'Missing POLLINATIONS_API_KEY.' }, { status: 500 })
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
          prompt: compiled.prompt,
          palette: metadata.palette,
          paletteSource: metadata.paletteSource,
        })

        const runSlot = (slot: number) =>
          runGeneration(compiled, boardId, slot)
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

        const jobs = compiled.model.startsWith('hf-spaces/')
          ? (async () => {
              for (let slot = 0; slot < count; slot += 1) await runSlot(slot)
            })()
          : Promise.allSettled(Array.from({ length: count }, (_, slot) => runSlot(slot)))

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
