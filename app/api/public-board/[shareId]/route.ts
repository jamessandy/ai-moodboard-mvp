import { NextRequest } from 'next/server'
import { StoredBoard } from '@/lib/boards'
import { createServiceSupabaseClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET(_request: NextRequest, context: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await context.params
  const supabase = createServiceSupabaseClient()
  const { data, error } = await supabase
    .from('boards')
    .select('id, title, brief, document, share_id, created_at, updated_at')
    .eq('share_id', shareId)
    .maybeSingle<StoredBoard>()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  if (!data) {
    return Response.json({ error: 'Board not found.' }, { status: 404 })
  }

  return Response.json({ board: data })
}
