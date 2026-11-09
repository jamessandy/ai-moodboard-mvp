'use client'

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Session } from '@supabase/supabase-js'
import { AssetRecordType, Editor, Tldraw, TLEditorSnapshot, TLComponents, TLStoreSnapshot, createShapeId } from 'tldraw'
import { moodboardShapeUtils } from '@/components/moodboardShapes'
import { SceneOrbitModal } from '@/components/SceneOrbitModal'
import { ExplorePanel } from '@/components/ExplorePanel'
import { AuthCard } from '@/components/AuthCard'
import { captureClientEvent } from '@/lib/analytics/client'
import {
  BoardDoc,
  ChatMessage,
  SOURCE_ROLES,
  SOURCE_ROLE_LABELS,
  SourceImage,
  SourceRole,
  cleanHexColors,
  cleanSourceRole,
  cleanTags,
  isMoodboardDocument,
} from '@/lib/board'
import { StoredBoard } from '@/lib/boards'
import { extractForegroundWithGrabCut } from '@/lib/grabcut'
import { APP_NAME, getBrowserAppUrl } from '@/lib/site'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'
import { IMAGES_PER_GENERATION } from '@/lib/usage-constants'

type ImportState = 'idle' | 'importing'
type GenerationState = 'idle' | 'generating'
type ComposingState = 'idle' | 'composing'
type ChatState = 'idle' | 'thinking' | 'generating'
type ComposePosition = 'top-left' | 'top' | 'top-right' | 'left' | 'center' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right'
type TrayOutput = {
  slot: number
  status: 'pending' | 'done' | 'error'
  name?: string
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
type AuthMode = 'login' | 'signup'
type ExtractionState = {
  sourceId: string
  action: 'subject' | 'describe' | 'palette' | 'full'
} | null
type UsageQuota = {
  creditsBalance: number
}
type OrbitSource = { url: string; label: string }
type OrbitStatus = 'idle' | 'building' | 'ready' | 'error'

const DEFAULT_SWATCHES = [
  ['#111827', '#f97316', '#f8fafc'],
  ['#264653', '#2a9d8f', '#e9c46a', '#f4a261'],
  ['#0f172a', '#e11d48', '#f1f5f9'],
]
const COMPOSE_POSITIONS: Array<{ id: ComposePosition; label: string; x: number; y: number }> = [
  { id: 'top-left', label: 'TL', x: 0.22, y: 0.22 },
  { id: 'top', label: 'T', x: 0.5, y: 0.22 },
  { id: 'top-right', label: 'TR', x: 0.78, y: 0.22 },
  { id: 'left', label: 'L', x: 0.22, y: 0.5 },
  { id: 'center', label: 'C', x: 0.5, y: 0.5 },
  { id: 'right', label: 'R', x: 0.78, y: 0.5 },
  { id: 'bottom-left', label: 'BL', x: 0.22, y: 0.78 },
  { id: 'bottom', label: 'B', x: 0.5, y: 0.78 },
  { id: 'bottom-right', label: 'BR', x: 0.78, y: 0.78 },
]

function randomFrom<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)]
}

function generatedImageName(slot: number) {
  return `Generated ${slot + 1}`
}

function composedImageName(slot: number) {
  return `Composed ${slot + 1}`
}

function cleanReferenceName(name: string | undefined, fallback: string) {
  return name?.trim() || fallback
}

function prettyNameFromPath(path: string) {
  const segment = path.split('/').filter(Boolean).at(-1) ?? ''
  let decoded = segment
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    decoded = segment
  }

  return decoded
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function defaultSourceName(payload: { file?: File; url?: string }, index: number) {
  if (payload.file?.name) {
    const name = prettyNameFromPath(payload.file.name)
    if (name) return name
  }

  if (payload.url) {
    try {
      const name = prettyNameFromPath(new URL(payload.url).pathname)
      if (name) return name
    } catch {
      const name = prettyNameFromPath(payload.url)
      if (name) return name
    }
  }

  return `Source ${index + 1}`
}

function sourceReferenceLabel(source: SourceImage, index: number) {
  return cleanReferenceName(source.name, `source ${index + 1}`)
}

function loadImageDimensions(src: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image()
    const timeout = window.setTimeout(() => reject(new Error('Image dimension lookup timed out.')), 5000)

    image.onload = () => {
      window.clearTimeout(timeout)
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => {
      window.clearTimeout(timeout)
      reject(new Error('Could not read source image dimensions.'))
    }
    image.src = src
  })
}

function downloadName(name: string | undefined, fallback: string) {
  return cleanReferenceName(name, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback.toLowerCase()
}

function isInvalidRefreshTokenError(error: unknown) {
  if (!error) return false
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error)
  return /invalid refresh token|refresh token.*already used|already used|failed to fetch|network_unavailable|network unavailable/i.test(
    message
  )
}

function isLikelyNewAuthUser(session: Session) {
  const createdAt = Date.parse(session.user.created_at)
  const lastSignInAt = Date.parse(session.user.last_sign_in_at ?? '')
  if (!Number.isFinite(createdAt) || !Number.isFinite(lastSignInAt)) return false

  return Math.abs(lastSignInAt - createdAt) < 10_000
}

function getAuthMethod(session: Session, pendingMethod: string | null) {
  if (pendingMethod) return pendingMethod

  const provider = session.user.app_metadata.provider
  return typeof provider === 'string' ? provider : 'oauth_or_magic_link'
}

