'use client'

import { useMemo } from 'react'
import { NativeCanvas } from '@/components/NativeCanvas'
import { normalizeCanvasDocument } from '@/lib/board'
import { createCanvasStore } from '@/lib/canvas-store'

export function ReadOnlyBoard({ snapshot }: { snapshot: unknown }) {
  const store = useMemo(() => createCanvasStore(normalizeCanvasDocument(snapshot)), [snapshot])

  return <NativeCanvas store={store} readOnly theme="light" />
}
