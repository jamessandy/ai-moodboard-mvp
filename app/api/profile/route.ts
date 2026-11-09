import { NextRequest } from 'next/server'
import { getAuthenticatedUser } from '@/lib/supabase/auth'
import { createServiceSupabaseClient } from '@/lib/supabase/server'
import { ensureProfile } from '@/lib/usage'

export const runtime = 'nodejs'

const WELCOME_CREDITS_PER_IMAGE = 75

type SupabaseError = {
  code?: string
  message?: string
}

function isMissingCreditsColumn(error: SupabaseError) {
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    error.message?.includes('credits_balance') === true
  )
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return 'Could not load profile.'
}

export async function GET(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request)
  if (!user) return Response.json({ error: authError }, { status: 401 })

  try {
    const supabase = createServiceSupabaseClient()
    await ensureProfile(supabase, user.id)
    const { data, error } = await supabase.from('profiles').select('credits_balance').eq('user_id', user.id).single()
    if (!error) return Response.json({ creditsBalance: Number(data.credits_balance ?? 0) })
    if (!isMissingCreditsColumn(error)) throw error

    // Keep profile loading functional while the credit-wallet migration is
    // being rolled out. This matches the migration's legacy quota conversion.
    const legacy = await supabase.from('profiles').select('images_used').eq('user_id', user.id).single()
    if (legacy.error) throw legacy.error
    const imagesRemaining = Math.max(0, 10 - Number(legacy.data.images_used ?? 0))
    return Response.json({ creditsBalance: imagesRemaining * WELCOME_CREDITS_PER_IMAGE })
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
