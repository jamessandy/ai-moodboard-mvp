'use client'

import { useMemo } from 'react'
import { Tldraw, TLEditorSnapshot, TLStoreSnapshot } from 'tldraw'
import { moodboardShapeUtils } from '@/components/moodboardShapes'
import { isMoodboardDocument } from '@/lib/board'

export function ReadOnlyBoard({ snapshot }: { snapshot: unknown }) {
  const shapeUtils = useMemo(() => moodboardShapeUtils, [])
  const tldrawLicenseKey = process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY
  const tldrawSnapshot = isMoodboardDocument(snapshot) ? snapshot.tldraw : snapshot
  const snapshotProp =
    tldrawSnapshot && typeof tldrawSnapshot === 'object' && 'store' in tldrawSnapshot && 'schema' in tldrawSnapshot
      ? (tldrawSnapshot as TLEditorSnapshot | TLStoreSnapshot)
      : undefined

  return (
    <Tldraw
      hideUi
      licenseKey={tldrawLicenseKey}
      shapeUtils={shapeUtils}
      snapshot={snapshotProp}
      onMount={(editor) => {
        editor.updateInstanceState({ isReadonly: true })
        editor.zoomToFit()
      }}
    />
  )
}