function getStoredChatMessages(document: unknown): ChatMessage[] {
  if (!isMoodboardDocument(document) || !Array.isArray(document.chat)) return []

  return document.chat
    .filter(
      (message): message is ChatMessage =>
        Boolean(
          message &&
            typeof message === 'object' &&
            typeof message.id === 'string' &&
            (message.role === 'user' || message.role === 'assistant') &&
            typeof message.content === 'string' &&
            typeof message.createdAt === 'string'
        )
    )
    .map((message) => ({
      ...message,
      images: Array.isArray(message.images)
        ? message.images.filter((image) => image && typeof image.url === 'string')
            .map((image) => ({
              ...image,
              name: typeof image.name === 'string' ? image.name : undefined,
            }))
        : undefined,
    }))
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isLegacyMoodboardNoteRecord(record: unknown) {
  if (!isRecordObject(record) || record.typeName !== 'shape' || record.type !== 'note') return false
  if (!isRecordObject(record.props)) return false

  return (
    typeof record.props.text === 'string' &&
    typeof record.props.w === 'number' &&
    typeof record.props.h === 'number'
  )
}

function migrateMoodboardNoteSnapshot(snapshot: TLEditorSnapshot | TLStoreSnapshot) {
  if (!('store' in snapshot) || !isRecordObject(snapshot.store)) return snapshot

  let changed = false
  const nextStore: Record<string, unknown> = {}

  for (const [id, record] of Object.entries(snapshot.store)) {
    if (isLegacyMoodboardNoteRecord(record)) {
      changed = true
      nextStore[id] = { ...record, type: 'moodboard-note' }
    } else {
      nextStore[id] = record
    }
  }

  return changed ? ({ ...snapshot, store: nextStore } as TLEditorSnapshot | TLStoreSnapshot) : snapshot
}

export function BoardClient() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), [])
  const tldrawLicenseKey = process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY
  const editorRef = useRef<Editor | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sessionRef = useRef<Session | null>(null)
  const pendingAuthMethodRef = useRef<string | null>(null)
  const boardRef = useRef<StoredBoard | null>(null)
  const initialSnapshotRef = useRef<TLEditorSnapshot | TLStoreSnapshot | undefined>(undefined)
  const suppressSaveRef = useRef(false)
  const [brief, setBrief] = useState('')
  const briefRef = useRef('')
  const [url, setUrl] = useState('')
  const [sources, setSources] = useState<SourceImage[]>([])
  const sourcesRef = useRef<SourceImage[]>([])
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const chatMessagesRef = useRef<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatState, setChatState] = useState<ChatState>('idle')
  const [chatPanelOpen, setChatPanelOpen] = useState(false)
  const [sourcesOpen, setSourcesOpen] = useState(true)
  const [commentMode, setCommentMode] = useState(false)
  const [explorePanelOpen, setExplorePanelOpen] = useState(false)
  const [showResolvedComments, setShowResolvedComments] = useState(true)
  const [extractPrompts, setExtractPrompts] = useState<Record<string, string>>({})
  const [extractionState, setExtractionState] = useState<ExtractionState>(null)
  const [authReady, setAuthReady] = useState(false)
  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authConfirmPassword, setAuthConfirmPassword] = useState('')
  const [authSubmitting, setAuthSubmitting] = useState(false)
  const [authMessage, setAuthMessage] = useState<string | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [isGuest, setIsGuest] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('moodboard-guest-mode') === 'true'
  })

  const enterGuestMode = () => {
    setIsGuest(true)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('moodboard-guest-mode', 'true')
    }
    setError(null)
  }
  const [quota, setQuota] = useState<UsageQuota | null>(null)
  const [creditModalOpen, setCreditModalOpen] = useState(false)
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)
  const [boardRecord, setBoardRecord] = useState<StoredBoard | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [shareMessage, setShareMessage] = useState<string | null>(null)
  const [importState, setImportState] = useState<ImportState>('idle')
  const [generationState, setGenerationState] = useState<GenerationState>('idle')
  const [composingState, setComposingState] = useState<ComposingState>('idle')
  const [outputs, setOutputs] = useState<TrayOutput[]>([])
  const [selectedOutputSlot, setSelectedOutputSlot] = useState<number | null>(null)
  const [orbitSource, setOrbitSource] = useState<OrbitSource | null>(null)
  const [orbitStatus, setOrbitStatus] = useState<OrbitStatus>('idle')
  const [orbitModelUrl, setOrbitModelUrl] = useState<string | null>(null)
  const [orbitError, setOrbitError] = useState<string | null>(null)
  const [composeHeadline, setComposeHeadline] = useState('')
  const [composeFontName, setComposeFontName] = useState('Anton')
  const [composeFontUrl, setComposeFontUrl] = useState('')
  const [composeFontWeight, setComposeFontWeight] = useState(400)
  const [composeColor, setComposeColor] = useState('#ffffff')
  const [composeFontSizeRatio, setComposeFontSizeRatio] = useState(0.12)
  const [composePosition, setComposePosition] = useState<ComposePosition>('center')
  const [composeOutline, setComposeOutline] = useState(true)
  const [composeOutlineColor, setComposeOutlineColor] = useState('#111827')
  const [error, setError] = useState<string | null>(null)
  const [generationModel, setGenerationModel] = useState<string>('hf-spaces/black-forest-labs/FLUX.2-dev')
  const generationModelRef = useRef(generationModel)

  const shapeUtils = useMemo(() => moodboardShapeUtils, [])
  const [isToolbarCollapsed, setIsToolbarCollapsed] = useState(false)
  const tldrawComponents = useMemo<TLComponents>(
    () => ({
      StylePanel: null,
      Toolbar: isToolbarCollapsed ? null : undefined,
    }),
    [isToolbarCollapsed]
  )
  const selectedOutput = useMemo(
    () => outputs.find((output) => output.slot === selectedOutputSlot && output.status === 'done' && output.url),
    [outputs, selectedOutputSlot]
  )
  const canGenerate = Boolean(quota && quota.creditsBalance > 0)
  const quotaBlocked = Boolean(quota && quota.creditsBalance <= 0)

  const [canvasTheme, setCanvasTheme] = useState<'light' | 'dark'>('light')
  const [rightPanelTab, setRightPanelTab] = useState<'explore' | 'chat'>('explore')
  const [sidebarTab, setSidebarTab] = useState<'variations' | 'sources'>('variations')
  const [filmstripView, setFilmstripView] = useState<'carousel' | 'grid'>('carousel')
  const [filterModelOnly, setFilterModelOnly] = useState(false)
  const [showComposeDrawer, setShowComposeDrawer] = useState(false)
  const [zoomLevelPercent, setZoomLevelPercent] = useState(100)
  const [canvasStats, setCanvasStats] = useState({
    imageCount: 0,
    swatchCount: 0,
    typeCount: 0,
    noteCount: 0,
    palette: [] as string[],
    dnaDensity: 74,
    axes: { color: 65, composition: 75, mood: 80, texture: 60 },
  })

  const refreshCanvasStats = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    try {
      const shapes = editor.getCurrentPageShapes()
      let imageCount = 0
      let swatchCount = 0
      let typeCount = 0
      let noteCount = 0
      const paletteSet = new Set<string>()

      for (const s of shapes) {
        if (s.type === 'element' || s.type === 'image-ref') imageCount++
        else if (s.type === 'swatch') {
          swatchCount++
          const colors = (s.props as { colors?: string[] }).colors ?? []
          for (const c of colors) paletteSet.add(c)
        } else if (s.type === 'type-sample') typeCount++
        else if (s.type === 'moodboard-note') noteCount++
      }

      const paletteColors = paletteSet.size > 0 
        ? Array.from(paletteSet).slice(0, 6) 
        : ['#0F0C59', '#1A167A', '#D95D24', '#FCECD5', '#2A24A8']

      const colorScore = Math.min(100, Math.round(swatchCount * 28 + paletteSet.size * 12 + 10))
      const compScore = Math.min(100, Math.round(imageCount * 22 + (sourcesRef.current.length ? 25 : 10)))
      const moodScore = Math.min(100, Math.round((briefRef.current ? 40 : 15) + noteCount * 20 + 15))
      const textureScore = Math.min(100, Math.round(typeCount * 30 + imageCount * 14 + 10))
      const dnaDensity = Math.min(98, Math.max(24, Math.round((colorScore + compScore + moodScore + textureScore) / 4)))

      setCanvasStats({
        imageCount,
        swatchCount,
        typeCount,
        noteCount,
        palette: paletteColors,
        dnaDensity,
        axes: {
          color: Math.max(15, colorScore),
          composition: Math.max(15, compScore),
          mood: Math.max(15, moodScore),
          texture: Math.max(15, textureScore),
        },
      })
      setZoomLevelPercent(Math.round(editor.getZoomLevel() * 100))
    } catch {
      // non-fatal
    }
  }, [])

  const handleZoomToFit = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    const shapes = editor.getCurrentPageShapes()
    if (shapes.length > 0) {
      editor.zoomToFit({ animation: { duration: 200 } })
      if (shapes.length <= 8 && editor.getZoomLevel() < 0.5) {
        const pageBounds = editor.getCurrentPageBounds()
        if (pageBounds) {
          editor.centerOnPoint({ x: pageBounds.center.x, y: pageBounds.center.y }, { animation: { duration: 200 } })
          editor.resetZoom(editor.getViewportScreenCenter(), { animation: { duration: 200 } })
        }
      }
    } else {
      editor.resetZoom(editor.getViewportScreenCenter(), { animation: { duration: 200 } })
    }
    refreshCanvasStats()
  }, [refreshCanvasStats])

  const isTldrawSnapshot = (document: unknown) =>
    Boolean(document && typeof document === 'object' && 'store' in document && 'schema' in document)

  const getStoredTldrawSnapshot = (document: unknown) =>
    isMoodboardDocument(document) ? document.tldraw : document

  const tldrawSnapshot = useMemo(() => {
    if (initialSnapshotRef.current) return initialSnapshotRef.current
    const snapshot = boardRecord ? getStoredTldrawSnapshot(boardRecord.document) : null
    const valid = isTldrawSnapshot(snapshot)
      ? migrateMoodboardNoteSnapshot(snapshot as TLEditorSnapshot | TLStoreSnapshot)
      : undefined
    if (valid) initialSnapshotRef.current = valid
    return valid
  }, [boardRecord])

  const setSourceList = (nextSources: SourceImage[]) => {
    sourcesRef.current = nextSources
    setSources(nextSources)
  }

  const resetPersistedSession = useCallback(() => {
    sessionRef.current = null
    setSession(null)
    boardRef.current = null
    initialSnapshotRef.current = undefined
    setBoardRecord(null)
    setQuota(null)
    chatMessagesRef.current = []
    setChatMessages([])
    setSaveState('idle')
  }, [])

  const applyStoredBoard = useCallback((board: StoredBoard) => {
    const storedChat = getStoredChatMessages(board.document)
    boardRef.current = board
    setBoardRecord(board)
    setBrief(board.brief ?? '')
    briefRef.current = board.brief ?? ''
    setSourceList(
      isMoodboardDocument(board.document)
        ? board.document.sources.map((source) => ({
            ...source,
            name: typeof source.name === 'string' ? source.name : undefined,
            role: cleanSourceRole(source.role),
          }))
        : []
    )
    chatMessagesRef.current = storedChat
    setChatMessages(storedChat)

    const editor = editorRef.current
    if (editor && isMoodboardDocument(board.document)) {
      const rawSnapshot = getStoredTldrawSnapshot(board.document)
      if (isTldrawSnapshot(rawSnapshot)) {
        const valid = migrateMoodboardNoteSnapshot(rawSnapshot as TLEditorSnapshot | TLStoreSnapshot)
        try {
          suppressSaveRef.current = true
          editor.loadSnapshot(valid)
          window.setTimeout(() => {
            const shapes = editor.getCurrentPageShapes()
            if (shapes.length > 0) {
              editor.zoomToFit({ animation: { duration: 0 } })
              if (shapes.length <= 8 && editor.getZoomLevel() < 0.5) {
                const pageBounds = editor.getCurrentPageBounds()
                if (pageBounds) {
                  editor.centerOnPoint({ x: pageBounds.center.x, y: pageBounds.center.y }, { animation: { duration: 0 } })
                  editor.resetZoom(editor.getViewportScreenCenter(), { animation: { duration: 0 } })
                }
              }
            }
            suppressSaveRef.current = false
            refreshCanvasStats()
          }, 80)
        } catch (e) {
          console.warn('Failed to apply board snapshot to existing editor', e)
          suppressSaveRef.current = false
        }
      }
    }
  }, [refreshCanvasStats])

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

  const loadQuota = useCallback(async (nextSession: Session) => {
    try {
      const response = await fetch('/api/profile', {
        headers: {
          authorization: `Bearer ${nextSession.access_token}`,
        },
      })
      const result = (await response.json()) as Partial<UsageQuota> & { error?: string }

      if (!response.ok || typeof result.creditsBalance !== 'number') {
        throw new Error(result.error ?? 'Could not load credit balance.')
      }

      setQuota({ creditsBalance: result.creditsBalance })
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not load credit balance.'
      setError(message)
    }
  }, [])

  const loadAuthenticatedState = useCallback(
    (nextSession: Session) => {
      void loadQuota(nextSession)
      void loadBoard(nextSession)
    },
    [loadBoard, loadQuota]
  )

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      sessionRef.current = nextSession
      setSession(nextSession)
      setAuthReady(true)
      if (nextSession) {
        if (event === 'SIGNED_IN') {
          const method = getAuthMethod(nextSession, pendingAuthMethodRef.current)
          if (method !== 'signup' && isLikelyNewAuthUser(nextSession)) {
            captureClientEvent('signup', { method }, nextSession.user.id)
          }
          captureClientEvent('login', { method }, nextSession.user.id)
          pendingAuthMethodRef.current = null
        }
        loadAuthenticatedState(nextSession)
      } else if (event === 'SIGNED_OUT') {
        resetPersistedSession()
      }
      // Ignore a null INITIAL_SESSION; do not reset the board or it remounts empty.
    })

    void supabase.auth
      .getSession()
      .then(({ data: sessionData, error: sessionError }) => {
        if (sessionError) {
          void supabase.auth.signOut({ scope: 'local' }).catch(() => null)
          resetPersistedSession()
          return
        }

        sessionRef.current = sessionData.session
        setSession(sessionData.session)
        if (sessionData.session) loadAuthenticatedState(sessionData.session)
      })
      .catch(() => {
        void supabase.auth.signOut({ scope: 'local' }).catch(() => null)
        resetPersistedSession()
      })
      .finally(() => setAuthReady(true))

    return () => {
      data.subscription.unsubscribe()
    }
  }, [loadAuthenticatedState, resetPersistedSession, supabase])

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
            chat: chatMessagesRef.current,
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
    refreshCanvasStats()
    if (!sessionRef.current || !boardRef.current || suppressSaveRef.current) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      void saveBoard()
    }, 900)
  }, [refreshCanvasStats, saveBoard])

  const updateChatMessages = useCallback(
    (next: ChatMessage[] | ((current: ChatMessage[]) => ChatMessage[]), shouldSave = true) => {
      const nextMessages = typeof next === 'function' ? next(chatMessagesRef.current) : next
      chatMessagesRef.current = nextMessages
      setChatMessages(nextMessages)
      if (shouldSave) scheduleSave()
    },
    [scheduleSave]
  )

  const updateSourceName = useCallback(
    (sourceId: string, name: string) => {
      setSourceList(sourcesRef.current.map((source) => (source.id === sourceId ? { ...source, name } : source)))
      scheduleSave()
    },
    [scheduleSave]
  )

  const updateSourceRole = useCallback(
    (sourceId: string, role: SourceRole) => {
      setSourceList(
        sourcesRef.current.map((source) =>
          source.id === sourceId ? { ...source, role: source.role === role ? undefined : role } : source
        )
      )
      scheduleSave()
    },
    [scheduleSave]
  )

  const deleteSource = useCallback(
    (sourceId: string) => {
      const source = sourcesRef.current.find((item) => item.id === sourceId)
      const sourceName = cleanReferenceName(source?.name, 'this source')
      if (!window.confirm(`Delete ${sourceName} from sources?`)) return

      setSourceList(sourcesRef.current.filter((item) => item.id !== sourceId))
      setExtractPrompts((current) => {
        const next = { ...current }
        delete next[sourceId]
        return next
      })
      scheduleSave()
    },
    [scheduleSave]
  )

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

  const handlePasswordAuth = async () => {
    const trimmedEmail = authEmail.trim()
    const password = authPassword

    if (!trimmedEmail || !password) {
      setError('Enter your email and password.')
      return
    }

    if (authMode === 'signup' && password !== authConfirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setError(null)
    setAuthMessage(null)
    setAuthSubmitting(true)

    try {
      if (authMode === 'signup') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
          options: {
            emailRedirectTo: getBrowserAppUrl(),
          },
        })

        if (signUpError) throw signUpError

        captureClientEvent('signup', { method: 'password' }, data.user?.id)
        pendingAuthMethodRef.current = 'signup'

        if (data.session) {
          await loadQuota(data.session)
          setAuthMessage('Account created.')
        } else {
          setAuthMessage('Check your email to confirm your account, then log in.')
        }
        return
      }

      pendingAuthMethodRef.current = 'password'
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      })

      if (signInError) throw signInError
    } catch (caught) {
      pendingAuthMethodRef.current = null
      const message = caught instanceof Error ? caught.message : 'Authentication failed.'
      setError(message)
    } finally {
      setAuthSubmitting(false)
    }
  }

  const continueWithGoogle = async () => {
    setError(null)
    setAuthMessage(null)
    setAuthSubmitting(true)
    pendingAuthMethodRef.current = 'google'

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: getBrowserAppUrl(),
      },
    })

    if (oauthError) {
      pendingAuthMethodRef.current = null
      setError(oauthError.message)
      setAuthSubmitting(false)
    }
  }

  const sendMagicLink = async () => {
    const trimmed = authEmail.trim()
    if (!trimmed) {
      setError('Enter an email for the magic link.')
      return
    }

    setError(null)
    setAuthMessage(null)
    setAuthSubmitting(true)
    pendingAuthMethodRef.current = 'magic_link'
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {
        emailRedirectTo: getBrowserAppUrl(),
      },
    })

    if (signInError) {
      pendingAuthMethodRef.current = null
      setError(signInError.message)
      setAuthSubmitting(false)
      return
    }

    setAuthSubmitting(false)
    setAuthMessage('Magic link sent.')
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setShareMessage(null)
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('moodboard-guest-mode')
      window.location.href = '/login'
    }
  }

  const copyShareLink = async () => {
    if (!boardRecord) return
    const href = `${getBrowserAppUrl()}/b/${boardRecord.share_id}`
    await navigator.clipboard.writeText(href)
    setShareMessage('Share link copied.')
    captureClientEvent('share', { board_id: boardRecord.id }, sessionRef.current?.user.id)
  }

  const createAtViewportCenter = useCallback((shape: Parameters<Editor['createShape']>[0]) => {
    const editor = editorRef.current
    if (!editor) return

    const viewport = editor.getViewportPageBounds()
    const x = viewport.x + viewport.w / 2 - 140 + Math.random() * 36
    const y = viewport.y + viewport.h / 2 - 90 + Math.random() * 36
    editor.createShape({ ...shape, x, y } as Parameters<Editor['createShape']>[0])
  }, [])

  const dropCommentAtScreenPoint = useCallback(
    (point: { x: number; y: number }) => {
      const editor = editorRef.current
      if (!editor) return

      const pagePoint = editor.screenToPage(point)
      const author = sessionRef.current?.user.email ?? 'Anonymous'
      editor.createShape({
        type: 'comment-pin',
        x: pagePoint.x - 14,
        y: pagePoint.y - 14,
        props: {
          author,
          text: '',
          replies: [],
          resolved: false,
          createdAt: new Date().toISOString(),
        },
      } as Parameters<Editor['createShape']>[0])
      scheduleSave()
      setCommentMode(false)
    },
    [scheduleSave]
  )

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
      const shapeId = createShapeId()
      editor.createShape({
        id: shapeId,
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
      editor.setSelectedShapes([shapeId])
      editor.zoomToSelection({ animation: { duration: 200 } })
      scheduleSave()
      captureClientEvent(
        'add_to_board',
        {
          source: input.sourceId,
          label: input.label || 'element',
        },
        sessionRef.current?.user.id
      )
    },
    [scheduleSave]
  )

  const createImageReferenceAtPoint = useCallback(
    (
      input: { imageUrl: string; label: string; source: string; width?: number; height?: number },
      point?: { x: number; y: number }
    ) => {
      const editor = editorRef.current
      if (!editor) return

      const intrinsicW = Math.max(1, input.width ?? 512)
      const intrinsicH = Math.max(1, input.height ?? 512)
      const scale = Math.min(1, 340 / intrinsicW, 260 / intrinsicH)
      const w = Math.round(intrinsicW * scale)
      const h = Math.round(intrinsicH * scale)
      const label = cleanReferenceName(input.label, 'reference')
      const fallback = editor.getViewportPageBounds().center
      const x = (point?.x ?? fallback.x) - w / 2
      const y = (point?.y ?? fallback.y) - h / 2
      const asset = AssetRecordType.create({
        id: AssetRecordType.createId(),
        type: 'image',
        props: {
          src: input.imageUrl,
          w: intrinsicW,
          h: intrinsicH,
          mimeType: 'image/png',
          name: `${label}.png`,
          isAnimated: false,
        },
      })

      editor.createAssets([asset])
      const shapeId = createShapeId()
      editor.createShape({
        id: shapeId,
        type: 'image-ref',
        x,
        y,
        props: {
          url: input.imageUrl,
          assetId: asset.id,
          label,
          tags: [],
          w,
          h,
        },
      })
      editor.setSelectedShapes([shapeId])
      editor.zoomToSelection({ animation: { duration: 200 } })
      scheduleSave()
      captureClientEvent(
        'add_reference',
        {
          source: input.source,
          label,
        },
        sessionRef.current?.user.id
      )
    },
    [scheduleSave]
  )

  const updateOutputName = useCallback((slot: number, name: string) => {
    setOutputs((current) => current.map((output) => (output.slot === slot ? { ...output, name } : output)))
  }, [])

  const updateChatImageName = useCallback(
    (messageId: string, url: string, name: string) => {
      updateChatMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                images: (message.images ?? []).map((image) => (image.url === url ? { ...image, name } : image)),
              }
            : message
        )
      )
    },
    [updateChatMessages]
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
      link.download = `${downloadName(output.name, generatedImageName(output.slot))}.png`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(objectUrl)
    } catch {
      window.open(output.url, '_blank', 'noopener,noreferrer')
    }
  }, [])

  const buildOrbitScene = useCallback(async (source: OrbitSource) => {
    const currentSession = sessionRef.current
    if (!currentSession) {
      setError('Sign in to explore generated scenes in 3D.')
      return
    }

    setOrbitSource(source)
    setOrbitStatus('building')
    setOrbitModelUrl(null)
    setOrbitError(null)

    try {
      const response = await fetch('/api/orbit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${currentSession.access_token}`,
        },
        body: JSON.stringify({
          boardId: getBoardId(),
          sourceUrl: source.url,
          sourceLabel: source.label,
        }),
      })
      const result = (await response.json().catch(() => null)) as {
        modelUrl?: string; error?: string; code?: string; creditsBalance?: number
      } | null
      if (result?.code === 'insufficient_credits') setCreditModalOpen(true)
      if (!response.ok || !result?.modelUrl) throw new Error(result?.error ?? 'Could not build the 3D scene.')

      updateQuotaFromPayload(result)
      setOrbitModelUrl(result.modelUrl)
      setOrbitStatus('ready')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not build the 3D scene.'
      setOrbitError(message)
      setOrbitStatus('error')
    }
  }, [])

  const captureOrbitAngle = useCallback(async (blob: Blob) => {
    if (!orbitSource) return

    const formData = new FormData()
    formData.append('file', new File([blob], 'scene-angle.png', { type: 'image/png' }))
    const response = await fetch('/api/import-image', { method: 'POST', body: formData })
    const result = (await response.json().catch(() => null)) as { url?: string; error?: string } | null
    if (!response.ok || !result?.url) throw new Error(result?.error ?? 'Could not save the captured angle.')

    const dimensions = await loadImageDimensions(result.url).catch(() => ({ width: 1024, height: 768 }))
    createImageReferenceAtPoint({
      imageUrl: result.url,
      label: `${orbitSource.label} — 3D angle`,
      source: 'scene-orbit',
      ...dimensions,
    })
    captureClientEvent('capture_scene_angle', { source: orbitSource.url }, sessionRef.current?.user.id)
    setOrbitSource(null)
    setOrbitStatus('idle')
    setOrbitModelUrl(null)
  }, [createImageReferenceAtPoint, orbitSource])

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
          const props = shape.props as { url?: string; label?: string; tags?: string[] }
          return { url: props.url ?? '', label: props.label?.trim(), tags: cleanTags(props.tags ?? []) }
        })
        .filter((ref) => ref.url),
      sources: sourcesRef.current
        .map((source, index) => ({
          url: source.url,
          label: sourceReferenceLabel(source, index),
          role: source.role,
        }))
        .filter((source) => source.url),
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
        .filter((shape) => shape.type === 'moodboard-note')
        .map((shape) => {
          const props = shape.props as { text?: string }
          return { text: props.text?.trim() ?? '' }
        })
        .filter((note) => note.text),
    }
  }, [brief])

  function updateQuotaFromPayload(payload: Partial<UsageQuota>) {
    if (typeof payload.creditsBalance !== 'number') return
    setQuota({ creditsBalance: payload.creditsBalance })
  }

  const startCheckout = useCallback(async (packId: 'starter' | 'creator' | 'studio') => {
    const currentSession = sessionRef.current
    if (!currentSession) return
    setCheckoutLoading(packId)
    setError(null)
    try {
      const response = await fetch('/api/credits/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authorization: `Bearer ${currentSession.access_token}` },
        body: JSON.stringify({ packId }),
      })
      const result = (await response.json().catch(() => null)) as { url?: string; error?: string } | null
      if (!response.ok || !result?.url) throw new Error(result?.error ?? 'Could not start checkout.')
      window.location.assign(result.url)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start checkout.')
      setCheckoutLoading(null)
    }
  }, [])

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

        const nextSources = [
          ...sourcesRef.current,
          {
            id: crypto.randomUUID(),
            url: result.url,
            name: defaultSourceName(payload, sourcesRef.current.length),
          },
        ]
        setSourceList(nextSources)
        setSidebarTab('sources')
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

  const addUrlImage = () => {
    const trimmed = url.trim()
    if (trimmed) void importImage({ url: trimmed })
  }

  const addSourceToBoard = useCallback(
    async (source: SourceImage, index: number) => {
      setError(null)
      setExtractionState({ sourceId: source.id, action: 'full' })

      let dimensions: { width?: number; height?: number } = {}
      try {
        dimensions = await loadImageDimensions(source.url)
      } catch {
        dimensions = {}
      }

      try {
        createImageReferenceAtPoint({
          imageUrl: source.url,
          label: sourceReferenceLabel(source, index),
          source: 'source',
          width: dimensions.width,
          height: dimensions.height,
        })
      } finally {
        setExtractionState(null)
      }
    },
    [createImageReferenceAtPoint]
  )

  const extractSource = async (source: SourceImage, action: 'subject' | 'describe') => {
    const prompt = extractPrompts[source.id]?.trim()
    if (action === 'describe' && !prompt) {
      setError('Describe what to extract from the source.')
      return
    }

    setError(null)
    setExtractionState({ sourceId: source.id, action })

    try {
      if (action === 'subject') {
        const cutout = await extractForegroundWithGrabCut(source.url)
        const formData = new FormData()
        formData.append('file', new File([cutout.blob], 'grabcut-subject.png', { type: 'image/png' }))
        const upload = await fetch('/api/import-image', { method: 'POST', body: formData })
        const uploaded = (await upload.json().catch(() => null)) as { url?: string; error?: string } | null
        if (!upload.ok || !uploaded?.url) throw new Error(uploaded?.error ?? 'Could not save the GrabCut result.')

        createElementAtPoint({
          imageUrl: uploaded.url,
          label: cleanReferenceName(source.name, 'subject'),
          sourceId: source.id,
          width: cutout.width,
          height: cutout.height,
        })
        captureClientEvent('extract', { mode: 'subject', provider: 'browser-grabcut' }, sessionRef.current?.user.id)
        return
      }

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
      const result = (await response.json()) as {
        url?: string; width?: number; height?: number; error?: string; code?: string; creditsBalance?: number
      }

      if (!response.ok || !result.url) {
        if (result.code === 'insufficient_credits') setCreditModalOpen(true)
        throw new Error(result.error ?? 'Extraction failed.')
      }

      updateQuotaFromPayload(result)

      createElementAtPoint({
        imageUrl: result.url,
        label: action === 'describe' ? prompt ?? 'element' : cleanReferenceName(source.name, 'subject'),
        sourceId: source.id,
        width: result.width,
        height: result.height,
      })
      captureClientEvent('extract', { mode: action }, sessionRef.current?.user.id)
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
      captureClientEvent('extract', { mode: 'palette', color_count: result.colors.length }, sessionRef.current?.user.id)
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
    const currentSession = sessionRef.current
    if (!currentSession) {
      setError('Please sign in or create an account to generate images.')
      setIsGuest(false)
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem('moodboard-guest-mode')
      }
      return
    }

    if (!canGenerate) {
      setError('Buy credits to generate images.')
      setCreditModalOpen(true)
      setOutputs([])
      return
    }

    setError(null)
    setSelectedOutputSlot(null)
    setGenerationState('generating')
    setOutputs(
      Array.from({ length: IMAGES_PER_GENERATION }, (_, slot) => ({
        slot,
        status: 'pending',
        name: generatedImageName(slot),
      }))
    )
    let blockedByLimit = false

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${currentSession.access_token}`,
        },
        body: JSON.stringify({
          boardId: getBoardId(),
          count: IMAGES_PER_GENERATION,
          board: getBoardDoc(),
          model: generationModelRef.current,
        }),
      })

      if (!response.ok || !response.body) {
        const result = (await response.json().catch(() => null)) as
          | (Partial<UsageQuota> & { error?: string; code?: string; requiredCredits?: number })
          | null
        if (result?.code === 'insufficient_credits') {
          blockedByLimit = true
          updateQuotaFromPayload(result)
          setCreditModalOpen(true)
        }
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
                creditsBalance?: number
              }
            | { type: 'output'; slot: number; url: string; width?: number; height?: number; seed: number }
            | { type: 'error'; slot: number; error: string }
            | { type: 'done'; outputCount?: number; creditsBalance?: number }

          if (event.type === 'start' || event.type === 'done') {
            updateQuotaFromPayload(event)
          }

          if (event.type === 'output') {
            setOutputs((current) =>
              current.map((item) =>
                item.slot === event.slot
                  ? {
                      slot: event.slot,
                      status: 'done',
                      name: item.name ?? generatedImageName(event.slot),
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
                  ? { slot: event.slot, status: 'error', name: item.name, error: event.error }
                  : item
              )
            )
          }
        }
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Generation failed.'
      setError(message)
      if (blockedByLimit) {
        setOutputs([])
      } else {
        setOutputs((current) =>
          current.map((item) => (item.status === 'pending' ? { ...item, status: 'error', error: message } : item))
        )
      }
    } finally {
      setGenerationState('idle')
    }
  }

  const sendChatMessage = async () => {
    const content = chatInput.trim()
    if (!content || chatState !== 'idle') return

    const currentSession = sessionRef.current
    if (!currentSession) {
      setError('Please sign in or create an account to generate images.')
      setIsGuest(false)
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem('moodboard-guest-mode')
      }
      return
    }

    if (!canGenerate) {
      setError('Buy credits to generate images.')
      setCreditModalOpen(true)
      setOutputs([])
      return
    }

    const createdAt = new Date().toISOString()
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      createdAt,
    }
    const assistantId = crypto.randomUUID()
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: 'Thinking...',
      createdAt,
      status: 'thinking',
      images: [],
    }
    const nextMessages = [...chatMessagesRef.current, userMessage, assistantMessage]

    setChatInput('')
    setError(null)
    setChatPanelOpen(true)
    setChatState('thinking')
    updateChatMessages(nextMessages)
    let blockedByLimit = false

    try {
      const board = getBoardDoc()
      const chatResponse = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          history: nextMessages
            .filter((message) => message.status !== 'thinking')
            .map((message) => ({ role: message.role, content: message.content })),
          board,
        }),
      })
      const chatResult = (await chatResponse.json()) as {
        assistantText?: string
        generationPrompt?: string
        error?: string
      }

      if (!chatResponse.ok || !chatResult.generationPrompt) {
        throw new Error(chatResult.error ?? 'Chat failed.')
      }

      updateChatMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                content: chatResult.assistantText ?? "I'll generate that direction.",
                generationPrompt: chatResult.generationPrompt,
                status: 'generating',
              }
            : message
        )
      )
      setChatState('generating')
      setSelectedOutputSlot(null)
      setGenerationState('generating')
      setOutputs(
        Array.from({ length: IMAGES_PER_GENERATION }, (_, slot) => ({
          slot,
          status: 'pending',
          name: generatedImageName(slot),
        }))
      )

      const generationResponse = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${currentSession.access_token}`,
        },
        body: JSON.stringify({
          boardId: getBoardId(),
          count: IMAGES_PER_GENERATION,
          board: { ...board, brief: chatResult.generationPrompt },
          model: generationModelRef.current,
        }),
      })

      if (!generationResponse.ok || !generationResponse.body) {
        const result = (await generationResponse.json().catch(() => null)) as
          | (Partial<UsageQuota> & { error?: string; code?: string; requiredCredits?: number })
          | null
        if (result?.code === 'insufficient_credits') {
          blockedByLimit = true
          updateQuotaFromPayload(result)
          setCreditModalOpen(true)
        }
        throw new Error(result?.error ?? 'Generation failed.')
      }

      const reader = generationResponse.body.getReader()
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
                creditsBalance?: number
              }
            | { type: 'output'; slot: number; url: string; width?: number; height?: number; seed: number }
            | { type: 'error'; slot: number; error: string }
            | { type: 'done'; outputCount?: number; creditsBalance?: number }

          if (event.type === 'start' || event.type === 'done') {
            updateQuotaFromPayload(event)
          }

          if (event.type === 'output') {
            setOutputs((current) =>
              current.map((item) =>
                item.slot === event.slot
                  ? {
                      slot: event.slot,
                      status: 'done',
                      name: item.name ?? generatedImageName(event.slot),
                      url: event.url,
                      width: event.width,
                      height: event.height,
                      seed: event.seed,
                    }
                  : item
              )
            )
            updateChatMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? {
                      ...message,
                      images: [
                        ...(message.images ?? []),
                        {
                          url: event.url,
                          name: generatedImageName(event.slot),
                          width: event.width,
                          height: event.height,
                          seed: event.seed,
                        },
                      ],
                    }
                  : message
              )
            )
          }

          if (event.type === 'error') {
            setOutputs((current) =>
              current.map((item) =>
                item.slot === event.slot
                  ? { slot: event.slot, status: 'error', name: item.name, error: event.error }
                  : item
              )
            )
            updateChatMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? { ...message, content: `${message.content}\n${event.error}`.trim(), status: 'error' }
                  : message
              )
            )
          }
        }
      }

      updateChatMessages((current) =>
        current.map((message) => (message.id === assistantId ? { ...message, status: 'done' } : message))
      )
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Chat generation failed.'
      setError(message)
      if (blockedByLimit) {
        setOutputs([])
      } else {
        setOutputs((current) =>
          current.map((item) => (item.status === 'pending' ? { ...item, status: 'error', error: message } : item))
        )
      }
      updateChatMessages((current) =>
        current.map((item) =>
          item.id === assistantId ? { ...item, content: message, status: 'error', images: item.images ?? [] } : item
        )
      )
    } finally {
      setChatState('idle')
      setGenerationState('idle')
    }
  }

  const composeTextOnOutput = async () => {
    if (!selectedOutput?.url) {
      setError('Select a finished output first.')
      return
    }

    const text = composeHeadline.trim()
    const fontName = composeFontName.trim()
    const fontUrl = composeFontUrl.trim()

    if (!text) {
      setError('Enter headline text to compose.')
      return
    }

    if (Boolean(fontName) === Boolean(fontUrl)) {
      setError('Enter either a Google Fonts name or a direct font-file URL.')
      return
    }

    const position = COMPOSE_POSITIONS.find((item) => item.id === composePosition) ?? COMPOSE_POSITIONS[4]
    setError(null)
    setComposingState('composing')

    try {
      const response = await fetch('/api/compose-text', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionRef.current ? { authorization: `Bearer ${sessionRef.current.access_token}` } : {}),
        },
        body: JSON.stringify({
          imageUrl: selectedOutput.url,
          text,
          fontName: fontName || undefined,
          fontUrl: fontUrl || undefined,
          fontWeight: composeFontWeight,
          fontSizeRatio: composeFontSizeRatio,
          color: composeColor,
          x: position.x,
          y: position.y,
          outlineColor: composeOutline ? composeOutlineColor : undefined,
          outlineWidthRatio: composeOutline ? 0.04 : undefined,
        }),
      })
      const result = (await response.json()) as { url?: string; width?: number; height?: number; error?: string }

      if (!response.ok || !result.url) {
        throw new Error(result.error ?? 'Text composition failed.')
      }

      const slot = outputs.length
      setOutputs((current) => [
        ...current,
        { slot, status: 'done', name: composedImageName(slot), url: result.url, width: result.width, height: result.height },
      ])
      setSelectedOutputSlot(slot)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Text composition failed.'
      setError(message)
    } finally {
      setComposingState('idle')
    }
  }

  if (!authReady || (session && !boardRecord && saveState === 'loading')) {
    return (
      <main className="flex h-screen w-screen items-center justify-center bg-[#0B0838] text-[#FCECD5]">
        <div className="flex items-center gap-3 rounded-full border border-white/10 bg-[#120E6A]/60 px-5 py-2.5 backdrop-blur-xl shadow-2xl">
          <span className="h-2 w-2 rounded-full bg-[#D95D24] animate-ping" />
          <span className="font-mono text-xs uppercase tracking-widest text-[#FCECD5]/90">
            Establishing Telemetry Link…
          </span>
        </div>
      </main>
    )
  }

  if (!session && !isGuest) {
    return <AuthCard initialMode="login" />
  }

  return (
    <main className="relative flex h-screen w-screen overflow-hidden p-3 gap-3 flex-col bg-[#EAECEF] text-slate-900 select-none bg-telemetry-grid">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Global Floating Error / Notice Toast */}
      {error && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 rounded-xl border border-red-200 bg-white/95 px-4 py-2.5 text-xs font-semibold text-red-700 shadow-xl backdrop-blur-md animate-in fade-in duration-200">
          <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse shrink-0" />
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-2 rounded-md p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── ZONE A: TOP NAVIGATION BAR (h-14) — Circular Icon Dock Pattern (Swiss Cockpit) ── */}
      <header className="relative z-50 h-14 shrink-0 rounded-2xl border border-[#E2E5EA] bg-white/95 px-4 flex items-center justify-between shadow-[0_2px_8px_rgba(0,0,0,0.04)] backdrop-blur-md">
        {/* Left: Brand & Board Status */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0F0C59] shadow-sm">
              <span className="font-mono text-xs font-black text-white">MB</span>
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-mono text-[9px] font-bold tracking-widest text-slate-500 uppercase">MOODBLENDY</span>
              <input
                value={brief}
                onChange={(event) => {
                  setBrief(event.target.value)
                  briefRef.current = event.target.value
                  scheduleSave()
                }}
                placeholder="Untitled Moodboard"
                className="h-5 w-32 sm:w-48 bg-transparent font-sans text-xs font-bold text-slate-900 placeholder-slate-400 outline-none truncate border-b border-transparent focus:border-blue-600"
                title="Click to edit board title / brief"
              />
            </div>
          </div>

          <div className="hidden md:flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[11px] font-mono font-semibold text-slate-700">
            <span>Page 1</span>
            <span className="text-[9px] text-slate-400">▾</span>
          </div>

          {/* Live Status Pill */}
          <div className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[10px] font-mono font-bold tracking-wider uppercase text-slate-700">
            <span className={`h-2 w-2 rounded-full ${
              generationState === 'generating' || composingState === 'composing'
                ? 'bg-[#D95D24] animate-ping'
                : importState === 'importing' || saveState === 'saving'
                ? 'bg-amber-500 animate-pulse'
                : 'bg-emerald-500'
            }`} />
            <span>
              {generationState === 'generating'
                ? 'GENERATING'
                : composingState === 'composing'
                ? 'COMPOSING'
                : importState === 'importing'
                ? 'IMPORTING'
                : saveState === 'saving'
                ? 'SAVING'
                : 'IDLE'}
            </span>
          </div>
        </div>

        {/* Center: The Circular Tool Dock (7 circular 40px buttons) */}
        <div className="flex items-center gap-1.5 sm:gap-2 rounded-full border border-[#E5E7EB] bg-[#F1F3F5] p-1 shadow-inner">
          {/* 1. Upload Image */}
          <button
            type="button"
            className="group relative flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full border border-transparent text-slate-600 transition-all hover:scale-105 hover:bg-white hover:text-slate-900 hover:shadow-sm active:scale-95 disabled:opacity-40"
            onClick={() => fileInputRef.current?.click()}
            disabled={importState === 'importing'}
            aria-label="Upload Image"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <span className="pointer-events-none absolute -bottom-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1 text-[10px] font-mono font-semibold text-white opacity-0 shadow-xl transition-opacity group-hover:opacity-100 border border-slate-700 z-50">
              Upload Image
            </span>
          </button>

          {/* 2. Paste Clipboard */}
          <button
            type="button"
            className="group relative flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full border border-transparent text-slate-600 transition-all hover:scale-105 hover:bg-white hover:text-slate-900 hover:shadow-sm active:scale-95 disabled:opacity-40"
            onClick={pasteClipboardImage}
            disabled={importState === 'importing'}
            aria-label="Paste from Clipboard"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <span className="pointer-events-none absolute -bottom-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1 text-[10px] font-mono font-semibold text-white opacity-0 shadow-xl transition-opacity group-hover:opacity-100 border border-slate-700 z-50">
              Paste Clipboard
            </span>
          </button>

          {/* 3. Add Swatch */}
          <button
            type="button"
            className="group relative flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full border border-transparent text-slate-600 transition-all hover:scale-105 hover:bg-white hover:text-slate-900 hover:shadow-sm active:scale-95"
            onClick={() =>
              createAtViewportCenter({
                type: 'swatch',
                props: { colors: randomFrom(DEFAULT_SWATCHES), w: 240, h: 92 },
              })
            }
            aria-label="Add Color Swatch"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 21a4 4 0 01-4-4 5 5 0 013-4.5V6a3 3 0 013-3h6a3 3 0 013 3v6.5A5 5 0 0121 17a4 4 0 01-4 4H7z" />
            </svg>
            <span className="pointer-events-none absolute -bottom-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1 text-[10px] font-mono font-semibold text-white opacity-0 shadow-xl transition-opacity group-hover:opacity-100 border border-slate-700 z-50">
              Add Swatch
            </span>
          </button>

          {/* 4. Add Type */}
          <button
            type="button"
            className="group relative flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full border border-transparent text-slate-600 transition-all hover:scale-105 hover:bg-white hover:text-slate-900 hover:shadow-sm active:scale-95"
            onClick={() => {
              const label = window.prompt('Type sample label', 'Condensed grotesk / wide tracking')
              if (label) {
                createAtViewportCenter({
                  type: 'type-sample',
                  props: { label, w: 340, h: 96 },
                })
              }
            }}
            aria-label="Add Typography Sample"
          >
            <span className="font-serif text-base font-bold">T</span>
            <span className="pointer-events-none absolute -bottom-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1 text-[10px] font-mono font-semibold text-white opacity-0 shadow-xl transition-opacity group-hover:opacity-100 border border-slate-700 z-50">
              Add Type
            </span>
          </button>

          {/* 5. Add Note / Comment */}
          <button
            type="button"
            className={`group relative flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full transition-all hover:scale-105 active:scale-95 ${
              commentMode
                ? 'bg-[#0F0C59] text-white shadow-md scale-105 border border-[#0F0C59]'
                : 'border border-transparent text-slate-600 hover:bg-white hover:text-slate-900 hover:shadow-sm'
            }`}
            onClick={() => setCommentMode((current) => !current)}
            aria-label="Toggle Comment Pin Mode"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
            <span className="pointer-events-none absolute -bottom-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1 text-[10px] font-mono font-semibold text-white opacity-0 shadow-xl transition-opacity group-hover:opacity-100 border border-slate-700 z-50">
              {commentMode ? 'Drop Pin Active' : 'Comment Pin'}
            </span>
          </button>

          {/* 6. AI Assistant Chat */}
          <button
            type="button"
            className={`group relative flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full transition-all hover:scale-105 active:scale-95 ${
              chatPanelOpen
                ? 'bg-[#0F0C59] text-white shadow-md scale-105 border border-[#0F0C59]'
                : 'border border-transparent text-slate-600 hover:bg-white hover:text-slate-900 hover:shadow-sm'
            }`}
            onClick={() => setChatPanelOpen((prev) => !prev)}
            aria-label="AI Assistant Chat"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="pointer-events-none absolute -bottom-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1 text-[10px] font-mono font-semibold text-white opacity-0 shadow-xl transition-opacity group-hover:opacity-100 border border-slate-700 z-50">
              {chatPanelOpen ? 'Close Chat' : 'Generate Chat'}
            </span>
          </button>

          {/* 7. Explore Directory */}
          <button
            type="button"
            className={`group relative flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full transition-all hover:scale-105 active:scale-95 ${
              explorePanelOpen
                ? 'bg-[#0F0C59] text-white shadow-md scale-105 border border-[#0F0C59]'
                : 'border border-transparent text-slate-600 hover:bg-white hover:text-slate-900 hover:shadow-sm'
            }`}
            onClick={() => setExplorePanelOpen((prev) => !prev)}
            aria-label="Explore Directory"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
            </svg>
            <span className="pointer-events-none absolute -bottom-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1 text-[10px] font-mono font-semibold text-white opacity-0 shadow-xl transition-opacity group-hover:opacity-100 border border-slate-700 z-50">
              {explorePanelOpen ? 'Close Directory' : 'Explore Directory'}
            </span>
          </button>
        </div>

        {/* Right: Utility & Account Capsule */}
        <div className="flex items-center gap-2">
          {/* Drawing Tools Toggle */}
          <button
            type="button"
            onClick={() => setIsToolbarCollapsed((prev) => !prev)}
            className="group relative flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-xs text-slate-700 transition hover:bg-slate-50 hover:text-slate-900 shadow-sm"
            title={isToolbarCollapsed ? 'Expand drawing toolbox' : 'Collapse drawing toolbox'}
          >
            <span>{isToolbarCollapsed ? '✏️' : '✕'}</span>
          </button>

          {/* Hide / Show Resolved comments */}
          <button
            type="button"
            onClick={() => setShowResolvedComments((current) => !current)}
            className={`group relative flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 transition shadow-sm ${
              showResolvedComments ? 'bg-white text-slate-700 hover:bg-slate-50' : 'bg-[#D95D24]/10 text-[#D95D24] border-[#D95D24]/40'
            }`}
            title={showResolvedComments ? 'Hide resolved comments' : 'Show resolved comments'}
          >
            <span>👁️</span>
          </button>

          {/* Share Button */}
          <button
            type="button"
            onClick={copyShareLink}
            disabled={!boardRecord}
            className="group relative flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-xs text-slate-700 transition hover:bg-slate-50 hover:text-slate-900 shadow-sm disabled:opacity-30"
            title={shareMessage || 'Copy share link'}
          >
            <span>↗</span>
          </button>

          {/* User / Session Capsule */}
          {isGuest ? (
            <div className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100/80 pl-3 pr-1 py-1">
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-600">GUEST</span>
              <button
                type="button"
                onClick={() => setCreditModalOpen(true)}
                className="rounded-full bg-blue-50 border border-blue-200 hover:bg-blue-100 px-2.5 py-1 text-[10px] font-mono font-bold text-blue-700 transition"
              >
                Buy credits
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsGuest(false)
                  if (typeof window !== 'undefined') {
                    window.localStorage.removeItem('moodboard-guest-mode')
                    window.location.href = '/login'
                  }
                }}
                className="rounded-full bg-[#0F0C59] hover:bg-blue-900 px-3 py-1 text-[11px] font-bold text-white transition shadow-sm"
              >
                Sign in
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-100/80 pl-3 pr-1 py-1">
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#D95D24]" />
                <span className="font-mono text-[11px] font-bold text-slate-800">
                  {quota ? `${quota.creditsBalance.toLocaleString()} CR` : '0 CR'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setCreditModalOpen(true)}
                className="rounded-full bg-blue-50 border border-blue-200 hover:bg-blue-100 px-2 py-0.5 text-[9px] font-mono font-bold text-blue-700 transition"
              >
                + Add
              </button>
              <button
                type="button"
                onClick={signOut}
                className="rounded-full bg-transparent hover:bg-slate-200 px-2.5 py-1 text-[10px] font-mono font-semibold text-slate-600 hover:text-slate-900 transition"
                title={session?.user.email ?? 'Sign out'}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ── ZONE B: MAIN 3-COLUMN BENTO WORKSPACE (flex-1 grid grid-cols-12 gap-3 min-h-0) ── */}
      <section className="flex-1 grid grid-cols-12 gap-3 min-h-0 overflow-hidden">
        {/* ── LEFT BENTO COLUMN: Source Telemetry & Vibe DNA (Swiss Cockpit) ── */}
        <aside className="col-span-12 lg:col-span-3 flex flex-col gap-3 min-h-0 overflow-hidden">
          {/* Card 1: SOURCE TELEMETRY & INGEST */}
          <div className="rounded-2xl border border-[#E2E5EA] bg-white p-3 shadow-[0_2px_8px_rgba(0,0,0,0.04)] flex flex-col gap-2 shrink-0">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-slate-500">
                SOURCE TELEMETRY
              </span>
              <span className="rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-bold text-[#0F0C59]">
                {boardRecord?.id ? 'MB-' + boardRecord.id.slice(0, 6).toUpperCase() : 'MB-7492'}
              </span>
            </div>

            {/* Integrated Quick URL Ingest */}
            <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-1">
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addUrlImage()
                }}
                placeholder="Paste source or reference URL…"
                className="h-7 min-w-0 flex-1 bg-transparent px-2 text-xs text-slate-800 placeholder-slate-400 outline-none"
              />
              <button
                type="button"
                disabled={importState === 'importing' || !url.trim()}
                onClick={addUrlImage}
                className="flex h-7 items-center rounded-lg bg-[#0F0C59] px-2.5 text-xs font-bold text-white transition hover:bg-blue-900 disabled:opacity-40"
              >
                {importState === 'importing' ? '…' : '+ Add'}
              </button>
            </div>
          </div>

          {/* Card 2: KEY-VALUE SPECS GRID */}
          <div className="rounded-2xl border border-[#E2E5EA] bg-white p-3 shadow-[0_2px_8px_rgba(0,0,0,0.04)] flex flex-col gap-2 shrink-0">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-slate-500">
                SYSTEM SPECS
              </span>
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#D95D24]" />
                <span className="font-mono text-[9px] font-bold text-slate-700">
                  {quotaBlocked ? 'NEEDS CREDITS' : 'READY TO BLEND'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                <span className="block font-mono text-[8px] uppercase tracking-wider text-slate-500">ACTIVE MODEL</span>
                <select
                  value={generationModel}
                  onChange={(event) => {
                    generationModelRef.current = event.target.value
                    setGenerationModel(event.target.value)
                    setOutputs([])
                    setSelectedOutputSlot(null)
                    setError(null)
                  }}
                  className="mt-1 w-full bg-transparent font-sans text-xs font-bold text-slate-800 outline-none cursor-pointer"
                  aria-label="Generation model"
                >
                  <option value="hf-spaces/black-forest-labs/FLUX.2-dev">Flux (HF Spaces)</option>
                  <option value="pollinations/flux">Flux (Pollinations)</option>
                  <option value="pollinations/krea">Krea (Pollinations)</option>
                  <option value="fal-ai/nano-banana-pro/edit">Fal.ai (legacy)</option>
                </select>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                <span className="block font-mono text-[8px] uppercase tracking-wider text-slate-500">CANVAS NODES</span>
                <div className="mt-1 flex items-baseline gap-2 font-mono text-xs font-bold text-slate-800">
                  <span>IMG: {canvasStats.imageCount}</span>
                  <span className="text-slate-300">/</span>
                  <span>SW: {canvasStats.swatchCount}</span>
                </div>
              </div>
            </div>

            {/* Extracted Palette Mini Bar */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-2 flex items-center justify-between">
              <span className="font-mono text-[8px] uppercase tracking-wider text-slate-500">PALETTE</span>
              <div className="flex items-center gap-1">
                {canvasStats.palette.length > 0 ? (
                  canvasStats.palette.map((hex, idx) => (
                    <span
                      key={idx}
                      className="h-3.5 w-3.5 rounded-full border border-black/10 transition hover:scale-125 cursor-pointer shadow-xs"
                      style={{ backgroundColor: hex }}
                      title={`Color ${hex} (click to copy)`}
                      onClick={() => void navigator.clipboard.writeText(hex)}
                    />
                  ))
                ) : (
                  <span className="font-mono text-[9px] text-slate-400">No swatches on canvas</span>
                )}
              </div>
            </div>
          </div>

          {/* Card 3: REFERENCES & VARIATIONS FILMSTRIP (Swiss Cockpit) — Extends down the page */}
          <div className="flex-1 min-h-0 rounded-2xl border border-[#E2E5EA] bg-white p-3 shadow-[0_2px_8px_rgba(0,0,0,0.04)] flex flex-col gap-2 overflow-hidden">
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin pr-1 space-y-4">
              {/* ── Section A: Staged References (Above) ── */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between pb-1.5 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-slate-500">
                      STAGED REFERENCES
                    </span>
                    <span className="rounded bg-slate-100 border border-slate-200 px-1.5 py-0.2 font-mono text-[9px] font-bold text-slate-700">
                      {sources.length} ASSETS
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 font-mono text-[9px] font-bold text-slate-700 hover:bg-slate-200 transition shadow-2xs"
                  >
                    + Upload
                  </button>
                </div>

                {sources.length ? (
                  <div className="space-y-2">
                    {sources.map((source, index) => {
                      const busy = extractionState?.sourceId === source.id
                      return (
                        <div key={source.id} className="rounded-xl border border-slate-200 bg-slate-50/80 p-2 text-xs flex flex-col gap-2">
                          <div className="flex gap-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={source.url} alt={source.name ?? ''} className="h-14 w-20 shrink-0 rounded-lg object-cover border border-slate-200" />
                            <div className="flex flex-1 flex-col justify-between min-w-0">
                              <div className="flex items-center gap-1">
                                <input
                                  value={source.name ?? ''}
                                  onChange={(event) => updateSourceName(source.id, event.target.value)}
                                  placeholder="Source name"
                                  className="h-6 flex-1 rounded bg-white px-1.5 font-sans text-xs font-semibold text-slate-800 border border-slate-200 outline-none focus:border-blue-500 truncate"
                                />
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => deleteSource(source.id)}
                                  className="h-6 w-6 rounded bg-red-100 text-red-600 hover:bg-red-200 text-[10px] flex items-center justify-center font-bold"
                                  title="Delete source"
                                >
                                  ✕
                                </button>
                              </div>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {SOURCE_ROLES.map((role) => {
                                  const active = source.role === role
                                  return (
                                    <button
                                      key={role}
                                      type="button"
                                      className={`rounded px-1.5 py-0.2 font-mono text-[9px] font-bold uppercase transition ${
                                        active
                                          ? 'bg-[#D95D24] text-white'
                                          : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                                      }`}
                                      onClick={() => updateSourceRole(source.id, role)}
                                    >
                                      {role.slice(0, 4)}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-1.5">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void addSourceToBoard(source, index)}
                              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-40 shadow-xs"
                            >
                              {busy && extractionState?.action === 'full' ? 'Adding…' : '+ Full Image'}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void extractSource(source, 'subject')}
                              className="rounded-lg bg-[#0F0C59] px-2 py-1 text-[10px] font-bold text-white hover:bg-blue-900 disabled:opacity-40 shadow-xs"
                            >
                              {busy && extractionState?.action === 'subject' ? 'Extracting…' : 'Extract Subject'}
                            </button>
                          </div>

                          <div className="flex gap-1.5">
                            <input
                              value={extractPrompts[source.id] ?? ''}
                              onChange={(event) =>
                                setExtractPrompts((current) => ({ ...current, [source.id]: event.target.value }))
                              }
                              placeholder="e.g. the chair"
                              className="h-6 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-[11px] text-slate-800 placeholder-slate-400 outline-none focus:border-blue-500"
                            />
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void extractSource(source, 'describe')}
                              className="rounded-lg border border-slate-200 bg-white px-2 text-[10px] font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                            >
                              Extract
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void extractPalette(source)}
                              className="rounded-lg border border-slate-200 bg-white px-2 text-[10px] font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                              title="Extract palette from source"
                            >
                              Palette
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="flex h-20 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 p-2 text-center">
                    <p className="font-mono text-xs font-semibold text-slate-600">No reference assets staged</p>
                    <p className="mt-0.5 text-[10px] text-slate-400">Upload or drop image URLs above to extract cutouts.</p>
                  </div>
                )}
              </div>

              {/* ── Section B: Variations Filmstrip (Below) ── */}
              <div className="flex flex-col gap-2 pt-2 border-t border-slate-200/80">
                <div className="flex items-center justify-between pb-1.5 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-slate-500">
                      VARIATIONS FILMSTRIP
                    </span>
                    <span className="rounded bg-slate-100 border border-slate-200 px-1.5 py-0.2 font-mono text-[9px] font-bold text-[#D95D24]">
                      {outputs.filter((o) => o.status === 'done').length} / 4 SLOTS
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setFilterModelOnly((prev) => !prev)}
                      className={`flex h-6 w-6 items-center justify-center rounded-full border transition ${
                        filterModelOnly
                          ? 'border-[#0F0C59] bg-[#0F0C59] text-white'
                          : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-white hover:text-slate-900 shadow-2xs'
                      }`}
                      title={filterModelOnly ? 'Showing current model outputs' : 'Filter by model'}
                    >
                      <span className="text-[10px]">⚙️</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setFilmstripView((prev) => (prev === 'carousel' ? 'grid' : 'carousel'))}
                      className={`flex h-6 w-6 items-center justify-center rounded-full border transition ${
                        filmstripView === 'grid'
                          ? 'border-[#0F0C59] bg-[#0F0C59] text-white'
                          : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-white hover:text-slate-900 shadow-2xs'
                      }`}
                      title={filmstripView === 'grid' ? 'Switch to Single Column' : 'Switch to 2-Column Grid'}
                    >
                      <span className="text-[10px]">⊞</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowComposeDrawer((prev) => !prev)}
                      className={`flex h-6 w-6 items-center justify-center rounded-full border transition ${
                        showComposeDrawer
                          ? 'border-[#0F0C59] bg-[#0F0C59] text-white'
                          : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-white hover:text-slate-900 shadow-2xs'
                      }`}
                      title="Toggle Text Compose Studio"
                    >
                      <span className="text-[10px]">T</span>
                    </button>
                  </div>
                </div>
                {/* Compose Drawer if opened and output selected */}
                {showComposeDrawer && selectedOutput && (
                  <div className="flex flex-col gap-2 bg-slate-50 rounded-xl p-2.5 border border-slate-200 shrink-0">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[9px] font-bold text-slate-500 uppercase">COMPOSE TEXT</span>
                      <span className="font-mono text-[10px] font-bold text-[#D95D24]">SLOT {selectedOutput.slot + 1}</span>
                    </div>
                    <input
                      value={composeHeadline}
                      onChange={(event) => setComposeHeadline(event.target.value)}
                      placeholder="Headline text…"
                      className="h-7 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-800 placeholder-slate-400 outline-none focus:border-blue-500"
                    />
                    <div className="flex items-center gap-1.5">
                      <input
                        value={composeFontName}
                        onChange={(event) => setComposeFontName(event.target.value)}
                        placeholder="Font (e.g. Anton)"
                        className="h-7 flex-1 min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-800 placeholder-slate-400 outline-none focus:border-blue-500"
                      />
                      <input
                        type="color"
                        value={composeColor}
                        onChange={(event) => setComposeColor(event.target.value)}
                        className="h-7 w-7 rounded-lg border border-slate-200 bg-transparent p-0.5 cursor-pointer shrink-0"
                        title="Text Color"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-1">
                      <div className="grid grid-cols-3 gap-0.5">
                        {COMPOSE_POSITIONS.map((pos) => (
                          <button
                            key={pos.id}
                            type="button"
                            onClick={() => setComposePosition(pos.id)}
                            className={`h-5 w-6 rounded text-[8px] font-mono font-bold transition ${
                              composePosition === pos.id ? 'bg-[#0F0C59] text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                            }`}
                          >
                            {pos.label}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        disabled={composingState === 'composing'}
                        onClick={composeTextOnOutput}
                        className="h-7 flex-1 rounded-lg bg-[#0F0C59] px-2 font-mono text-[11px] font-bold text-white hover:bg-blue-900 transition disabled:opacity-40"
                      >
                        {composingState === 'composing' ? '…' : '+ Add Text'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Vertical Scroll for the 4 Images */}
                <div
                  className={`flex-1 min-h-0 overflow-y-auto scrollbar-thin pr-0.5 ${
                    filmstripView === 'grid' ? 'grid grid-cols-2 gap-2' : 'space-y-2.5'
                  }`}
                >
                  {outputs.length > 0 ? (
                    outputs.map((output) => {
                      const isSelected = selectedOutputSlot === output.slot
                      return (
                        <div
                          key={output.slot}
                          onClick={() => setSelectedOutputSlot(output.slot)}
                          className={`group relative rounded-xl border transition-all cursor-pointer overflow-hidden ${
                            filmstripView === 'grid' ? 'h-32' : 'h-44'
                          } ${
                            isSelected
                              ? 'border-[#0F0C59] ring-2 ring-blue-500/20 bg-blue-50/30 shadow-md'
                              : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white shadow-2xs'
                          }`}
                        >
                          {/* Header Badges */}
                          <div className="absolute top-1.5 left-2 right-2 z-20 flex items-center justify-between pointer-events-none">
                            <span className="rounded bg-white/90 border border-slate-200 px-1.5 py-0.2 font-mono text-[9px] font-bold text-slate-800 shadow-2xs">
                              OUT-0{output.slot + 1}
                            </span>
                            <span className="rounded bg-white/90 border border-slate-200 px-1.5 py-0.2 font-mono text-[8px] font-bold text-[#D95D24] shadow-2xs uppercase">
                              FLUX-01
                            </span>
                          </div>

                          {/* Status Rendering */}
                          {output.status === 'pending' ? (
                            <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-telemetry-grid">
                              <span className="h-2 w-2 rounded-full bg-[#D95D24] animate-ping" />
                              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-600">
                                GENERATING…
                              </span>
                            </div>
                          ) : output.status === 'error' ? (
                            <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
                              <span className="font-mono text-[9px] text-red-600 line-clamp-2">{output.error}</span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  void generate()
                                }}
                                className="rounded-full bg-red-100 px-2 py-0.5 font-mono text-[9px] font-bold text-red-700 hover:bg-red-200"
                              >
                                Retry
                              </button>
                            </div>
                          ) : output.status === 'done' && output.url ? (
                            <>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={output.url}
                                alt={output.name ?? ''}
                                className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                              />

                              {/* Hover Quick Actions Overlay */}
                              <div className="absolute inset-0 z-20 flex items-end justify-between bg-gradient-to-t from-slate-900/80 via-slate-900/30 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    if (!output.url) return
                                    createImageReferenceAtPoint({
                                      imageUrl: output.url,
                                      label: cleanReferenceName(output.name, generatedImageName(output.slot)),
                                      source: 'generated',
                                      width: output.width,
                                      height: output.height,
                                    })
                                  }}
                                  className="rounded bg-[#0F0C59] px-2 py-0.5 font-mono text-[9px] font-bold text-white hover:bg-blue-900 shadow-sm"
                                  title="Send cutout reference to canvas"
                                >
                                  + Canvas
                                </button>

                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      if (!output.url) return
                                      void buildOrbitScene({
                                        url: output.url,
                                        label: cleanReferenceName(output.name, generatedImageName(output.slot)),
                                      })
                                    }}
                                    className="rounded border border-white/20 bg-black/60 px-1.5 py-0.5 font-mono text-[9px] text-white hover:bg-black/90"
                                    title="3D Orbit scene previz"
                                  >
                                    3D
                                  </button>

                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      void downloadOutput(output)
                                    }}
                                    className="rounded border border-white/20 bg-black/60 px-1.5 py-0.5 font-mono text-[9px] text-white hover:bg-black/90"
                                    title="Download image"
                                  >
                                    ↓
                                  </button>
                                </div>
                              </div>
                            </>
                          ) : null}
                        </div>
                      )
                    })
                  ) : (
                    /* 4 Standby Slot Cards */
                    [0, 1, 2, 3].map((slot) => (
                      <div
                        key={slot}
                        onClick={() => void generate()}
                        className={`flex shrink-0 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/70 transition hover:border-[#0F0C59] hover:bg-white cursor-pointer group shadow-2xs ${
                          filmstripView === 'grid' ? 'h-32' : 'h-36'
                        }`}
                      >
                        <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-slate-400 group-hover:text-slate-600">
                          OUT-0{slot + 1} · STANDBY
                        </span>
                        <span className="mt-1 font-mono text-[10px] text-[#D95D24] opacity-80 group-hover:opacity-100">
                          + Ready for Blend
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* ── CENTER BENTO COLUMN: The Moodboard Stage (Swiss Cockpit) ── */}
        <section className={`col-span-12 ${
          explorePanelOpen ? 'lg:col-span-6' : 'lg:col-span-9'
        } flex flex-col rounded-2xl border border-[#E2E5EA] bg-white overflow-hidden relative shadow-[0_2px_12px_rgba(0,0,0,0.04)] min-h-0`}>
          {/* Stage Top-Left Glass Pill (Undo, Redo, Zoom to Fit, Tools) */}
          <div className="absolute top-3 left-3 z-30 flex items-center gap-1 rounded-full border border-slate-200 bg-white/95 p-1 backdrop-blur-md shadow-sm">
            <button
              type="button"
              onClick={() => editorRef.current?.undo()}
              className="flex h-7 w-7 items-center justify-center rounded-full text-xs text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition"
              title="Undo (Cmd+Z)"
            >
              ↺
            </button>
            <button
              type="button"
              onClick={() => editorRef.current?.redo()}
              className="flex h-7 w-7 items-center justify-center rounded-full text-xs text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition"
              title="Redo (Cmd+Shift+Z)"
            >
              ↻
            </button>
            <div className="h-4 w-px bg-slate-200" />
            <button
              type="button"
              onClick={handleZoomToFit}
              className="flex h-7 w-7 items-center justify-center rounded-full text-xs text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition"
              title="Zoom to Fit"
            >
              ⊡
            </button>
            <button
              type="button"
              onClick={() => setIsToolbarCollapsed((prev) => !prev)}
              className="flex h-7 px-2.5 items-center justify-center rounded-full text-[10px] font-mono font-bold text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition"
              title="Toggle drawing tools"
            >
              {isToolbarCollapsed ? '✏️ Tools' : '✕ Hide'}
            </button>
          </div>

          {/* Stage Top-Right Studio Light / Dark Canvas Toggle */}
          <div className="absolute top-3 right-3 z-30 flex items-center gap-1 rounded-full border border-slate-200 bg-white/95 p-1 backdrop-blur-md shadow-sm">
            <button
              type="button"
              onClick={() => setCanvasTheme('light')}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[10px] font-bold transition ${
                canvasTheme === 'light'
                  ? 'bg-[#0F0C59] text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>☀️</span>
              <span>STUDIO LIGHT</span>
            </button>
            <button
              type="button"
              onClick={() => setCanvasTheme('dark')}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[10px] font-bold transition ${
                canvasTheme === 'dark'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>🌙</span>
              <span>INDIGO CANVAS</span>
            </button>
          </div>

          {/* Main Tldraw Canvas Container */}
          <div className={`relative min-w-0 flex-1 h-full w-full ${canvasTheme === 'dark' ? 'canvas-dark' : 'canvas-light'}`}>
            <div className={`absolute inset-0 ${showResolvedComments ? '' : 'hide-resolved-comments'}`}>
              <Tldraw
                key={boardRecord?.id ?? 'anonymous'}
                licenseKey={tldrawLicenseKey}
                components={tldrawComponents}
                shapeUtils={shapeUtils}
                snapshot={tldrawSnapshot}
                onMount={(editor) => {
                  editorRef.current = editor
                  let disposed = false

                  const fitCanvasContent = (attempts = 0) => {
                    if (disposed) return
                    const container = editor.getContainer()
                    const rect = container?.getBoundingClientRect()
                    if ((!rect || rect.width < 100 || rect.height < 100) && attempts < 12) {
                      window.setTimeout(() => fitCanvasContent(attempts + 1), 50)
                      return
                    }

                    const shapes = editor.getCurrentPageShapes()
                    if (shapes.length > 0) {
                      editor.zoomToFit({ animation: { duration: 0 } })
                      if (shapes.length <= 8 && editor.getZoomLevel() < 0.5) {
                        const pageBounds = editor.getCurrentPageBounds()
                        if (pageBounds) {
                          editor.centerOnPoint({ x: pageBounds.center.x, y: pageBounds.center.y }, { animation: { duration: 0 } })
                          editor.resetZoom(editor.getViewportScreenCenter(), { animation: { duration: 0 } })
                        }
                      }
                    } else {
                      editor.resetZoom(editor.getViewportScreenCenter(), { animation: { duration: 0 } })
                    }
                    suppressSaveRef.current = false
                    refreshCanvasStats()
                  }

                  if (tldrawSnapshot) {
                    suppressSaveRef.current = true
                    window.requestAnimationFrame(() => {
                      fitCanvasContent()
                    })
                  } else {
                    refreshCanvasStats()
                  }

                  const unlisten = editor.store.listen(() => {
                    scheduleSave()
                    const zoom = Math.round(editor.getZoomLevel() * 100)
                    setZoomLevelPercent((prev) => (prev !== zoom ? zoom : prev))
                  })
                  refreshCanvasStats()
                  return () => {
                    disposed = true
                    unlisten()
                  }
                }}
              />
              {commentMode ? (
                <button
                  type="button"
                  className="absolute inset-0 z-50 cursor-crosshair border-0 bg-transparent p-0"
                  aria-label="Drop comment pin"
                  onClick={(event) => dropCommentAtScreenPoint({ x: event.clientX, y: event.clientY })}
                />
              ) : null}
            </div>
          </div>

          {/* Bottom-Center Floating Zoom Slider Bar (mirroring Image 3 below container) */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 rounded-full border border-slate-200/90 bg-white/95 px-4 py-2 shadow-xl backdrop-blur-md">
            {/* Horizontal Slider Controls: (-) ━━━━━━●━━━━━━ (+) */}
            <div className="flex items-center gap-2.5 pr-3 border-r border-slate-200">
              <button
                type="button"
                onClick={() => {
                  editorRef.current?.zoomOut()
                  refreshCanvasStats()
                }}
                className="flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold text-slate-700 hover:bg-slate-100 transition active:scale-95"
                title="Zoom Out"
              >
                −
              </button>

              {/* Interactive Horizontal Line Slider Track with thumb matching Image 3 */}
              <div className="relative flex items-center w-28 sm:w-36">
                <input
                  type="range"
                  min="25"
                  max="200"
                  value={Math.min(200, Math.max(25, zoomLevelPercent))}
                  onChange={(e) => {
                    const newZoom = Number(e.target.value) / 100
                    const editor = editorRef.current
                    if (editor) {
                      const point = editor.getViewportScreenCenter()
                      const currentCamera = editor.getCamera()
                      const { x: cx, y: cy, z: cz } = currentCamera
                      const { x, y } = point
                      const z = Math.max(0.25, Math.min(2, newZoom))
                      editor.setCamera({
                        x: cx + (x / z - x) - (x / cz - x),
                        y: cy + (y / z - y) - (y / cz - y),
                        z: z,
                      })
                      setZoomLevelPercent(Math.round(z * 100))
                    }
                  }}
                  className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#0F0C59]"
                  title="Canvas Zoom Level"
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  editorRef.current?.zoomIn()
                  refreshCanvasStats()
                }}
                className="flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold text-slate-700 hover:bg-slate-100 transition active:scale-95"
                title="Zoom In"
              >
                +
              </button>

              <span className="font-mono text-xs font-bold text-slate-600 w-11 text-center">
                {zoomLevelPercent}%
              </span>

              {/* Zoom to fit search icon */}
              <button
                type="button"
                onClick={handleZoomToFit}
                className="flex h-7 w-7 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition"
                title="Zoom to Fit"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </button>
            </div>

            {/* Primary Blend / Generate CTA with touch of blue & terracotta */}
            <button
              type="button"
              disabled={generationState === 'generating'}
              onClick={() => {
                setChatPanelOpen((prev) => !prev)
              }}
              className="flex items-center gap-2 rounded-full bg-[#0F0C59] px-6 py-2 font-mono text-xs font-bold text-white transition-all hover:bg-blue-900 hover:scale-105 active:scale-95 disabled:opacity-50 shadow-md shadow-blue-950/20"
            >
              {generationState === 'generating' ? (
                <>
                  <span className="h-2 w-2 rounded-full bg-[#D95D24] animate-ping" />
                  <span>GENERATING…</span>
                </>
              ) : (
                <>
                  <span className="text-[#FCECD5]">✦</span>
                  <span>{chatPanelOpen ? 'CLOSE CHAT' : 'BLEND / GENERATE'}</span>
                </>
              )}
            </button>
          </div>
        </section>

        {/* ── RIGHT BENTO COLUMN: Docked Explore & Creative Resource Directory ── */}
        {explorePanelOpen && (
          <aside className="col-span-12 lg:col-span-3 flex flex-col rounded-2xl border border-[#E2E5EA] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-3 min-h-0 overflow-hidden">
            <ExplorePanel
              open={true}
              docked={true}
              onClose={() => setExplorePanelOpen(false)}
              editorRef={editorRef}
              onScheduleSave={scheduleSave}
              sessionUserId={session?.user.id}
            />
          </aside>
        )}
      </section>


      <SceneOrbitModal
        open={Boolean(orbitSource)}
        sourceUrl={orbitSource?.url ?? null}
        sourceLabel={orbitSource?.label ?? 'Generated scene'}
        modelUrl={orbitModelUrl}
        status={orbitStatus}
        error={orbitError}
        onClose={() => {
          setOrbitSource(null)
          setOrbitStatus('idle')
          setOrbitModelUrl(null)
          setOrbitError(null)
        }}
        onRetry={() => {
          if (orbitSource) void buildOrbitScene(orbitSource)
        }}
        onCapture={captureOrbitAngle}
      />

      {/* ── FLOATING GENERATE CHAT DIALOG (Swiss White & Cobalt Theme) ── */}
      {chatPanelOpen && (
        <section
          className="fixed bottom-24 right-6 z-[60] flex h-[560px] max-h-[calc(100vh-8rem)] w-[410px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white/95 shadow-2xl backdrop-blur-md"
          role="dialog"
          aria-label="Generate Chat Dialog"
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-3 bg-[#0F0C59] px-4 py-3 text-white">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[#FCECD5] text-sm">✦</span>
                <h2 className="m-0 truncate font-mono text-sm font-bold tracking-tight">Generate Chat</h2>
              </div>
              <p className="m-0 mt-0.5 truncate font-mono text-[10px] text-blue-200">
                {chatState === 'idle'
                  ? `Using ${canvasStats.imageCount} canvas references as context`
                  : 'Generating variations with board references…'}
              </p>
            </div>
            <button
              type="button"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/20 text-xs font-bold text-white hover:bg-white/10 transition"
              aria-label="Close chat"
              onClick={() => setChatPanelOpen(false)}
            >
              ✕
            </button>
          </div>

          {/* Quick Blend Action Bar */}
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/90 px-4 py-2 shrink-0">
            <span className="font-mono text-[10px] font-bold text-slate-500">QUICK ACTION</span>
            <button
              type="button"
              disabled={generationState === 'generating'}
              onClick={() => void generate()}
              className="flex items-center gap-1.5 rounded-lg bg-[#D95D24] px-3 py-1 font-mono text-[10px] font-bold text-white shadow-xs hover:bg-[#E06328] active:scale-95 disabled:opacity-50 transition"
            >
              <span>✦</span>
              <span>{generationState === 'generating' ? 'Blending…' : 'Instant Blend Board'}</span>
            </button>
          </div>

          {/* Guest Notice if not logged in */}
          {!session && (
            <div className="border-b border-blue-100 bg-blue-50/80 px-4 py-2 flex items-center justify-between text-xs text-blue-900 shrink-0">
              <span className="font-mono text-[10px]">Guest mode active.</span>
              <button
                type="button"
                onClick={() => {
                  setIsGuest(false)
                  if (typeof window !== 'undefined') {
                    window.localStorage.removeItem('moodboard-guest-mode')
                  }
                }}
                className="font-mono text-[10px] font-bold text-[#0F0C59] underline hover:text-blue-700"
              >
                Sign in to Generate →
              </button>
            </div>
          )}

          {/* Chat Messages */}
          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin space-y-3 p-4 bg-[#F8FAFC]/50">
            {chatMessages.length ? (
              chatMessages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[88%] rounded-2xl px-3 py-2 text-xs leading-relaxed shadow-xs ${
                      message.role === 'user'
                        ? 'bg-blue-50 border border-blue-200 text-slate-900 font-medium'
                        : 'border border-slate-200 bg-white text-slate-800'
                    }`}
                  >
                    <p className="m-0 whitespace-pre-wrap">{message.content}</p>
                    {message.status === 'generating' && !message.images?.length ? (
                      <p className="m-0 mt-1.5 font-mono text-[10px] text-[#D95D24] animate-pulse">
                        Generating variations…
                      </p>
                    ) : null}
                    {message.images?.length ? (
                      <div className="mt-2.5 grid gap-2">
                        {message.images.map((image) => (
                          <div key={image.url} className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={image.url} alt={image.name ?? ''} className="aspect-square w-full object-cover" />
                            <div className="p-1.5 flex gap-1">
                              <button
                                type="button"
                                className="flex-1 rounded-lg bg-[#0F0C59] py-1 text-[10px] font-bold text-white hover:bg-blue-900 transition"
                                onClick={() =>
                                  createImageReferenceAtPoint({
                                    imageUrl: image.url,
                                    label: cleanReferenceName(image.name, 'chat output'),
                                    source: 'chat',
                                    width: image.width,
                                    height: image.height,
                                  })
                                }
                              >
                                + Add to board
                              </button>
                              <button
                                type="button"
                                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-mono text-slate-700 hover:bg-slate-100 transition"
                                onClick={() =>
                                  void buildOrbitScene({
                                    url: image.url,
                                    label: cleanReferenceName(image.name, 'chat output'),
                                  })
                                }
                              >
                                3D
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <div className="flex h-48 flex-col items-center justify-center text-center p-4">
                <span className="text-3xl mb-2">✨</span>
                <p className="m-0 font-mono text-xs text-slate-800 font-bold">Board Context Aware AI</p>
                <p className="m-0 mt-1.5 text-[11px] text-slate-500 leading-relaxed max-w-[260px]">
                  Describe what to generate, refine the creative direction, or click <strong className="text-slate-700">Instant Blend</strong> above to synthesize all canvas references with FLUX.
                </p>
              </div>
            )}
          </div>

          {/* Chat Form */}
          <form
            className="p-3 border-t border-slate-200 bg-white shrink-0"
            onSubmit={(event) => {
              event.preventDefault()
              void sendChatMessage()
            }}
          >
            <div className="flex items-end gap-2">
              <textarea
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void sendChatMessage()
                  }
                }}
                placeholder={!session ? 'Sign in to generate with AI' : canGenerate ? 'Describe generation prompt…' : 'Buy credits to generate'}
                rows={2}
                className="min-h-11 flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 focus:bg-white px-3 py-2 text-xs text-slate-800 placeholder-slate-400 outline-none transition focus:border-blue-500"
              />
              <button
                type="submit"
                disabled={!chatInput.trim() || chatState !== 'idle' || (!canGenerate && Boolean(session))}
                className="h-11 rounded-xl bg-[#0F0C59] px-4 font-mono text-xs font-bold text-white transition hover:bg-blue-900 disabled:opacity-40 shadow-sm"
              >
                Send
              </button>
            </div>
          </form>
        </section>
      )}

      {creditModalOpen ? (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4" role="dialog" aria-modal="true" aria-label="Buy credits">
          <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-7 shadow-2xl text-slate-900">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#D95D24]">STRIPE CHECKOUT</span>
                  <span className="text-slate-300">/</span>
                  <h2 className="m-0 text-xl font-bold text-slate-900">Recharge Credits</h2>
                </div>
                <p className="m-0 mt-1 text-xs text-slate-500">100 credits = $1. Secure payment processed through Stripe.</p>
              </div>
              <button
                type="button"
                className="rounded-full border border-slate-200 bg-slate-100 px-4 py-1.5 font-mono text-xs font-bold text-slate-700 hover:bg-slate-200"
                onClick={() => setCreditModalOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {([
                ['starter', '500', '$5'], ['creator', '1,500', '$15'], ['studio', '5,000', '$50'],
              ] as const).map(([id, credits, price]) => (
                <button
                  key={id}
                  type="button"
                  disabled={Boolean(checkoutLoading)}
                  onClick={() => void startCheckout(id)}
                  className="group rounded-2xl border border-slate-200 bg-slate-50 p-5 text-left transition hover:border-[#0F0C59] hover:bg-blue-50/40 disabled:opacity-50 shadow-xs"
                >
                  <span className="block font-mono text-2xl font-black text-slate-900 group-hover:text-[#0F0C59]">{credits}</span>
                  <span className="block font-mono text-[10px] uppercase text-slate-500">credits</span>
                  <span className="mt-4 block font-mono text-sm font-bold text-[#D95D24]">{checkoutLoading === id ? 'Connecting…' : price}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}
