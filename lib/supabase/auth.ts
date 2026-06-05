import { createServiceSupabaseClient } from '@/lib/supabase/server'

export async function getAuthenticatedUser(request: Request) {
  const authorization = request.headers.get('authorization')
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]

  if (!token) {
    return { user: null, error: 'Missing bearer token.' }
  }

  const supabase = createServiceSupabaseClient()
  const { data, error } = await supabase.auth.getUser(token)

  if (error || !data.user) {
    return { user: null, error: 'Invalid or expired session.' }
  }

  return { user: data.user, error: null }
}
