import { NextRequest } from 'next/server'
import type { BoardDoc } from '@/lib/board'

export const runtime = 'nodejs'
export const maxDuration = 30

type ChatRole = 'user' | 'assistant'
type ChatHistoryMessage = {
  role: ChatRole
  content: string
}
type ChatRequest = {
  history?: ChatHistoryMessage[]
  board?: BoardDoc
}

const MAX_HISTORY = 24

function cleanHistory(history: ChatHistoryMessage[] = []) {
  return history
    .filter((message) => (message.role === 'user' || message.role === 'assistant') && message.content?.trim())
    .slice(-MAX_HISTORY)
    .map((message) => ({ role: message.role, content: message.content.trim().slice(0, 1200) }))
}

function boardContext(board: BoardDoc | undefined) {
  const pieces = [
    board?.brief?.trim(),
    board?.elements?.length
      ? `Use these board elements: ${board.elements
          .map((element) => `${element.label}${element.tags.length ? ` (${element.tags.join(', ')})` : ''}`)
          .join('; ')}.`
      : '',
    board?.swatches?.length
      ? `Use this color palette: ${board.swatches.flatMap((swatch) => swatch.colors).join(', ')}.`
      : '',
    board?.notes?.length ? `Mood and notes: ${board.notes.map((note) => note.text).join('; ')}.` : '',
    board?.typeSamples?.length
      ? `Typography style references: ${board.typeSamples.map((sample) => sample.label).join(', ')}.`
      : '',
  ]

  return pieces.filter(Boolean).join(' ')
}

function composePrompt(history: ChatHistoryMessage[], board: BoardDoc | undefined) {
  const userMessages = history
    .filter((message) => message.role === 'user')
    .map((message) => message.content)
    .filter((message, index, messages) => messages.indexOf(message) === index)
  const recentInstructions = userMessages.slice(-3).join(' Then ')
  const context = boardContext(board)
  const prompt = [context, recentInstructions].filter(Boolean).join(' ')

  return (prompt || 'Create a cohesive moodboard image from the current board references.')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1800)
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ChatRequest
    const history = cleanHistory(body.history)

    if (!history.length || history.at(-1)?.role !== 'user') {
      return Response.json({ error: 'Send a message before generating.' }, { status: 400 })
    }

    return Response.json({
      assistantText: "I'll generate that using the current board references.",
      generationPrompt: composePrompt(history, body.board),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Chat failed.'
    return Response.json({ error: message }, { status: 500 })
  }
}
