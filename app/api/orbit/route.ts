import { fal } from '@fal-ai/client'
import { NextRequest } from 'next/server'
import { captureServerEvent } from '@/lib/analytics/server'
import { getAuthenticatedUser } from '@/lib/supabase/auth'
import { ORBIT_BUCKET, createServiceSupabaseClientWithBucket } from '@/lib/supabase/server'
import { createServiceSupabaseClient } from '@/lib/supabase/server'
import { quoteFalAction } from '@/lib/credits/pricing'
import { refundCredits, reserveCredits } from '@/lib/credits/wallet'

export const runtime = 'nodejs'
export const maxDuration = 300

const ORBIT_TIMEOUT_MS = Number(process.env.ORBIT_TIMEOUT_MS ?? 240_000)
const MAX_GLB_BYTES = 100 * 1024 * 1024

type OrbitRequest = {
  boardId?: string
  sourceUrl?: string
  sourceLabel?: string
}

type FalFile = { url?: string; content_type?: string; file_name?: string }
type FalOrbitResult = { model_glb?: FalFile | string }

function safePathPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100) || 'board'
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error('3D scene generation timed out. Please try again.')), timeoutMs)
    }),
  ])
}

async function storeGlb(url: string, boardId: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not fetch the generated scene (${response.status}).`)

  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > MAX_GLB_BYTES) throw new Error('The generated 3D scene is too large to store.')

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength > MAX_GLB_BYTES) throw new Error('The generated 3D scene is too large to store.')

  const supabase = await createServiceSupabaseClientWithBucket(ORBIT_BUCKET)
  const path = `${safePathPart(boardId)}/${Date.now()}-${crypto.randomUUID()}.glb`
  const { error } = await supabase.storage.from(ORBIT_BUCKET).upload(path, buffer, {
    contentType: 'model/gltf-binary',
    upsert: false,
  })
  if (error) throw error

  return supabase.storage.from(ORBIT_BUCKET).getPublicUrl(path).data.publicUrl
}

export async function POST(request: NextRequest) {
  let reservation: { userId: string; amount: number; actionId: string } | null = null
  try {
    const { user, error: authError, unavailable } = await getAuthenticatedUser(request)
    if (!user) return Response.json({ error: authError }, { status: unavailable ? 503 : 401 })
    if (!process.env.FAL_KEY) return Response.json({ error: 'Missing FAL_KEY.' }, { status: 500 })

    const body = (await request.json()) as OrbitRequest
    const sourceUrl = body.sourceUrl?.trim()
    if (!sourceUrl) return Response.json({ error: 'Choose a generated image to explore.' }, { status: 400 })

    const parsed = new URL(sourceUrl)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return Response.json({ error: 'The source image must use an http or https URL.' }, { status: 400 })
    }

    const quote = quoteFalAction('orbit_scene')
    const actionId = crypto.randomUUID()
    const supabase = createServiceSupabaseClient()
    const creditReservation = await reserveCredits({
      supabase, userId: user.id, amount: quote.credits, actionId, actionType: 'orbit_scene',
      metadata: { fal_model: 'fal-ai/sam-3/3d-objects', fal_usd: quote.falUsd },
    })
    if (!creditReservation.reserved) {
      return Response.json({
        error: 'Not enough credits.', code: 'insufficient_credits', requiredCredits: quote.credits,
        creditsBalance: creditReservation.creditsBalance,
      }, { status: 402 })
    }
    reservation = { userId: user.id, amount: quote.credits, actionId }

    fal.config({ credentials: process.env.FAL_KEY })
    const result = await withTimeout(
      fal.subscribe('fal-ai/sam-3/3d-objects', {
        input: { image_url: sourceUrl, export_textured_glb: true },
      }),
      ORBIT_TIMEOUT_MS
    )
    const data = result.data as FalOrbitResult
    const remoteGlbUrl = typeof data.model_glb === 'string' ? data.model_glb : data.model_glb?.url
    if (!remoteGlbUrl) throw new Error('The 3D service did not return a scene mesh.')

    const modelUrl = await storeGlb(remoteGlbUrl, body.boardId?.trim() || 'board')
    await captureServerEvent('explore_scene', user.id, {
      board_id: body.boardId?.trim() || null,
      source_label: body.sourceLabel?.trim() || null,
    })

    return Response.json({ modelUrl, creditsBalance: creditReservation.creditsBalance })
  } catch (error) {
    if (reservation) {
      await refundCredits({
        supabase: createServiceSupabaseClient(), userId: reservation.userId, amount: reservation.amount,
        actionId: reservation.actionId, actionType: 'orbit_scene', metadata: { reason: 'failed_action' },
      }).catch(() => null)
    }
    const rawMessage = error instanceof Error ? error.message : 'Could not build the 3D scene.'
    const forbidden = /forbidden|status(?:code)?[^0-9]*403|\b403\b/i.test(rawMessage)
    const message = forbidden
      ? 'fal.ai denied access to SAM 3D. Check that FAL_KEY is active, has credits, and can use fal-ai/sam-3/3d-objects.'
      : rawMessage
    return Response.json({ error: message }, { status: forbidden ? 502 : 500 })
  }
}
