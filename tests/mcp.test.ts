import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMoodblendyToolPayload } from '../lib/mcp'

test('buildMoodblendyToolPayload formats a chat-friendly board request', () => {
  const payload = buildMoodblendyToolPayload({
    brief: 'A futuristic editorial moodboard',
    style: 'synthwave',
    colors: ['#0f172a', '#f59e0b'],
    references: ['neon cityscape', 'metallic textures'],
    notes: ['High contrast', 'Editorial'],
  })

  assert.equal(payload.brief, 'A futuristic editorial moodboard')
  assert.equal(payload.style, 'synthwave')
  assert.deepEqual(payload.colors, ['#0f172a', '#f59e0b'])
  assert.deepEqual(payload.references, ['neon cityscape', 'metallic textures'])
  assert.match(payload.prompt, /synthwave/i)
  assert.match(payload.prompt, /neon cityscape/i)
})
