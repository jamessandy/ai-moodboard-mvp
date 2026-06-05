'use client'

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Session } from '@supabase/supabase-js'
import { AssetRecordType, Editor, Tldraw } from 'tldraw'
import { moodboardShapeUtils } from '@/components/moodboardShapes'
import { BoardDoc, SourceImage, cleanHexColors, cleanTags, isMoodboardDocument } from '@/lib/board'
import { StoredBoard } from '@/lib/boards'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'

type ImportState = 'idle' | 'importing'
type GenerationState = 'idle' | 'generating'
type TrayOutput = {
  slot: number
  status: 'pending' | 'done' | 'error'
  url?: string
  width?: number
  height?: number
  error?: string
  seed?: number
}
type PromptPreview = {
  prompt: string
  palette: string[]
  paletteSource: 'none' | 'swatch' | 'extracted'
}
type SaveState = 'idle' | 'loading' | 'saving' | 'saved' | 'error'
type ExtractionState = {
  sourceId: string
  action: 'subject' | 'describe' | 'palette'
} | null

const DEFAULT_SWATCHES = [
  ['#111827', '#f97316', '#f8fafc'],
  ['#264653', '#2a9d8f', '#e9c46a', '#f4a261'],
  ['#0f172a', '#e11d48', '#f1f5f9'],
]

function randomFrom<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)]
}

