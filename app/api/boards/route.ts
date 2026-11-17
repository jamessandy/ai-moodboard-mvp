import { NextRequest } from 'next/server'
import { getAuthenticatedUser } from '@/lib/supabase/auth'
import { createServiceSupabaseClient } from '@/lib/supabase/server'
import { BoardSummary, StoredBoard } from '@/lib/boards'

export const runtime = 'nodejs'

const BOARD_FIELDS = 'id, owner_id, title, brief, document, share_id, created_at, updated_at'
const BOARD_SUMMARY_FIELDS = 'id, title, brief, share_id, created_at, updated_at'

function cleanBoardTitle(value: unknown) {
  if (typeof value !== 'string') return 'Untitled board'
  return value.trim().slice(0, 120) || 'Untitled board'
}

async function createBoard(ownerId: string, title: string) {
  const supabase = createServiceSupabaseClient()
  return supabase
    .from('boards')
    .insert({
      owner_id: ownerId,
      title,
      brief: title === 'Untitled board' ? '' : title,
      document: { version: 2, sources: [], tldraw: {}, chat: [] },
    })
    .select(BOARD_FIELDS)
    .single<StoredBoard>()
}

export async function GET(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request)
  if (!user) return Response.json({ error: authError }, { status: 401 })

  const supabase = createServiceSupabaseClient()
  const requestedId = request.nextUrl.searchParams.get('id')
  const { data: summaries, error: listError } = await supabase
    .from('boards')
    .select(BOARD_SUMMARY_FIELDS)
    .eq('owner_id', user.id)
    .order('updated_at', { ascending: false })
    .returns<BoardSummary[]>()

  if (listError) {
    return Response.json({ error: listError.message }, { status: 500 })
  }

  if (!summaries?.length) {
    const { data: created, error: insertError } = await createBoard(user.id, 'Untitled board')
    if (insertError || !created) {
      return Response.json({ error: insertError?.message ?? 'Could not create board.' }, { status: 500 })
    }
    return Response.json({ board: created, boards: [created] })
  }

  const boardId = requestedId ?? summaries[0].id
  const { data: board, error: boardError } = await supabase
    .from('boards')
    .select(BOARD_FIELDS)
    .eq('owner_id', user.id)
    .eq('id', boardId)
    .maybeSingle<StoredBoard>()

  if (boardError) {
    return Response.json({ error: boardError.message }, { status: 500 })
  }
  if (!board) {
    return Response.json({ error: 'Board not found.' }, { status: 404 })
  }

  return Response.json({ board, boards: summaries })
}

export async function POST(request: NextRequest) {
  const { user, error: authError } = await getAuthenticatedUser(request)
  if (!user) return Response.json({ error: authError }, { status: 401 })

  const body = (await request.json().catch(() => ({}))) as { title?: unknown }
  const { data: board, error } = await createBoard(user.id, cleanBoardTitle(body.title))
  if (error || !board) {
    return Response.json({ error: error?.message ?? 'Could not create board.' }, { status: 500 })
  }

  return Response.json({ board }, { status: 201 })
}
