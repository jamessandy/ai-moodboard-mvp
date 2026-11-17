import type { TLStore } from 'tldraw'

type CanvasChangeHandlers = {
  onDocumentChange: () => void
  onSessionChange: () => void
}

export function listenToCanvasChanges(store: TLStore, handlers: CanvasChangeHandlers) {
  const unlistenDocument = store.listen(handlers.onDocumentChange, { scope: 'document' })
  const unlistenSession = store.listen(handlers.onSessionChange, { scope: 'session' })

  return () => {
    unlistenDocument()
    unlistenSession()
  }
}
