'use client'

import { createElement, HTMLAttributes, useEffect, useState } from 'react'

type ModelViewerElement = HTMLElement & {
  toBlob: (options?: { idealAspect?: boolean; mimeType?: string; qualityArgument?: number }) => Promise<Blob>
}

type SceneOrbitModalProps = {
  open: boolean
  sourceUrl: string | null
  sourceLabel: string
  modelUrl: string | null
  status: 'idle' | 'building' | 'ready' | 'error'
  error: string | null
  onClose: () => void
  onRetry: () => void
  onCapture: (blob: Blob) => Promise<void>
}

export function SceneOrbitModal(props: SceneOrbitModalProps) {
  const [loadedModelUrl, setLoadedModelUrl] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)
  const { modelUrl, onClose, open } = props
  const viewerReady = Boolean(modelUrl && loadedModelUrl === modelUrl)

  useEffect(() => {
    if (!open) return

    void import('@google/model-viewer').catch((error: unknown) => {
      // Surface viewer boot failures through the component instead of an
      // unhandled rejection that trips the Next.js development overlay.
      console.warn('Could not initialize the 3D viewer.', error)
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!props.open) return null

  const capture = async () => {
    const viewer = document.getElementById('scene-orbit-model') as ModelViewerElement | null
    if (!viewer || !viewerReady) return
    setCapturing(true)
    try {
      const blob = await viewer.toBlob({ idealAspect: true, mimeType: 'image/png' })
      await props.onCapture(blob)
    } finally {
      setCapturing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-md p-4" role="dialog" aria-modal="true" aria-label="Explore scene in 3D">
      <div className="flex h-[min(820px,94vh)] w-[min(1180px,96vw)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#D95D24]">3D TELEMETRY</span>
              <span className="text-slate-300">/</span>
              <h2 className="m-0 text-lg font-bold text-slate-900">Explore scene</h2>
            </div>
            <p className="m-0 mt-0.5 text-xs text-slate-500">{props.sourceLabel} · rough AI-inferred previz</p>
          </div>
          <button type="button" onClick={props.onClose} className="rounded-full border border-slate-200 bg-slate-100 px-4 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200">Close</button>
        </header>

        <div className="relative min-h-0 flex-1 bg-slate-950">
          {props.status === 'building' ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-[#D95D24]" />
              <p className="m-0 font-mono text-sm uppercase tracking-wider text-white">Building 3D scene…</p>
              <p className="m-0 max-w-sm text-sm text-slate-400">Inferring hidden surfaces and geometry. This usually takes 20–60 seconds.</p>
            </div>
          ) : null}
          {props.status === 'error' ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="m-0 text-base font-semibold text-white">Scene reconstruction failed</p>
              <p className="m-0 max-w-md text-sm text-red-300">{props.error}</p>
              <button type="button" onClick={props.onRetry} className="rounded-full bg-white px-4 py-2 text-xs font-bold text-slate-900 hover:bg-slate-100">Try again</button>
            </div>
          ) : null}
          {props.status === 'ready' && modelUrl
            ? createElement('model-viewer', {
                id: 'scene-orbit-model',
                src: modelUrl,
                alt: `3D reconstruction of ${props.sourceLabel}`,
                'camera-controls': true,
                'auto-rotate': true,
                'shadow-intensity': '1',
                'environment-image': 'neutral',
                exposure: '1',
                className: 'h-full w-full',
                onLoad: () => setLoadedModelUrl(modelUrl),
              } as HTMLAttributes<HTMLElement>)
            : null}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-6 py-4">
          <p className="m-0 font-mono text-xs text-slate-500">Drag to orbit · scroll or pinch to zoom · right-drag to pan</p>
          <button
            type="button"
            disabled={props.status !== 'ready' || !viewerReady || capturing}
            onClick={() => void capture()}
            className="rounded-full bg-[#0F0C59] px-5 py-2 text-xs font-bold text-white transition hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-40 shadow-sm"
          >
            {capturing ? 'Adding angle…' : 'Capture angle + add to board'}
          </button>
        </footer>
      </div>
    </div>
  )
}
