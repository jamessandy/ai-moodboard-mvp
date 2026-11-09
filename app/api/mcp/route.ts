import { NextRequest } from 'next/server'
import { buildMoodblendyToolPayload } from '@/lib/mcp'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>
    const payload = buildMoodblendyToolPayload({
      brief: typeof body.brief === 'string' ? body.brief : undefined,
      style: typeof body.style === 'string' ? body.style : undefined,
      colors: Array.isArray(body.colors) ? body.colors.filter((value): value is string => typeof value === 'string') : undefined,
      references: Array.isArray(body.references) ? body.references.filter((value): value is string => typeof value === 'string') : undefined,
      notes: Array.isArray(body.notes) ? body.notes.filter((value): value is string => typeof value === 'string') : undefined,
    })

    return Response.json({
      ok: true,
      tool: 'moodblendy.create_board',
      payload,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'MCP request failed.'
    return Response.json({ error: message }, { status: 500 })
  }
}
