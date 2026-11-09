import { createServiceSupabaseClient } from '@/lib/supabase/server'

export async function getAuthenticatedUser(request: Request) {
  const authorization = request.headers.get('authorization')
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]

  if (!token) {
    return { user: null, error: 'Missing bearer token.' }
  }


  const supabase = createServiceSupabaseClient()
  let result: Awaited<ReturnType<typeof supabase.auth.getUser>>

  try {
    result = await supabase.auth.getUser(token)
  } catch {
    return { user: null, error: 'Authentication service is temporarily unavailable.', unavailable: true }
  }

  const { data, error } = result

  if (error || !data.user) {
    return { user: null, error: 'Invalid or expired session.', unavailable: false }
  }

  return { user: data.user, error: null, unavailable: false }
}
