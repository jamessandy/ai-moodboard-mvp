import { NextRequest } from 'next/server'
import { BoardDoc } from '@/lib/board'
import { compileBoardWithMetadata } from '@/lib/assembler'

export const runtime = 'nodejs'

type CompileRequest = {
  board: BoardDoc
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CompileRequest

    if (!body.board?.brief?.trim()) {
      return Response.json({ error: 'Add a brief before previewing the prompt.' }, { status: 400 })
    }

    if (!body.board.elements?.length && !body.board.imageRefs?.length) {
      return Response.json({ error: 'Extract at least one element before previewing the prompt.' }, { status: 400 })
    }

    const { compiled, metadata } = await compileBoardWithMetadata(body.board)
    return Response.json({ ...compiled, ...metadata })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Prompt preview failed.'
    return Response.json({ error: message }, { status: 500 })
  }
}
