import assert from 'node:assert/strict'
import test from 'node:test'
import type { TLStore } from 'tldraw'
import { listenToCanvasChanges } from '@/lib/canvas-store'

test('keeps camera session changes out of the document autosave listener', () => {
  const listeners: Array<{
    listener: () => void
    scope: 'document' | 'session'
    source?: string
    removed: boolean
  }> = []
  const store = {
    listen(listener: () => void, filters: { scope: 'document' | 'session'; source?: string }) {
      const registration = { listener, scope: filters.scope, source: filters.source, removed: false }
      listeners.push(registration)
      return () => {
        registration.removed = true
      }
    },
  } as unknown as TLStore
  let documentChanges = 0
  let sessionChanges = 0

  const unlisten = listenToCanvasChanges(store, {
    onDocumentChange: () => documentChanges++,
    onSessionChange: () => sessionChanges++,
  })

  assert.deepEqual(listeners.map(({ scope }) => scope), ['document', 'session'])
  assert.equal(listeners.find(({ scope }) => scope === 'document')?.source, 'user')

  listeners.find(({ scope }) => scope === 'session')?.listener()
  assert.equal(documentChanges, 0)
  assert.equal(sessionChanges, 1)

  listeners.find(({ scope }) => scope === 'document')?.listener()
  assert.equal(documentChanges, 1)
  assert.equal(sessionChanges, 1)

  unlisten()
  assert.equal(listeners.every(({ removed }) => removed), true)
})
