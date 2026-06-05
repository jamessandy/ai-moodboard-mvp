import { NextRequest } from 'next/server'
import { BoardSavePayload, StoredBoard } from '@/lib/boards'
import { getAuthenticatedUser } from '@/lib/supabase/auth'
import { createServiceSupabaseClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { user, error: authError } = await getAuthenticatedUser(request)
  if (!user) return Response.json({ error: authError }, { status: 401 })

  const { id } = await context.params
  const body = (await request.json()) as Partial<BoardSavePayload>

  if (!body.document) {
    return Response.json({ error: 'Missing tldraw document snapshot.' }, { status: 400 })
  }

  const supabase = createServiceSupabaseClient()
  const { data, error } = await supabase
    .from('boards')
    .update({
      brief: body.brief ?? '',
      document: body.document,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('owner_id', user.id)
    .select('id, owner_id, title, brief, document, share_id, created_at, updated_at')
    .single<StoredBoard>()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ board: data })
}
