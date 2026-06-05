import { NextRequest } from 'next/server'
import { extractPaletteFromImage } from '@/lib/assembler'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { sourceUrl?: string }
    if (!body.sourceUrl) {
      return Response.json({ error: 'Provide sourceUrl.' }, { status: 400 })
    }

    const colors = await extractPaletteFromImage(body.sourceUrl)
    if (!colors.length) {
      return Response.json({ error: 'No palette could be extracted.' }, { status: 422 })
    }

    return Response.json({ colors })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Palette extraction failed.'
    return Response.json({ error: message }, { status: 500 })
  }
}
