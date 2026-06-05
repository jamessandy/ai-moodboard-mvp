import { NextRequest } from 'next/server'
import { getAuthenticatedUser } from '@/lib/supabase/auth'
import { createServiceSupabaseClient } from '@/lib/supabase/server'
import { StoredBoard } from '@/lib/boards'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request)
  if (!user) return Response.json({ error: authError }, { status: 401 })

  const supabase = createServiceSupabaseClient()
  const { data: existing, error: selectError } = await supabase
    .from('boards')
    .select('id, owner_id, title, brief, document, share_id, created_at, updated_at')
    .eq('owner_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle<StoredBoard>()

  if (selectError) {
    return Response.json({ error: selectError.message }, { status: 500 })
  }

  if (existing) {
    return Response.json({ board: existing })
  }

  const { data: created, error: insertError } = await supabase
    .from('boards')
    .insert({
      owner_id: user.id,
      title: 'Untitled board',
      brief: '',
      document: { version: 2, sources: [], tldraw: {} },
    })
    .select('id, owner_id, title, brief, document, share_id, created_at, updated_at')
    .single<StoredBoard>()

  if (insertError) {
    return Response.json({ error: insertError.message }, { status: 500 })
  }

  return Response.json({ board: created })
}
