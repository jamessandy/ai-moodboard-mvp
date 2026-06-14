import { NextRequest } from 'next/server'
import { getUsageQuota } from '@/lib/usage'
import { getAuthenticatedUser } from '@/lib/supabase/auth'
import { createServiceSupabaseClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request)
  if (!user) return Response.json({ error: authError }, { status: 401 })

  try {
    const quota = await getUsageQuota(createServiceSupabaseClient(), user.id)
    return Response.json(quota)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load profile.'
    return Response.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