export function BoardClient() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), [])
  const tldrawLicenseKey = process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY
  const editorRef = useRef<Editor | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sessionRef = useRef<Session | null>(null)
  const boardRef = useRef<StoredBoard | null>(null)
  const suppressSaveRef = useRef(false)
  const [brief, setBrief] = useState('')
  const briefRef = useRef('')
  const [url, setUrl] = useState('')
  const [sources, setSources] = useState<SourceImage[]>([])
  const sourcesRef = useRef<SourceImage[]>([])
  const [extractPrompts, setExtractPrompts] = useState<Record<string, string>>({})
  const [extractionState, setExtractionState] = useState<ExtractionState>(null)
  const [email, setEmail] = useState('')
  const [session, setSession] = useState<Session | null>(null)
  const [boardRecord, setBoardRecord] = useState<StoredBoard | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [shareMessage, setShareMessage] = useState<string | null>(null)
  const [importState, setImportState] = useState<ImportState>('idle')
  const [generationState, setGenerationState] = useState<GenerationState>('idle')
  const [outputs, setOutputs] = useState<TrayOutput[]>([])
  const [selectedOutputSlot, setSelectedOutputSlot] = useState<number | null>(null)
  const [promptPreview, setPromptPreview] = useState<PromptPreview | null>(null)
  const [error, setError] = useState<string | null>(null)

  const shapeUtils = useMemo(() => moodboardShapeUtils, [])

  const isTldrawSnapshot = (document: unknown) =>
    Boolean(document && typeof document === 'object' && 'store' in document && 'schema' in document)

  const getStoredTldrawSnapshot = (document: unknown) =>
    isMoodboardDocument(document) ? document.tldraw : document

  const setSourceList = (nextSources: SourceImage[]) => {
    sourcesRef.current = nextSources
    setSources(nextSources)
  }

  const applyStoredBoard = useCallback((board: StoredBoard) => {
    boardRef.current = board
    setBoardRecord(board)
    setBrief(board.brief ?? '')
    briefRef.current = board.brief ?? ''
    setSourceList(isMoodboardDocument(board.document) ? board.document.sources : [])

    const editor = editorRef.current
    const snapshot = getStoredTldrawSnapshot(board.document)
    if (!editor || !isTldrawSnapshot(snapshot)) return

    suppressSaveRef.current = true
    editor.loadSnapshot(snapshot as Parameters<Editor['loadSnapshot']>[0])
    editor.zoomToFit()
    window.setTimeout(() => {
      suppressSaveRef.current = false
    }, 0)
  }, [])

  const loadBoard = useCallback(
    async (nextSession: Session) => {
      setSaveState('loading')
      setError(null)

      try {
        const response = await fetch('/api/boards', {
          headers: {
            authorization: `Bearer ${nextSession.access_token}`,
          },
        })
        const result = (await response.json()) as { board?: StoredBoard; error?: string }
        if (!response.ok || !result.board) {
          throw new Error(result.error ?? 'Could not load board.')
        }

        applyStoredBoard(result.board)
        setSaveState('saved')
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : 'Could not load board.'
        setError(message)
        setSaveState('error')
      }
    },
    [applyStoredBoard]
  )

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      sessionRef.current = nextSession
      setSession(nextSession)
      if (nextSession) {
        void loadBoard(nextSession)
      } else {
        boardRef.current = null
        setBoardRecord(null)
        setSaveState('idle')
      }
    })

    void supabase.auth.getSession().then(({ data: sessionData }) => {
      sessionRef.current = sessionData.session
      setSession(sessionData.session)
      if (sessionData.session) void loadBoard(sessionData.session)
    })

    return () => {
      data.subscription.unsubscribe()
    }
  }, [loadBoard, supabase])

  const saveBoard = useCallback(async () => {
    const currentSession = sessionRef.current
    const currentBoard = boardRef.current
    const editor = editorRef.current

    if (!currentSession || !currentBoard || !editor || suppressSaveRef.current) return

    setSaveState('saving')

    try {
      const response = await fetch(`/api/boards/${currentBoard.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${currentSession.access_token}`,
        },
        body: JSON.stringify({
          brief: briefRef.current,
          document: {
            version: 2,
            sources: sourcesRef.current,
            tldraw: editor.store.getStoreSnapshot('document'),
          },
        }),
      })
      const result = (await response.json()) as { board?: StoredBoard; error?: string }

      if (!response.ok || !result.board) {
        throw new Error(result.error ?? 'Could not autosave board.')
      }

      boardRef.current = result.board
      setBoardRecord(result.board)
      setSaveState('saved')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not autosave board.'
      setError(message)
      setSaveState('error')
    }
  }, [])

  const scheduleSave = useCallback(() => {
    if (!sessionRef.current || !boardRef.current || suppressSaveRef.current) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      void saveBoard()
    }, 900)
  }, [saveBoard])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  const getBoardId = () => {
    const persistedBoard = boardRef.current
    if (persistedBoard) return persistedBoard.id

    const existing = window.localStorage.getItem('moodboard-board-id')
    if (existing) return existing

    const next = crypto.randomUUID()
    window.localStorage.setItem('moodboard-board-id', next)
    return next
  }

  const sendMagicLink = async () => {
    const trimmed = email.trim()
    if (!trimmed) {
      setError('Enter an email for the magic link.')
      return
    }

    setError(null)
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {
        emailRedirectTo: window.location.origin,
      },
    })

    if (signInError) {
      setError(signInError.message)
      return
    }

    setShareMessage('Magic link sent.')
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setShareMessage(null)
  }

  const copyShareLink = async () => {
    if (!boardRecord) return
    const href = `${window.location.origin}/b/${boardRecord.share_id}`
    await navigator.clipboard.writeText(href)
    setShareMessage('Share link copied.')
  }

  const createAtViewportCenter = useCallback((shape: Parameters<Editor['createShape']>[0]) => {
    const editor = editorRef.current
    if (!editor) return

    const viewport = editor.getViewportPageBounds()
    const x = viewport.x + viewport.w / 2 - 140 + Math.random() * 36
    const y = viewport.y + viewport.h / 2 - 90 + Math.random() * 36
    editor.createShape({ ...shape, x, y } as Parameters<Editor['createShape']>[0])
  }, [])

  const createElementAtPoint = useCallback(
    (
      input: { imageUrl: string; label: string; sourceId: string; width?: number; height?: number },
      point?: { x: number; y: number }
    ) => {
      const editor = editorRef.current
      if (!editor) return

      const w = input.width ?? 512
      const h = input.height ?? 512
      const fallback = editor.getViewportPageBounds().center
      const x = (point?.x ?? fallback.x) - w / 2
      const y = (point?.y ?? fallback.y) - h / 2
      const asset = AssetRecordType.create({
        id: AssetRecordType.createId(),
        type: 'image',
        props: {
          src: input.imageUrl,
          w,
          h,
          mimeType: 'image/png',
          name: `${input.label || 'element'}.png`,
          isAnimated: false,
        },
      })

      editor.createAssets([asset])
      editor.createShape({
        type: 'element',
        x,
        y,
        props: {
          url: input.imageUrl,
          assetId: asset.id,
          label: input.label || 'element',
          sourceId: input.sourceId,
          tags: [],
          w,
          h,
        },
      })
      scheduleSave()
    },
    [scheduleSave]
  )

  const downloadOutput = useCallback(async (output: TrayOutput) => {
    if (output.status !== 'done' || !output.url) return
    setSelectedOutputSlot(output.slot)

    try {
      const response = await fetch(output.url)
      if (!response.ok) throw new Error(`Could not fetch output (${response.status}).`)

      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = `generated-${output.slot + 1}.png`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(objectUrl)
    } catch {
      window.open(output.url, '_blank', 'noopener,noreferrer')
    }
  }, [])

  const getBoardDoc = useCallback((): BoardDoc => {
    const editor = editorRef.current
    const shapes = editor?.getCurrentPageShapes() ?? []

    return {
      brief: brief.trim(),
      elements: shapes
        .filter((shape) => shape.type === 'element')
        .map((shape) => {
          const props = shape.props as { url?: string; label?: string; tags?: string[] }
          return { url: props.url ?? '', label: props.label?.trim() || 'element', tags: cleanTags(props.tags ?? []) }
        })
        .filter((element) => element.url),
      imageRefs: shapes
        .filter((shape) => shape.type === 'image-ref')
        .map((shape) => {
          const props = shape.props as { url?: string; tags?: string[] }
          return { url: props.url ?? '', tags: cleanTags(props.tags ?? []) }
        })
        .filter((ref) => ref.url),
      swatches: shapes
        .filter((shape) => shape.type === 'swatch')
        .map((shape) => {
          const props = shape.props as { colors?: string[] }
          return { colors: cleanHexColors(props.colors ?? []) }
        })
        .filter((swatch) => swatch.colors.length),
      typeSamples: shapes
        .filter((shape) => shape.type === 'type-sample')
        .map((shape) => {
          const props = shape.props as { label?: string }
          return { label: props.label?.trim() ?? '' }
        })
        .filter((sample) => sample.label),
      notes: shapes
        .filter((shape) => shape.type === 'note')
        .map((shape) => {
          const props = shape.props as { text?: string }
          return { text: props.text?.trim() ?? '' }
        })
        .filter((note) => note.text),
    }
  }, [brief])

  const importImage = useCallback(
    async (payload: { file?: File; url?: string }) => {
      setError(null)
      setImportState('importing')

      try {
        const formData = new FormData()
        if (payload.file) formData.set('file', payload.file)
        if (payload.url) formData.set('url', payload.url)

        const response = await fetch('/api/import-image', {
          method: 'POST',
          body: formData,
        })
        const result = (await response.json()) as { url?: string; error?: string }

        if (!response.ok || !result.url) {
          throw new Error(result.error ?? 'Image import failed.')
        }

        const nextSources = [...sourcesRef.current, { id: crypto.randomUUID(), url: result.url }]
        setSourceList(nextSources)
        scheduleSave()
        setUrl('')
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : 'Image import failed.'
        setError(message)
      } finally {
        setImportState('idle')
      }
    },
    [scheduleSave]
  )

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) void importImage({ file })
    event.target.value = ''
  }

  const updateBrief = (nextBrief: string) => {
    setBrief(nextBrief)
    briefRef.current = nextBrief
    scheduleSave()
  }

  const addUrlImage = () => {
    const trimmed = url.trim()
    if (trimmed) void importImage({ url: trimmed })
  }

  const extractSource = async (source: SourceImage, action: 'subject' | 'describe') => {
    const prompt = extractPrompts[source.id]?.trim()
    if (action === 'describe' && !prompt) {
      setError('Describe what to extract from the source.')
      return
    }

    setError(null)
    setExtractionState({ sourceId: source.id, action })

    try {
      const response = await fetch('/api/extract', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionRef.current ? { authorization: `Bearer ${sessionRef.current.access_token}` } : {}),
        },
        body: JSON.stringify({
          sourceUrl: source.url,
          mode: action,
          prompt: action === 'describe' ? prompt : undefined,
        }),
      })
      const result = (await response.json()) as { url?: string; width?: number; height?: number; error?: string }

      if (!response.ok || !result.url) {
        throw new Error(result.error ?? 'Extraction failed.')
      }

      createElementAtPoint({
        imageUrl: result.url,
        label: action === 'describe' ? prompt ?? 'element' : 'subject',
        sourceId: source.id,
        width: result.width,
        height: result.height,
      })
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Extraction failed.'
      setError(message)
    } finally {
      setExtractionState(null)
    }
  }

  const extractPalette = async (source: SourceImage) => {
    setError(null)
    setExtractionState({ sourceId: source.id, action: 'palette' })

    try {
      const response = await fetch('/api/extract-palette', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceUrl: source.url }),
      })
      const result = (await response.json()) as { colors?: string[]; error?: string }

      if (!response.ok || !result.colors?.length) {
        throw new Error(result.error ?? 'Palette extraction failed.')
      }

      createAtViewportCenter({
        type: 'swatch',
        props: { colors: result.colors, w: 280, h: 96 },
      })
      scheduleSave()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Palette extraction failed.'
      setError(message)
    } finally {
      setExtractionState(null)
    }
  }

  const pasteClipboardImage = async () => {
    try {
      setError(null)
      const items = await navigator.clipboard.read()
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith('image/'))
        if (imageType) {
          const blob = await item.getType(imageType)
          await importImage({
            file: new File([blob], `clipboard.${imageType.split('/')[1]}`, { type: imageType }),
          })
          return
        }
      }
      setError('Clipboard does not contain an image.')
    } catch {
      setError('Clipboard image access was blocked.')
    }
  }

  const generate = async () => {
    setError(null)
    setPromptPreview(null)
    setSelectedOutputSlot(null)
    setGenerationState('generating')
    setOutputs(Array.from({ length: 6 }, (_, slot) => ({ slot, status: 'pending' })))

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionRef.current ? { authorization: `Bearer ${sessionRef.current.access_token}` } : {}),
        },
        body: JSON.stringify({ boardId: getBoardId(), count: 6, board: getBoardDoc() }),
      })

      if (!response.ok || !response.body) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(result?.error ?? 'Generation failed.')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          const event = JSON.parse(line) as
            | {
                type: 'start'
                count: number
                prompt: string
                palette: string[]
                paletteSource: PromptPreview['paletteSource']
              }
            | { type: 'output'; slot: number; url: string; width?: number; height?: number; seed: number }
            | { type: 'error'; slot: number; error: string }
            | { type: 'done' }

          if (event.type === 'start') {
            setPromptPreview({
              prompt: event.prompt,
              palette: event.palette,
              paletteSource: event.paletteSource,
            })
          }

          if (event.type === 'output') {
            setOutputs((current) =>
              current.map((item) =>
                item.slot === event.slot
                  ? {
                      slot: event.slot,
                      status: 'done',
                      url: event.url,
                      width: event.width,
                      height: event.height,
                      seed: event.seed,
                    }
                  : item
              )
            )
          }

          if (event.type === 'error') {
            setOutputs((current) =>
              current.map((item) =>
                item.slot === event.slot
                  ? { slot: event.slot, status: 'error', error: event.error }
                  : item
              )
            )
          }
        }
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Generation failed.'
      setError(message)
      setOutputs((current) =>
        current.map((item) => (item.status === 'pending' ? { ...item, status: 'error', error: message } : item))
      )
    } finally {
      setGenerationState('idle')
    }
  }

  return (
    <main className="flex h-screen min-h-[720px] flex-col bg-[#f4f1ea] text-neutral-950">
      <header className="flex flex-col gap-3 border-b border-neutral-950/10 bg-[#fbfaf6] px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={brief}
            onChange={(event) => updateBrief(event.target.value)}
            placeholder="One-line brief"
            className="h-10 min-w-[260px] flex-1 rounded border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-neutral-950"
          />
          <button
            type="button"
            className="h-10 rounded bg-neutral-950 px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => fileInputRef.current?.click()}
            disabled={importState === 'importing'}
          >
            Upload
          </button>
          <button
            type="button"
            className="h-10 rounded border border-neutral-300 bg-white px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            onClick={pasteClipboardImage}
            disabled={importState === 'importing'}
          >
            Clipboard
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            type="button"
            className="h-10 rounded bg-[#0f766e] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            onClick={generate}
            disabled={generationState === 'generating'}
          >
            Generate
          </button>
          {session ? (
            <>
              <button
                type="button"
                className="h-10 rounded border border-neutral-300 bg-white px-3 text-sm font-semibold"
                onClick={copyShareLink}
                disabled={!boardRecord}
              >
                Share
              </button>
              <button
                type="button"
                className="h-10 rounded border border-neutral-300 bg-white px-3 text-sm font-semibold"
                onClick={signOut}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Email for save"
                className="h-10 w-52 rounded border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-neutral-950"
              />
              <button
                type="button"
                className="h-10 rounded border border-neutral-300 bg-white px-3 text-sm font-semibold"
                onClick={sendMagicLink}
              >
                Save login
              </button>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addUrlImage()
            }}
            placeholder="Paste source image URL"
            className="h-9 min-w-[240px] flex-1 rounded border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-neutral-950"
          />
          <button
            type="button"
            className="h-9 rounded border border-neutral-300 bg-white px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            onClick={addUrlImage}
            disabled={importState === 'importing'}
          >
            Add source
          </button>
          <button
            type="button"
            className="h-9 rounded border border-neutral-300 bg-white px-3 text-sm font-semibold"
            onClick={() =>
              createAtViewportCenter({
                type: 'swatch',
                props: { colors: randomFrom(DEFAULT_SWATCHES), w: 240, h: 92 },
              })
            }
          >
            Swatch
          </button>
          <button
            type="button"
            className="h-9 rounded border border-neutral-300 bg-white px-3 text-sm font-semibold"
            onClick={() => {
              const label = window.prompt('Type sample label', 'Condensed grotesk / wide tracking')
              if (label) {
                createAtViewportCenter({
                  type: 'type-sample',
                  props: { label, w: 340, h: 96 },
                })
              }
            }}
          >
            Type
          </button>
          <button
            type="button"
            className="h-9 rounded border border-neutral-300 bg-white px-3 text-sm font-semibold"
            onClick={() => {
              const text = window.prompt('Note', 'sun-bleached, intimate, tactile')
              if (text) {
                createAtViewportCenter({
                  type: 'note',
                  props: { text, w: 250, h: 150 },
                })
              }
            }}
          >
            Note
          </button>
          {importState === 'importing' ? <span className="text-sm text-neutral-600">Importing...</span> : null}
          {session ? <span className="text-sm text-neutral-600">{saveState}</span> : null}
          {shareMessage ? <span className="text-sm text-neutral-600">{shareMessage}</span> : null}
          {error ? <span className="text-sm font-medium text-red-700">{error}</span> : null}
        </div>
      </header>

      <section className="flex min-h-0 flex-1">
        <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-r border-neutral-950/10 bg-[#fbfaf6] p-3">
          <div>
            <h2 className="m-0 text-sm font-semibold">Sources</h2>
            <p className="m-0 mt-1 text-xs text-neutral-500">Full images stay here. Extract cutouts to compose.</p>
          </div>
          {sources.length ? (
            sources.map((source) => {
              const busy = extractionState?.sourceId === source.id
              return (
                <div key={source.id} className="rounded border border-neutral-300 bg-white p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={source.url} alt="" className="aspect-video w-full rounded object-cover" />
                  <div className="mt-2 grid gap-2">
                    <button
                      type="button"
                      className="h-9 rounded bg-neutral-950 px-3 text-sm font-semibold text-white disabled:opacity-50"
                      disabled={busy}
                      onClick={() => void extractSource(source, 'subject')}
                    >
                      {busy && extractionState?.action === 'subject' ? 'Extracting...' : 'Extract subject'}
                    </button>
                    <div className="flex gap-2">
                      <input
                        value={extractPrompts[source.id] ?? ''}
                        onChange={(event) =>
                          setExtractPrompts((current) => ({ ...current, [source.id]: event.target.value }))
                        }
                        placeholder="the chair"
                        className="min-w-0 flex-1 rounded border border-neutral-300 px-2 text-sm outline-none focus:border-neutral-950"
                      />
                      <button
                        type="button"
                        className="rounded border border-neutral-300 px-2 text-sm font-semibold disabled:opacity-50"
                        disabled={busy}
                        onClick={() => void extractSource(source, 'describe')}
                      >
                        Extract
                      </button>
                    </div>
                    <button
                      type="button"
                      className="h-9 rounded border border-neutral-300 px-3 text-sm font-semibold disabled:opacity-50"
                      disabled={busy}
                      onClick={() => void extractPalette(source)}
                    >
                      {busy && extractionState?.action === 'palette' ? 'Extracting...' : 'Extract palette'}
                    </button>
                  </div>
                </div>
              )
            })
          ) : (
            <p className="m-0 rounded border border-dashed border-neutral-300 p-3 text-sm text-neutral-500">
              Upload, paste a URL, or use the clipboard to add source images.
            </p>
          )}
        </aside>

        <div className="min-w-0 flex-1">
          <Tldraw
            licenseKey={tldrawLicenseKey}
            shapeUtils={shapeUtils}
            onMount={(editor) => {
              editorRef.current = editor
              const snapshot = boardRef.current ? getStoredTldrawSnapshot(boardRef.current.document) : null
              if (snapshot && isTldrawSnapshot(snapshot)) {
                suppressSaveRef.current = true
                editor.loadSnapshot(snapshot as Parameters<Editor['loadSnapshot']>[0])
                editor.zoomToFit()
                window.setTimeout(() => {
                  suppressSaveRef.current = false
                }, 0)
              }
              editor.store.listen(
                () => {
                  scheduleSave()
                },
                { source: 'user', scope: 'document' }
              )
            }}
          />
        </div>
      </section>

      <aside className="flex min-h-[190px] gap-4 overflow-x-auto border-t border-neutral-950/10 bg-[#fbfaf6] px-4 py-3">
        <div className="flex shrink-0 items-center gap-3">
          {outputs.length ? (
            outputs.map((output) => (
              <div
                key={output.slot}
                className={`flex h-40 w-40 shrink-0 flex-col overflow-hidden rounded border bg-white transition ${
                  selectedOutputSlot === output.slot
                    ? 'border-[#0f766e] ring-2 ring-[#0f766e]/30'
                    : 'border-neutral-300'
                }`}
                onClick={() => setSelectedOutputSlot(output.slot)}
              >
                {output.status === 'pending' ? (
                  <div className="flex h-full w-full items-center justify-center">
                    <span className="text-sm text-neutral-500">Generating</span>
                  </div>
                ) : null}
                {output.status === 'error' ? (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-2 text-center">
                    <span className="text-xs font-medium text-red-700">{output.error}</span>
                    <button
                      type="button"
                      className="rounded bg-neutral-950 px-3 py-1.5 text-xs font-semibold text-white"
                      onClick={(event) => {
                        event.stopPropagation()
                        void generate()
                      }}
                    >
                      Retry
                    </button>
                  </div>
                ) : null}
                {output.status === 'done' && output.url ? (
                  <>
                    <button
                      type="button"
                      className="min-h-0 flex-1"
                      title="Select output"
                      onClick={(event) => {
                        event.stopPropagation()
                        setSelectedOutputSlot(output.slot)
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={output.url} alt="" className="h-full w-full object-cover" draggable={false} />
                    </button>
                    <button
                      type="button"
                      className="h-10 w-full border-t border-neutral-200 bg-[#0f766e] px-2 text-sm font-semibold text-white"
                      onClick={(event) => {
                        event.stopPropagation()
                        void downloadOutput(output)
                      }}
                    >
                      Download
                    </button>
                  </>
                ) : null}
              </div>
            ))
          ) : (
            <p className="m-0 w-64 text-sm text-neutral-600">Generated outputs will appear here.</p>
          )}
        </div>

        {promptPreview ? (
          <div className="min-w-[320px] max-w-[620px] border-l border-neutral-950/10 pl-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase text-neutral-500">
                Palette: {promptPreview.paletteSource}
              </span>
              {promptPreview.palette.map((color) => (
                <span
                  key={color}
                  className="h-5 w-8 rounded border border-neutral-950/20"
                  title={color}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <p className="m-0 max-h-28 overflow-y-auto text-sm leading-snug text-neutral-700">
              {promptPreview.prompt}
            </p>
          </div>
        ) : null}
      </aside>
    </main>
  )
}
