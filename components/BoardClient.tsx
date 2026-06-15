'use client'

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Session } from '@supabase/supabase-js'
import { AssetRecordType, Editor, Tldraw, TLEditorSnapshot, TLComponents, TLStoreSnapshot } from 'tldraw'
import { moodboardShapeUtils } from '@/components/moodboardShapes'
import { captureClientEvent } from '@/lib/analytics/client'
import { BoardDoc, ChatMessage, SourceImage, cleanHexColors, cleanTags, isMoodboardDocument } from '@/lib/board'
import { StoredBoard } from '@/lib/boards'
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
  action: 'subject' | 'describe' | 'palette'
} | null
type UsageQuota = {
  imagesUsed: number
  imageLimit: number
  imagesRemaining: number
}

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

function isInvalidRefreshTokenError(error: unknown) {
  return error instanceof Error && /invalid refresh token|refresh token.*already used|already used/i.test(error.message)
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
  const [quota, setQuota] = useState<UsageQuota | null>(null)
  const [boardRecord, setBoardRecord] = useState<StoredBoard | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [shareMessage, setShareMessage] = useState<string | null>(null)
  const [importState, setImportState] = useState<ImportState>('idle')
  const [generationState, setGenerationState] = useState<GenerationState>('idle')
  const [composingState, setComposingState] = useState<ComposingState>('idle')
  const [outputs, setOutputs] = useState<TrayOutput[]>([])
  const [selectedOutputSlot, setSelectedOutputSlot] = useState<number | null>(null)
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

  const shapeUtils = useMemo(() => moodboardShapeUtils, [])
  const tldrawComponents = useMemo<TLComponents>(() => ({ StylePanel: null }), [])
  const selectedOutput = useMemo(
    () => outputs.find((output) => output.slot === selectedOutputSlot && output.status === 'done' && output.url),
    [outputs, selectedOutputSlot]
  )
  const canGenerate = Boolean(quota && quota.imagesRemaining >= IMAGES_PER_GENERATION)
  const quotaBlocked = Boolean(quota && quota.imagesRemaining < IMAGES_PER_GENERATION)

  const isTldrawSnapshot = (document: unknown) =>
    Boolean(document && typeof document === 'object' && 'store' in document && 'schema' in document)

  const getStoredTldrawSnapshot = (document: unknown) =>
    isMoodboardDocument(document) ? document.tldraw : document

  const tldrawSnapshot = useMemo(() => {
    // eslint-disable-next-line react-hooks/refs
    if (initialSnapshotRef.current) return initialSnapshotRef.current
    const snapshot = boardRecord ? getStoredTldrawSnapshot(boardRecord.document) : null
    const valid = isTldrawSnapshot(snapshot)
      ? migrateMoodboardNoteSnapshot(snapshot as TLEditorSnapshot | TLStoreSnapshot)
      : undefined
    // eslint-disable-next-line react-hooks/refs
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
    setSourceList(isMoodboardDocument(board.document) ? board.document.sources : [])
    chatMessagesRef.current = storedChat
    setChatMessages(storedChat)
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

  const loadQuota = useCallback(async (nextSession: Session) => {
    try {
      const response = await fetch('/api/profile', {
        headers: {
          authorization: `Bearer ${nextSession.access_token}`,
        },
      })
      const result = (await response.json()) as Partial<UsageQuota> & { error?: string }

      if (!response.ok || typeof result.imagesRemaining !== 'number') {
        throw new Error(result.error ?? 'Could not load image quota.')
      }

      setQuota({
        imagesUsed: result.imagesUsed ?? 0,
        imageLimit: result.imageLimit ?? 10,
        imagesRemaining: result.imagesRemaining,
      })
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not load image quota.'
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
          if (isInvalidRefreshTokenError(sessionError)) {
            void supabase.auth.signOut({ scope: 'local' }).catch(() => null)
            resetPersistedSession()
            return
          }
          throw sessionError
        }

        sessionRef.current = sessionData.session
        setSession(sessionData.session)
        if (sessionData.session) loadAuthenticatedState(sessionData.session)
      })
      .catch((caught) => {
        if (isInvalidRefreshTokenError(caught)) {
          void supabase.auth.signOut({ scope: 'local' }).catch(() => null)
          resetPersistedSession()
          return
        }

        const message = caught instanceof Error ? caught.message : 'Could not restore session.'
        setError(message)
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
    if (!sessionRef.current || !boardRef.current || suppressSaveRef.current) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      void saveBoard()
    }, 900)
  }, [saveBoard])

  const updateChatMessages = useCallback(
    (next: ChatMessage[] | ((current: ChatMessage[]) => ChatMessage[]), shouldSave = true) => {
      const nextMessages = typeof next === 'function' ? next(chatMessagesRef.current) : next
      chatMessagesRef.current = nextMessages
      setChatMessages(nextMessages)
      if (shouldSave) scheduleSave()
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
        .filter((shape) => shape.type === 'moodboard-note')
        .map((shape) => {
          const props = shape.props as { text?: string }
          return { text: props.text?.trim() ?? '' }
        })
        .filter((note) => note.text),
    }
  }, [brief])

  const updateQuotaFromPayload = (payload: Partial<UsageQuota>) => {
    if (typeof payload.imagesRemaining !== 'number') return

    setQuota({
      imagesUsed: payload.imagesUsed ?? Math.max(0, (payload.imageLimit ?? 10) - payload.imagesRemaining),
      imageLimit: payload.imageLimit ?? 10,
      imagesRemaining: payload.imagesRemaining,
    })
  }

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
      setError('Log in before generating.')
      return
    }

    if (!canGenerate) {
      setError('You need at least 2 images left to generate.')
      setOutputs([])
      return
    }

    setError(null)
    setSelectedOutputSlot(null)
    setGenerationState('generating')
    setOutputs(Array.from({ length: IMAGES_PER_GENERATION }, (_, slot) => ({ slot, status: 'pending' })))
    let blockedByLimit = false

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${currentSession.access_token}`,
        },
        body: JSON.stringify({ boardId: getBoardId(), count: IMAGES_PER_GENERATION, board: getBoardDoc() }),
      })

      if (!response.ok || !response.body) {
        const result = (await response.json().catch(() => null)) as
          | (Partial<UsageQuota> & { error?: string; code?: string; limit_reached?: boolean })
          | null
        if (result?.limit_reached || result?.code === 'limit_reached') {
          blockedByLimit = true
          updateQuotaFromPayload(result)
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
                imagesUsed?: number
                imageLimit?: number
                imagesRemaining?: number
              }
            | { type: 'output'; slot: number; url: string; width?: number; height?: number; seed: number }
            | { type: 'error'; slot: number; error: string }
            | { type: 'done'; outputCount?: number; imagesUsed?: number; imageLimit?: number; imagesRemaining?: number }

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
      setError('Log in before generating.')
      return
    }

    if (!canGenerate) {
      setError('You need at least 2 images left to generate.')
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
      setOutputs(Array.from({ length: IMAGES_PER_GENERATION }, (_, slot) => ({ slot, status: 'pending' })))

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
        }),
      })

      if (!generationResponse.ok || !generationResponse.body) {
        const result = (await generationResponse.json().catch(() => null)) as
          | (Partial<UsageQuota> & { error?: string; code?: string; limit_reached?: boolean })
          | null
        if (result?.limit_reached || result?.code === 'limit_reached') {
          blockedByLimit = true
          updateQuotaFromPayload(result)
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
                imagesUsed?: number
                imageLimit?: number
                imagesRemaining?: number
              }
            | { type: 'output'; slot: number; url: string; width?: number; height?: number; seed: number }
            | { type: 'error'; slot: number; error: string }
            | { type: 'done'; outputCount?: number; imagesUsed?: number; imageLimit?: number; imagesRemaining?: number }

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
                        { url: event.url, width: event.width, height: event.height, seed: event.seed },
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
                  ? { slot: event.slot, status: 'error', error: event.error }
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
        { slot, status: 'done', url: result.url, width: result.width, height: result.height },
      ])
      setSelectedOutputSlot(slot)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Text composition failed.'
      setError(message)
    } finally {
      setComposingState('idle')
    }
  }

  if (!authReady) {
    return (
      <main className="flex h-screen min-h-[620px] items-center justify-center bg-[#f4f1ea] px-4 text-neutral-950">
        <div className="text-sm font-semibold text-neutral-600">Loading...</div>
      </main>
    )
  }

  if (!session) {
    return (
      <main className="flex h-screen min-h-[680px] items-center justify-center bg-[#f4f1ea] px-4 text-neutral-950">
        <section className="w-full max-w-md rounded border border-neutral-950/10 bg-[#fbfaf6] p-5 shadow-sm">
          <div className="mb-5">
            <h1 className="m-0 text-2xl font-semibold tracking-normal">{APP_NAME}</h1>
            <p className="m-0 mt-1 text-sm text-neutral-600">Sign in to create, save, generate, and share boards.</p>
          </div>

          <div className="mb-4 grid grid-cols-2 rounded border border-neutral-300 bg-white p-1">
            <button
              type="button"
              className={`h-9 rounded text-sm font-semibold ${
                authMode === 'login' ? 'bg-neutral-950 text-white' : 'text-neutral-700'
              }`}
              onClick={() => {
                setAuthMode('login')
                setError(null)
                setAuthMessage(null)
              }}
            >
              Log in
            </button>
            <button
              type="button"
              className={`h-9 rounded text-sm font-semibold ${
                authMode === 'signup' ? 'bg-neutral-950 text-white' : 'text-neutral-700'
              }`}
              onClick={() => {
                setAuthMode('signup')
                setError(null)
                setAuthMessage(null)
              }}
            >
              Sign up
            </button>
          </div>

          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              void handlePasswordAuth()
            }}
          >
            <input
              value={authEmail}
              onChange={(event) => setAuthEmail(event.target.value)}
              type="email"
              autoComplete="email"
              placeholder="Email"
              className="h-11 rounded border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-neutral-950"
            />
            <input
              value={authPassword}
              onChange={(event) => setAuthPassword(event.target.value)}
              type="password"
              autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
              placeholder="Password"
              className="h-11 rounded border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-neutral-950"
            />
            {authMode === 'signup' ? (
              <input
                value={authConfirmPassword}
                onChange={(event) => setAuthConfirmPassword(event.target.value)}
                type="password"
                autoComplete="new-password"
                placeholder="Confirm password"
                className="h-11 rounded border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-neutral-950"
              />
            ) : null}
            <button
              type="submit"
              className="h-11 rounded bg-neutral-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={authSubmitting}
            >
              {authSubmitting ? 'Working...' : authMode === 'signup' ? 'Create account' : 'Log in'}
            </button>
          </form>

          <div className="my-4 flex items-center gap-3 text-xs uppercase text-neutral-400">
            <span className="h-px flex-1 bg-neutral-300" />
            or
            <span className="h-px flex-1 bg-neutral-300" />
          </div>

          <div className="grid gap-2">
            <button
              type="button"
              className="h-11 rounded border border-neutral-300 bg-white px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void continueWithGoogle()}
              disabled={authSubmitting}
            >
              Continue with Google
            </button>
            <button
              type="button"
              className="h-11 rounded border border-neutral-300 bg-white px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void sendMagicLink()}
              disabled={authSubmitting}
            >
              Email magic link
            </button>
          </div>

          <p className="m-0 mt-4 text-xs leading-relaxed text-neutral-500">
            Signup may require email confirmation depending on your Supabase Auth setting.
          </p>
          {authMessage ? <p className="m-0 mt-3 text-sm font-medium text-[#0f766e]">{authMessage}</p> : null}
          {error ? <p className="m-0 mt-3 text-sm font-medium text-red-700">{error}</p> : null}
        </section>
      </main>
    )
  }

  return (
    <main className="flex h-screen min-h-[720px] flex-col bg-[#f4f1ea] text-neutral-950">
      <header className="flex flex-col gap-3 border-b border-neutral-950/10 bg-[#fbfaf6] px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
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
            className="h-10 rounded bg-[#0f766e] px-4 text-sm font-semibold text-white"
            onClick={() => setChatPanelOpen(true)}
          >
            Open chat
          </button>
          {quota ? (
            <span
              className={`rounded border px-3 py-2 text-sm font-semibold ${
                quotaBlocked ? 'border-red-200 bg-red-50 text-red-800' : 'border-[#0f766e]/20 bg-[#0f766e]/10 text-[#0f766e]'
              }`}
            >
              {quota.imagesRemaining} of {quota.imageLimit} images left
            </span>
          ) : (
            <span className="text-sm text-neutral-600">Loading quota...</span>
          )}
          <button
            type="button"
            className="h-10 rounded border border-neutral-300 bg-white px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
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
                  type: 'moodboard-note',
                  props: { text, w: 250, h: 150 },
                })
              }
            }}
          >
            Note
          </button>
          <button
            type="button"
            className={`h-9 rounded border px-3 text-sm font-semibold ${
              commentMode ? 'border-[#0f766e] bg-[#0f766e] text-white' : 'border-neutral-300 bg-white'
            }`}
            onClick={() => setCommentMode((current) => !current)}
          >
            Comment
          </button>
          <button
            type="button"
            className="h-9 rounded border border-neutral-300 bg-white px-3 text-sm font-semibold"
            onClick={() => setShowResolvedComments((current) => !current)}
          >
            {showResolvedComments ? 'Hide resolved' : 'Show resolved'}
          </button>
          {importState === 'importing' ? <span className="text-sm text-neutral-600">Importing...</span> : null}
          <span className="text-sm text-neutral-600">{saveState}</span>
          {shareMessage ? <span className="text-sm text-neutral-600">{shareMessage}</span> : null}
          {error ? <span className="text-sm font-medium text-red-700">{error}</span> : null}
        </div>
      </header>

      <section className="flex min-h-0 flex-1">
        {sourcesOpen ? (
          <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-r border-neutral-950/10 bg-[#fbfaf6] p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="m-0 text-sm font-semibold">Sources</h2>
                <p className="m-0 mt-1 text-xs text-neutral-500">Full images stay here. Extract cutouts to compose.</p>
              </div>
              <button
                type="button"
                className="h-8 rounded border border-neutral-300 bg-white px-2 text-xs font-semibold"
                onClick={() => setSourcesOpen(false)}
              >
                Hide
              </button>
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
        ) : (
          <button
            type="button"
            className="flex w-11 shrink-0 items-center justify-center border-r border-neutral-950/10 bg-[#fbfaf6] text-xs font-semibold text-neutral-700"
            aria-label="Show sources"
            onClick={() => setSourcesOpen(true)}
          >
            <span className="-rotate-90 whitespace-nowrap">Sources</span>
          </button>
        )}

        <div className="relative min-w-0 flex-1">
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
                if (tldrawSnapshot) {
                  suppressSaveRef.current = true
                  window.requestAnimationFrame(() => {
                    if (disposed) return
                    editor.zoomToFit()
                    window.setTimeout(() => {
                      if (disposed) return
                      editor.zoomToFit()
                      suppressSaveRef.current = false
                    }, 160)
                  })
                }
                const unlisten = editor.store.listen(() => scheduleSave(), { source: 'user', scope: 'document' })
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
                aria-label="Drop comment"
                onClick={(event) => dropCommentAtScreenPoint({ x: event.clientX, y: event.clientY })}
              />
            ) : null}
          </div>
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
                      className="rounded bg-neutral-950 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={generationState === 'generating' || !canGenerate}
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

        {quotaBlocked ? (
          <div className="flex min-w-[260px] max-w-[320px] shrink-0 flex-col justify-center rounded border border-dashed border-red-200 bg-red-50 px-4 py-3 text-red-900">
            <p className="m-0 text-sm font-semibold">Image limit reached</p>
            <p className="m-0 mt-1 text-xs leading-relaxed">
              Upgrade options will appear here soon. Your board, sources, comments, and shares still work.
            </p>
          </div>
        ) : null}

        {selectedOutput ? (
          <div className="min-w-[360px] max-w-[460px] border-l border-neutral-950/10 pl-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase text-neutral-500">Compose text</span>
              <span className="text-xs text-neutral-500">Output {selectedOutput.slot + 1}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={composeHeadline}
                onChange={(event) => setComposeHeadline(event.target.value)}
                placeholder="Headline"
                maxLength={120}
                className="col-span-2 h-9 rounded border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-neutral-950"
              />
              <input
                value={composeFontName}
                onChange={(event) => {
                  setComposeFontName(event.target.value)
                  if (event.target.value.trim()) setComposeFontUrl('')
                }}
                placeholder="Google font"
                className="h-9 rounded border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-neutral-950"
              />
              <input
                value={composeFontUrl}
                onChange={(event) => {
                  setComposeFontUrl(event.target.value)
                  if (event.target.value.trim()) setComposeFontName('')
                }}
                placeholder="Font URL"
                className="h-9 rounded border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-neutral-950"
              />
              <input
                type="number"
                min={100}
                max={900}
                step={100}
                value={composeFontWeight}
                onChange={(event) => setComposeFontWeight(Number(event.target.value))}
                className="h-9 rounded border border-neutral-300 bg-white px-3 text-sm outline-none transition focus:border-neutral-950"
                title="Font weight"
              />
              <div className="flex h-9 overflow-hidden rounded border border-neutral-300 bg-white">
                <input
                  type="color"
                  value={composeColor}
                  onChange={(event) => setComposeColor(event.target.value)}
                  className="h-full w-12 border-0 bg-white p-1"
                  title="Text color"
                />
                <input
                  type="range"
                  min={0.02}
                  max={0.5}
                  step={0.01}
                  value={composeFontSizeRatio}
                  onChange={(event) => setComposeFontSizeRatio(Number(event.target.value))}
                  className="min-w-0 flex-1 px-2"
                  title="Font size"
                />
              </div>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <div className="grid grid-cols-3 gap-1">
                {COMPOSE_POSITIONS.map((position) => (
                  <button
                    key={position.id}
                    type="button"
                    className={`h-7 w-9 rounded border text-[10px] font-semibold ${
                      composePosition === position.id
                        ? 'border-[#0f766e] bg-[#0f766e] text-white'
                        : 'border-neutral-300 bg-white text-neutral-700'
                    }`}
                    title={position.id}
                    aria-pressed={composePosition === position.id}
                    onClick={() => setComposePosition(position.id)}
                  >
                    {position.label}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold text-neutral-600">
                <input
                  type="checkbox"
                  checked={composeOutline}
                  onChange={(event) => setComposeOutline(event.target.checked)}
                />
                Outline
              </label>
              <input
                type="color"
                value={composeOutlineColor}
                onChange={(event) => setComposeOutlineColor(event.target.value)}
                disabled={!composeOutline}
                className="h-8 w-10 rounded border border-neutral-300 bg-white p-1 disabled:opacity-40"
                title="Outline color"
              />
            </div>
            <button
              type="button"
              className="mt-2 h-9 w-full rounded bg-neutral-950 px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={composingState === 'composing' || !selectedOutput.url}
              onClick={composeTextOnOutput}
            >
              {composingState === 'composing' ? 'Composing...' : 'Add text'}
            </button>
          </div>
        ) : null}

      </aside>

      {chatPanelOpen ? (
        <section className="fixed bottom-5 right-5 z-[100] flex h-[560px] max-h-[calc(100vh-7rem)] w-[380px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-lg border border-neutral-950/10 bg-white shadow-2xl">
          <div className="flex items-center justify-between gap-3 bg-[#0f766e] px-4 py-3 text-white">
            <div className="min-w-0">
              <h2 className="m-0 truncate text-base font-semibold">Generate chat</h2>
              <p className="m-0 mt-0.5 truncate text-xs text-white/75">
                {chatState === 'idle' ? 'Use the board as context' : 'Generating with current references'}
              </p>
            </div>
            <button
              type="button"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-white/25 text-lg font-semibold text-white"
              aria-label="Close chat"
              onClick={() => setChatPanelOpen(false)}
            >
              x
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-[#fbfaf6] px-4 py-3">
            {chatMessages.length ? (
              <div className="space-y-3">
                {chatMessages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[88%] rounded-lg px-3 py-2 text-sm shadow-sm ${
                        message.role === 'user'
                          ? 'bg-neutral-950 text-white'
                          : 'border border-neutral-200 bg-white text-neutral-900'
                      }`}
                    >
                      <p className="m-0 whitespace-pre-wrap leading-snug">{message.content}</p>
                      {message.status === 'generating' && !message.images?.length ? (
                        <p className="m-0 mt-2 text-xs opacity-70">Generating images...</p>
                      ) : null}
                      {message.images?.length ? (
                        <div className="mt-3 grid gap-2">
                          {message.images.map((image) => (
                            <div key={image.url} className="overflow-hidden rounded border border-neutral-200 bg-white">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={image.url} alt="" className="aspect-square w-full object-cover" />
                              <button
                                type="button"
                                className="h-9 w-full border-t border-neutral-200 bg-[#0f766e] px-3 text-sm font-semibold text-white"
                                onClick={() =>
                                  createElementAtPoint({
                                    imageUrl: image.url,
                                    label: 'chat output',
                                    sourceId: 'chat',
                                    width: image.width,
                                    height: image.height,
                                  })
                                }
                              >
                                Add to board
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {message.status === 'error' ? (
                        <p className="m-0 mt-2 text-xs font-semibold text-red-700">Failed</p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-center">
                <p className="m-0 max-w-[260px] text-sm text-neutral-500">
                  Tell the board what to generate. Current elements, swatches, notes, and type samples are included.
                </p>
              </div>
            )}
          </div>

          <form
            className="border-t border-neutral-200 bg-white p-3"
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
                placeholder={canGenerate ? 'Describe the next image' : 'Image limit reached'}
                rows={2}
                className="min-h-12 flex-1 resize-none rounded border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-neutral-950"
              />
              <button
                type="submit"
                className="h-12 rounded bg-neutral-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!chatInput.trim() || chatState !== 'idle' || !canGenerate}
              >
                Send
              </button>
            </div>
          </form>
        </section>
      ) : (
        <button
          type="button"
          className="fixed bottom-5 right-5 z-[100] flex h-16 w-16 items-center justify-center rounded-full bg-[#0f766e] text-white shadow-2xl ring-8 ring-[#0f766e]/10"
          aria-label="Open chat"
          onClick={() => setChatPanelOpen(true)}
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="h-8 w-8"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.2"
          >
            <path d="M21 11.5a8.4 8.4 0 0 1-9 8.3 8.8 8.8 0 0 1-3.9-.9L3 20l1.2-4.4A8 8 0 0 1 3 11.5C3 6.8 7 3 12 3s9 3.8 9 8.5Z" />
            <path d="M8 10h8" />
            <path d="M8 14h5" />
          </svg>
        </button>
      )}
    </main>
  )
}
