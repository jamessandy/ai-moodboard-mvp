'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Editor } from 'tldraw'
import { AssetRecordType } from 'tldraw'
import { captureClientEvent } from '@/lib/analytics/client'
import {
  DIRECTORY_BRANCHES,
  DirectoryBranchId,
  ExploreItem,
  VibeSearchMode,
  getBranchItemCount,
} from '@/lib/explore-catalog'
import { Tag, TAGS } from '@/lib/tags'

// ── Types ────────────────────────────────────────────────────────────────────

type ExplorePanelProps = {
  open: boolean
  onClose: () => void
  editorRef: React.RefObject<Editor | null>
  onScheduleSave: () => void
  sessionUserId?: string | null
  docked?: boolean
}

interface VibeSearchResultItem {
  id: string
  site_id: string
  title: string
  source_name: string
  branch: DirectoryBranchId
  sub_branch?: string
  media_url?: string
  source_url?: string
  direct_search_url: string
  display_query: string
  description: string
  features?: string[]
  palette: string[]
  extracted_tags: Tag[]
}

interface VibeSearchResponse {
  query: string
  mode: VibeSearchMode
  adapted_queries: Record<string, string>
  extracted_tags: Tag[]
  vibe_palette: string[]
  results: VibeSearchResultItem[]
}

// ── Helper: load image dimensions ────────────────────────────────────────────

function loadImageDimensions(src: string) {
  return new Promise<{ width: number; height: number }>((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve({ width: 400, height: 300 })
    img.src = src
  })
}

// ── Branch Icons ─────────────────────────────────────────────────────────────

function BranchIcon({ branchId }: { branchId: DirectoryBranchId }) {
  const branch = DIRECTORY_BRANCHES.find((b) => b.id === branchId)
  if (!branch) return <span>🌟</span>
  return <span className="text-base">{branch.icon}</span>
}

// ── Main Component ───────────────────────────────────────────────────────────

export function ExplorePanel({ open, onClose, editorRef, onScheduleSave, sessionUserId, docked }: ExplorePanelProps) {
  const [items, setItems] = useState<ExploreItem[]>([])
  const [loading, setLoading] = useState(false)
  const [activeBranch, setActiveBranch] = useState<DirectoryBranchId>('all')
  const [activeSubBranch, setActiveSubBranch] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMode, setSearchMode] = useState<VibeSearchMode>('option_b')
  const [activeTag, setActiveTag] = useState<Tag | null>(null)
  const [clipperUrl, setClipperUrl] = useState('')
  const [clipperLoading, setClipperLoading] = useState(false)
  const [clipperError, setClipperError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [copiedHex, setCopiedHex] = useState<string | null>(null)
  const [loadingTemplate, setLoadingTemplate] = useState<string | null>(null)

  // Vibe Search states
  const [vibeSearchResults, setVibeSearchResults] = useState<VibeSearchResponse | null>(null)
  const [vibeSearching, setVibeSearching] = useState(false)
  const [vibeSearchError, setVibeSearchError] = useState<string | null>(null)

  // ── Fetch explore items (Catalog Tree) ──────────────────────────────────────

  const fetchItems = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (activeBranch !== 'all') params.set('branch', activeBranch)
      if (activeSubBranch !== 'all') params.set('subBranch', activeSubBranch)
      if (activeTag) params.set('tag', activeTag)

      const response = await fetch(`/api/explore?${params.toString()}`)
      if (!response.ok) throw new Error('Failed to load explore items.')
      const data = await response.json()
      setItems(data.items ?? [])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [activeBranch, activeSubBranch, activeTag])

  useEffect(() => {
    if (open) void fetchItems()
  }, [open, fetchItems])

  // ── Execute Vibe Search (Option A vs Option B) ──────────────────────────────

  const executeVibeSearch = useCallback(
    async (query: string, mode: VibeSearchMode) => {
      const trimmed = query.trim()
      if (!trimmed) {
        setVibeSearchResults(null)
        setVibeSearchError(null)
        return
      }

      setVibeSearching(true)
      setVibeSearchError(null)

      try {
        const response = await fetch('/api/explore/vibe-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vibe: trimmed,
            mode,
            branch: activeBranch !== 'all' ? activeBranch : undefined,
          }),
        })

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}))
          throw new Error(errData.error || 'Vibe search failed.')
        }

        const data: VibeSearchResponse = await response.json()
        setVibeSearchResults(data)
        captureClientEvent('explore_vibe_searched', { query: trimmed, mode, count: data.results.length }, sessionUserId)
      } catch (err) {
        setVibeSearchError(err instanceof Error ? err.message : 'Search failed.')
      } finally {
        setVibeSearching(false)
      }
    },
    [activeBranch, sessionUserId]
  )

  // ── Reset sub-branch when switching main branch ──────────────────────────

  const handleSelectBranch = (branchId: DirectoryBranchId) => {
    setActiveBranch(branchId)
    setActiveSubBranch('all')
    if (searchQuery.trim()) {
      void executeVibeSearch(searchQuery, searchMode)
    }
  }

  // Active branch metadata
  const currentBranchInfo = useMemo(() => {
    return DIRECTORY_BRANCHES.find((b) => b.id === activeBranch)
  }, [activeBranch])

  // ── Clipper / Unfurler ───────────────────────────────────────────────────

  const handleClipperSubmit = useCallback(async () => {
    if (!clipperUrl.trim()) return
    setClipperLoading(true)
    setClipperError(null)

    try {
      const response = await fetch('/api/explore/unfurl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: clipperUrl.trim() }),
      })
      const data = await response.json()

      if (data.error && !data.image_url) {
        setClipperError(data.error)
        return
      }

      if (data.image_url) {
        const importForm = new FormData()
        importForm.append('url', data.image_url)
        const importResponse = await fetch('/api/import-image', { method: 'POST', body: importForm })
        const importData = await importResponse.json()

        if (importData.url) {
          const editor = editorRef.current
          if (editor) {
            const dims = await loadImageDimensions(importData.url)
            const scale = Math.min(1, 340 / dims.width, 260 / dims.height)
            const w = Math.round(dims.width * scale)
            const h = Math.round(dims.height * scale)
            const viewport = editor.getViewportPageBounds()
            const x = viewport.x + viewport.w / 2 - w / 2 + Math.random() * 36
            const y = viewport.y + viewport.h / 2 - h / 2 + Math.random() * 36

            const asset = AssetRecordType.create({
              id: AssetRecordType.createId(),
              type: 'image',
              props: {
                src: importData.url,
                w: dims.width,
                h: dims.height,
                mimeType: 'image/png',
                name: `${data.title || 'clipped'}.png`,
                isAnimated: false,
              },
            })
            editor.createAssets([asset])
            editor.createShape({
              type: 'image-ref',
              x,
              y,
              props: {
                url: importData.url,
                assetId: asset.id,
                label: data.title || data.site_name || 'Clipped reference',
                tags: [],
                w,
                h,
              },
            } as Parameters<Editor['createShape']>[0])
            onScheduleSave()
            captureClientEvent('explore_url_clipped', { url: clipperUrl, site: data.site_name ?? '' }, sessionUserId)
          }
          setClipperUrl('')
        } else {
          setClipperError(importData.error || 'Could not import image.')
        }
      }
    } catch (err) {
      setClipperError(err instanceof Error ? err.message : 'Unfurl failed.')
    } finally {
      setClipperLoading(false)
    }
  }, [clipperUrl, editorRef, onScheduleSave, sessionUserId])

  // ── Canvas Insertion: Search Result Item into Board ───────────────────────

  const addVibeResultToBoard = useCallback(
    async (item: {
      title: string
      media_url?: string
      palette: string[]
      extracted_tags: Tag[]
    }) => {
      const editor = editorRef.current
      if (!editor) return

      const viewport = editor.getViewportPageBounds()
      const cx = viewport.x + viewport.w / 2
      const cy = viewport.y + viewport.h / 2

      if (item.media_url) {
        try {
          const importForm = new FormData()
          importForm.append('url', item.media_url)
          const importResponse = await fetch('/api/import-image', { method: 'POST', body: importForm })
          const importData = await importResponse.json()
          const imageUrl = importData.url || item.media_url

          const dims = await loadImageDimensions(imageUrl)
          const scale = Math.min(1, 340 / dims.width, 260 / dims.height)
          const w = Math.round(dims.width * scale)
          const h = Math.round(dims.height * scale)
          const x = cx - w / 2 + (Math.random() * 32 - 16)
          const y = cy - h / 2 + (Math.random() * 32 - 16)

          const asset = AssetRecordType.create({
            id: AssetRecordType.createId(),
            type: 'image',
            props: {
              src: imageUrl,
              w: dims.width,
              h: dims.height,
              mimeType: 'image/png',
              name: `${item.title}.png`,
              isAnimated: false,
            },
          })
          editor.createAssets([asset])

          editor.createShape({
            type: 'image-ref',
            x,
            y,
            props: { url: imageUrl, assetId: asset.id, label: item.title, tags: [...item.extracted_tags], w, h },
          } as Parameters<Editor['createShape']>[0])

          if (item.palette.length > 0) {
            editor.createShape({
              type: 'swatch',
              x: x - 10,
              y: y + h + 14,
              props: { colors: item.palette, w: Math.max(200, w), h: 56 },
            } as Parameters<Editor['createShape']>[0])
          }
        } catch {
          // fallback to note
          editor.createShape({
            type: 'moodboard-note',
            x: cx - 130,
            y: cy - 40,
            props: { text: `${item.title}\n${item.extracted_tags.join(', ')}`, w: 260, h: 80 },
          } as Parameters<Editor['createShape']>[0])
        }
      } else {
        // Add note + swatch
        editor.createShape({
          type: 'moodboard-note',
          x: cx - 130,
          y: cy - 60,
          props: { text: `Vibe: ${item.title}\nTags: ${item.extracted_tags.join(', ')}`, w: 260, h: 80 },
        } as Parameters<Editor['createShape']>[0])

        if (item.palette.length > 0) {
          editor.createShape({
            type: 'swatch',
            x: cx - 130,
            y: cy + 30,
            props: { colors: item.palette, w: 260, h: 64 },
          } as Parameters<Editor['createShape']>[0])
        }
      }

      onScheduleSave()
      captureClientEvent('explore_vibe_added_to_board', { title: item.title }, sessionUserId)
    },
    [editorRef, onScheduleSave, sessionUserId]
  )

  const addExploreItemToBoard = useCallback(
    async (item: ExploreItem) => {
      await addVibeResultToBoard({
        title: item.title,
        media_url: item.media_url,
        palette: item.palette ?? [],
        extracted_tags: item.extracted_tags ?? [],
      })
    },
    [addVibeResultToBoard]
  )

  // ── Canvas Insertion: Apply Vibe Only (Palette & Tags) ────────────────────

  const applyVibePaletteAndTags = useCallback(
    (palette: string[], tags: Tag[]) => {
      const editor = editorRef.current
      if (!editor) return

      const viewport = editor.getViewportPageBounds()
      const cx = viewport.x + viewport.w / 2
      const cy = viewport.y + viewport.h / 2

      if (palette.length > 0) {
        editor.createShape({
          type: 'swatch',
          x: cx - 120 + Math.random() * 20,
          y: cy - 46 + Math.random() * 20,
          props: { colors: palette, w: 240, h: 72 },
        } as Parameters<Editor['createShape']>[0])
      }

      if (tags.length > 0) {
        editor.createShape({
          type: 'moodboard-note',
          x: cx - 120 + Math.random() * 20,
          y: cy + 40 + Math.random() * 20,
          props: { text: tags.join(', '), w: 240, h: 80 },
        } as Parameters<Editor['createShape']>[0])
      }

      onScheduleSave()
      captureClientEvent('explore_vibe_applied', { tags: tags.join(','), palette: palette.join(',') }, sessionUserId)
    },
    [editorRef, onScheduleSave, sessionUserId]
  )

  // ── Load Template ────────────────────────────────────────────────────────

  const loadTemplate = useCallback(
    async (item: ExploreItem) => {
      if (!item.template_slug) return
      setLoadingTemplate(item.id)

      try {
        const response = await fetch(`/api/explore?template=${encodeURIComponent(item.template_slug)}`)
        if (!response.ok) throw new Error('Could not load template.')
        const data = await response.json()
        const template = data.template
        if (!template) throw new Error('Template payload missing.')

        const editor = editorRef.current
        if (!editor) return

        const viewport = editor.getViewportPageBounds()
        let offsetX = viewport.x + viewport.w / 2 - 200
        let offsetY = viewport.y + viewport.h / 2 - 150

        if (template.brief) {
          editor.createShape({
            type: 'moodboard-note',
            x: offsetX,
            y: offsetY,
            props: { text: template.brief, w: 300, h: 120 },
          } as Parameters<Editor['createShape']>[0])
          offsetY += 140
        }

        for (const swatch of template.swatches ?? []) {
          if (swatch.colors?.length) {
            editor.createShape({
              type: 'swatch',
              x: offsetX,
              y: offsetY,
              props: { colors: swatch.colors, w: 240, h: 72 },
            } as Parameters<Editor['createShape']>[0])
            offsetY += 90
          }
        }

        for (const sample of template.typeSamples ?? []) {
          editor.createShape({
            type: 'type-sample',
            x: offsetX + 260,
            y: offsetY - 90,
            props: { label: sample.label, w: 320, h: 80 },
          } as Parameters<Editor['createShape']>[0])
        }

        for (const note of template.notes ?? []) {
          editor.createShape({
            type: 'moodboard-note',
            x: offsetX + 320,
            y: offsetY,
            props: { text: note.text, w: 220, h: 100 },
          } as Parameters<Editor['createShape']>[0])
          offsetY += 120
        }

        onScheduleSave()
        captureClientEvent('explore_template_loaded', { template_slug: item.template_slug ?? '', title: item.title }, sessionUserId)
      } catch {
        // ignore
      } finally {
        setLoadingTemplate(null)
      }
    },
    [editorRef, onScheduleSave, sessionUserId]
  )

  // ── Copy helpers ─────────────────────────────────────────────────────────

  const handleCopyLink = useCallback(
    (item: { id: string; title: string; source_url?: string; media_url?: string }) => {
      const link = item.source_url || item.media_url
      if (!link) return
      void navigator.clipboard.writeText(link)
      setCopiedId(item.id)
      setTimeout(() => setCopiedId(null), 2000)
      captureClientEvent('explore_link_copied', { title: item.title, url: link }, sessionUserId)
    },
    [sessionUserId]
  )

  const handleCopyHex = useCallback((hex: string) => {
    void navigator.clipboard.writeText(hex)
    setCopiedHex(hex)
    setTimeout(() => setCopiedHex(null), 2000)
  }, [])

  const handleCopyAllHex = useCallback((palette: string[]) => {
    const text = palette.join(', ')
    void navigator.clipboard.writeText(text)
    setCopiedHex('palette')
    setTimeout(() => setCopiedHex(null), 2000)
  }, [])

  if (!open) return null

  const panelContent = (
    <div className={`flex h-full w-full flex-col overflow-hidden text-slate-900 ${docked ? 'bg-transparent' : 'bg-white'}`}>
      {/* ── Top Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/70 px-4 py-2.5">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-[#0F0C59] text-[10px] font-bold text-white">
              ✦
            </span>
            <h2 className="text-sm font-bold tracking-tight text-slate-900">Creative Resource Directory</h2>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-500 line-clamp-1">
            Curated inspo references, typography foundries & color palettes.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-xs text-slate-600 transition hover:bg-slate-200 hover:text-slate-900"
          title="Close panel"
        >
          ✕
        </button>
      </div>

      {/* ── Floating Notification Toast for Hex / Link Copying ──────────────── */}
      {copiedHex && (
        <div className="absolute top-16 right-4 z-50 flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 shadow-xl animate-fade-in">
          <span className="text-[#D95D24]">✓</span>
          <span>{copiedHex === 'palette' ? 'Copied full palette to clipboard!' : `Copied ${copiedHex} to clipboard!`}</span>
        </div>
      )}

      {/* ── Quick URL Clipper ────────────────────────────────────────────────── */}
      <div className="border-b border-slate-200 bg-slate-50/40 px-4 py-2">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void handleClipperSubmit()
          }}
          className="flex gap-2"
        >
          <input
            type="url"
            value={clipperUrl}
            onChange={(e) => setClipperUrl(e.target.value)}
            placeholder="Paste link from Filmgrab, Are.na, Pinterest to drop..."
            className="h-8 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-800 placeholder-slate-400 outline-none transition focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={clipperLoading || !clipperUrl.trim()}
            className="flex h-8 items-center rounded-xl bg-[#0F0C59] px-3 text-xs font-bold text-white transition hover:bg-blue-900 disabled:opacity-40"
          >
            {clipperLoading ? 'Unfurling…' : 'Drop'}
          </button>
        </form>
        {clipperError && <p className="mt-1 text-xs text-red-600">{clipperError}</p>}
      </div>

      {/* ── Search Bar & Testing Mode Switcher ──────────────────────────────── */}
      <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-2.5">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (searchQuery.trim()) {
              void executeVibeSearch(searchQuery, searchMode)
            } else {
              setVibeSearchResults(null)
            }
          }}
          className="flex flex-col gap-2"
        >
          <div className="relative flex items-center gap-2">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3 top-2 text-xs text-slate-400">🔍</span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  const val = e.target.value
                  setSearchQuery(val)
                  if (!val.trim()) {
                    setVibeSearchResults(null)
                    setVibeSearchError(null)
                  }
                }}
                placeholder="Search vibe (e.g. 90s cyber-noir, brutalist type)..."
                className="h-8 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-7 text-xs text-slate-800 placeholder-slate-400 outline-none transition focus:border-blue-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('')
                    setVibeSearchResults(null)
                    setVibeSearchError(null)
                  }}
                  className="absolute right-2.5 top-2 text-xs text-slate-400 hover:text-slate-700"
                >
                  ✕
                </button>
              )}
            </div>
            <button
              type="submit"
              disabled={vibeSearching || !searchQuery.trim()}
              className="flex h-8 shrink-0 items-center rounded-xl bg-[#D95D24] px-3 text-xs font-bold text-white transition hover:bg-[#E06328] disabled:opacity-40 shadow-xs"
            >
              {vibeSearching ? 'Searching…' : 'Search Vibe'}
            </button>
          </div>

          {/* Test Switcher: Option A (Direct) vs Option B (AI Vibe-Adapted) */}
          <div className="flex items-center justify-between gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
            <div className="flex items-center gap-1">
              <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-slate-500 pl-1">
                MODE:
              </span>
              <button
                type="button"
                onClick={() => {
                  setSearchMode('option_a')
                  if (searchQuery.trim()) {
                    void executeVibeSearch(searchQuery, 'option_a')
                  }
                }}
                className={`flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-bold transition ${
                  searchMode === 'option_a'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Option A: Direct deep-links with direct URL templates"
              >
                <span>⚡ Option A (Direct)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setSearchMode('option_b')
                  if (searchQuery.trim()) {
                    void executeVibeSearch(searchQuery, 'option_b')
                  }
                }}
                className={`flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-bold transition ${
                  searchMode === 'option_b'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Option B: AI/Domain query adaptation tailored to photography, fonts, video, etc."
              >
                <span>✨ Option B (AI Vibe)</span>
              </button>
            </div>

            <span className="hidden sm:inline text-[9px] text-slate-400 font-mono pr-1">
              {searchMode === 'option_a' ? 'Direct URL' : 'Discipline AI'}
            </span>
          </div>
        </form>
      </div>

      {/* ── Directory Tree Navigation Branches ─────────────────────────────── */}
      <div className="border-b border-slate-200 bg-slate-50/40 px-4 py-2">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs scrollbar-thin">
          <button
            type="button"
            onClick={() => handleSelectBranch('all')}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold transition ${
              activeBranch === 'all'
                ? 'bg-[#0F0C59] text-white shadow-xs'
                : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
            }`}
          >
            <span>🌟</span>
            <span>All</span>
            <span className={`ml-0.5 rounded-full px-1.5 py-0.2 text-[9px] ${activeBranch === 'all' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>
              {getBranchItemCount('all')}
            </span>
          </button>

          {DIRECTORY_BRANCHES.map((b) => {
            const count = getBranchItemCount(b.id)
            const isActive = activeBranch === b.id
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => handleSelectBranch(b.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold transition ${
                  isActive
                    ? 'bg-[#0F0C59] text-white shadow-xs'
                    : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
                }`}
              >
                <span>{b.icon}</span>
                <span>{b.label}</span>
                <span
                  className={`ml-0.5 rounded-full px-1.5 py-0.2 text-[9px] ${
                    isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        {/* ── Sub-Branches (Leaves of the Active Tree Node) ────────────────── */}
        {currentBranchInfo && (
          <div className="mt-2 flex items-center gap-1.5 overflow-x-auto border-t border-slate-200 pt-1.5 pb-0.5 text-[10px]">
            <span className="font-mono uppercase tracking-wider text-slate-400 text-[9px]">NODES:</span>
            <button
              type="button"
              onClick={() => setActiveSubBranch('all')}
              className={`shrink-0 rounded-md px-2 py-0.5 font-semibold transition ${
                activeSubBranch === 'all'
                  ? 'bg-slate-200 text-slate-900'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              All {currentBranchInfo.label}
            </button>
            {currentBranchInfo.subBranches.map((sub) => (
              <button
                key={sub}
                type="button"
                onClick={() => setActiveSubBranch(sub)}
                className={`shrink-0 rounded-md px-2 py-0.5 font-semibold transition ${
                  activeSubBranch === sub
                    ? 'bg-[#D95D24] text-white'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {sub}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Active Header & Facet / Mood Tag Filter ─────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-slate-200 bg-slate-50/25 px-4 py-1.5 text-xs">
        <div className="flex items-center gap-1.5">
          {vibeSearchResults ? (
            <span className="font-bold text-slate-900 text-[11px]">
              Vibe Results ({vibeSearchResults.results.length})
            </span>
          ) : currentBranchInfo ? (
            <span className="text-slate-700 text-[11px]">
              <span className="font-bold text-slate-900">
                {currentBranchInfo.icon} {currentBranchInfo.label}
              </span>
              {activeSubBranch !== 'all' && (
                <span className="text-slate-500"> › <span className="text-[#D95D24]">{activeSubBranch}</span></span>
              )}
            </span>
          ) : (
            <span className="font-bold text-slate-900 text-[11px]">Directory Index</span>
          )}
          {!vibeSearchResults && (
            <span className="text-[10px] font-mono text-slate-400">({items.length})</span>
          )}
        </div>

        {/* Mood Tags Filter */}
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none py-0.5">
          {TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setActiveTag((prev) => (prev === tag ? null : tag))}
              className={`rounded-md px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase transition ${
                activeTag === tag
                  ? 'bg-[#D95D24] text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* ── Main Scrollable Content Area ─────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4 scrollbar-thin space-y-3">
        {/* ── Search Mode Active: Vibe Results Display ──────────────────────── */}
        {vibeSearchResults ? (
          <div className="space-y-3">
            {/* Vibe Overview Summary Banner */}
            <div className="rounded-xl border border-white/15 bg-[#151178]/50 p-3.5 backdrop-blur-md">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-[#D95D24] px-2 py-0.5 text-[9px] font-mono font-bold text-white uppercase tracking-wider">
                      {vibeSearchResults.mode === 'option_b' ? '✨ Option B' : '⚡ Option A'}
                    </span>
                    <h3 className="text-xs font-bold text-[#FCECD5]">
                      &ldquo;{vibeSearchResults.query}&rdquo;
                    </h3>
                  </div>
                  <p className="mt-1 text-[11px] text-[#FCECD5]/70">
                    Direct search launchers ready to drop to board or open in tabs.
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      addVibeResultToBoard({
                        title: vibeSearchResults.query,
                        palette: vibeSearchResults.vibe_palette,
                        extracted_tags: vibeSearchResults.extracted_tags,
                      })
                    }
                    className="flex h-6 items-center gap-1 rounded-full bg-[#FCECD5] px-2.5 text-[10px] font-bold text-[#0F0C59] shadow-sm transition hover:bg-white"
                  >
                    <span>+</span> Add to Board
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      applyVibePaletteAndTags(vibeSearchResults.vibe_palette, vibeSearchResults.extracted_tags)
                    }
                    className="flex h-6 items-center rounded-full border border-white/15 bg-white/5 px-2 text-[10px] font-semibold text-[#FCECD5] transition hover:bg-white/15"
                  >
                    Apply Vibe
                  </button>
                </div>
              </div>

              {/* Derived Vibe Palette & Tags */}
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-2">
                {vibeSearchResults.vibe_palette.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-mono uppercase tracking-wider text-[#FCECD5]/50">
                      PALETTE:
                    </span>
                    <div className="flex h-4 overflow-hidden rounded border border-white/10">
                      {vibeSearchResults.vibe_palette.map((hex, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => handleCopyHex(hex)}
                          className="w-4 h-full transition hover:opacity-80"
                          style={{ backgroundColor: hex }}
                          title={`Click to copy hex ${hex}`}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {vibeSearchResults.extracted_tags.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap">
                    {vibeSearchResults.extracted_tags.map((t) => (
                      <span
                        key={t}
                        className="rounded border border-white/10 bg-white/5 px-1.5 py-0.2 text-[8px] font-mono font-bold uppercase text-[#D95D24]"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Matching Platforms Launcher Cards */}
            <div className="grid gap-2.5">
              {vibeSearchResults.results.map((res) => (
                <article
                  key={res.id}
                  className="group relative flex flex-col rounded-xl border border-slate-200 bg-white p-3 transition duration-200 hover:border-blue-400 hover:shadow-md shadow-2xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="rounded bg-slate-100 border border-slate-200 px-1.5 py-0.5 text-[9px] font-semibold text-slate-700">
                          <BranchIcon branchId={res.branch} /> {res.sub_branch || res.branch}
                        </span>
                        <h4 className="text-xs font-bold text-slate-900 transition group-hover:text-[#0F0C59]">
                          {res.title}
                        </h4>
                      </div>
                      <p className="mt-1 line-clamp-1 text-[11px] text-slate-600">{res.description}</p>
                    </div>

                    <a
                      href={res.direct_search_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-6 shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 text-[10px] font-semibold text-slate-700 transition hover:bg-slate-100"
                    >
                      <span>↗ Search</span>
                    </a>
                  </div>

                  {/* Tactile Bottom Pill Badges */}
                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-1.5 border-t border-slate-200 pt-2 text-[10px]">
                    <div className="flex items-center gap-1 text-slate-500">
                      <span className="font-mono text-[9px] uppercase">QUERY:</span>
                      <code className="rounded bg-slate-100 border border-slate-200 px-1 py-0.2 text-[10px] text-slate-800">
                        &ldquo;{res.display_query}&rdquo;
                      </code>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          addVibeResultToBoard({
                            title: `${res.title} (${res.display_query})`,
                            media_url: res.media_url,
                            palette: res.palette,
                            extracted_tags: res.extracted_tags,
                          })
                        }
                        className="flex h-6 items-center gap-1 rounded-full bg-[#0F0C59] px-2.5 text-[10px] font-bold text-white transition hover:bg-blue-900 shadow-xs"
                      >
                        <span>+</span> Drop to Board
                      </button>
                      {res.palette.length > 0 && (
                        <button
                          type="button"
                          onClick={() => applyVibePaletteAndTags(res.palette, res.extracted_tags)}
                          className="flex h-6 items-center rounded-full border border-slate-200 bg-slate-50 px-2 text-[10px] font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          Apply
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : loading ? (
          /* ── Loading State ─────────────────────────────────────────────────── */
          <div className="flex h-40 items-center justify-center text-xs text-slate-500 font-mono">
            <span className="h-2 w-2 rounded-full bg-[#D95D24] animate-ping mr-2" />
            <span>Indexing telemetry catalog…</span>
          </div>
        ) : items.length === 0 ? (
          /* ── Empty State ───────────────────────────────────────────────────── */
          <div className="flex h-40 flex-col items-center justify-center text-center text-xs text-slate-500">
            <p className="font-semibold text-slate-800">No resources found in this node.</p>
            <p className="mt-1 text-[11px]">Select another branch or clear tag filters.</p>
            <button
              type="button"
              onClick={() => {
                setActiveBranch('all')
                setActiveSubBranch('all')
                setActiveTag(null)
              }}
              className="mt-3 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-700 hover:bg-slate-100"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          /* ── Standard Directory Resource Cards (Browse Tree) ──────────────── */
          <div className="grid gap-3">
            {items.map((item) => (
              <article
                key={item.id}
                className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-3.5 transition-all duration-200 hover:border-blue-400 hover:shadow-md shadow-2xs"
              >
                {/* Header: Badges & Features */}
                <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-md bg-slate-100 border border-slate-200 px-2 py-0.5 text-[9px] font-bold text-slate-700 uppercase font-mono">
                      <BranchIcon branchId={item.branch} /> {item.sub_branch || item.category}
                    </span>
                    {item.features?.map((f) => (
                      <span
                        key={f}
                        className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.2 text-[9px] font-mono text-slate-500"
                      >
                        {f}
                      </span>
                    ))}
                  </div>

                  {item.source_name && (
                    <span className="text-[10px] font-mono text-slate-400 uppercase">{item.source_name}</span>
                  )}
                </div>

                {/* Main Body: Specimen + Description */}
                <div className="flex gap-3">
                  {item.media_url && (
                    <div className="relative h-20 w-24 shrink-0 overflow-hidden rounded-xl bg-slate-100 border border-slate-200">
                      <img
                        src={item.media_url}
                        alt={item.title}
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                        loading="lazy"
                      />
                    </div>
                  )}

                  <div className="flex flex-1 flex-col justify-between min-w-0">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h3 className="text-xs font-bold text-slate-900 transition group-hover:text-[#0F0C59] truncate">
                          {item.title}
                        </h3>
                        {item.source_url && (
                          <a
                            href={item.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-slate-400 hover:text-slate-700"
                            title="Visit website"
                          >
                            ↗
                          </a>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-600">
                        {item.description}
                      </p>
                    </div>

                    {/* Mood Tags */}
                    {item.extracted_tags.length > 0 && (
                      <div className="mt-2 flex items-center gap-1 flex-wrap">
                        {item.extracted_tags.map((t) => (
                          <span
                            key={t}
                            className="rounded bg-slate-100 border border-slate-200 px-1.5 py-0.2 text-[8px] font-mono font-bold uppercase text-[#D95D24]"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Interactive Palette Swatches */}
                {item.palette.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-1.5">
                    <div className="flex flex-wrap items-center gap-1">
                      {item.palette.map((hex, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => handleCopyHex(hex)}
                          className="h-4 w-4 rounded-full border border-black/10 transition hover:scale-125"
                          style={{ backgroundColor: hex }}
                          title={`Click to copy ${hex}`}
                        />
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopyAllHex(item.palette)}
                      className="text-[9px] font-mono text-slate-500 hover:text-slate-900 underline underline-offset-2"
                    >
                      Copy Palette
                    </button>
                  </div>
                )}

                {/* Bottom Action Toolbar: Tactile Pill Badges ● Source and + Drop to Board */}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-1.5 border-t border-slate-200 pt-2.5">
                  <div className="flex items-center gap-1.5">
                    {item.source_url ? (
                      <a
                        href={item.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex h-6 items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 text-[10px] font-semibold text-slate-700 transition hover:bg-slate-100 hover:text-slate-900"
                        title="Visit source website"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-[#D95D24]" />
                        <span>Source ↗</span>
                      </a>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => handleCopyLink(item)}
                      className="flex h-6 items-center rounded-full border border-slate-200 bg-slate-50 px-2 text-[9px] text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                    >
                      {copiedId === item.id ? '✓' : 'Link'}
                    </button>
                  </div>

                  <div className="flex items-center gap-1">
                    {item.item_kind === 'board_template' ? (
                      <button
                        type="button"
                        onClick={() => void loadTemplate(item)}
                        disabled={loadingTemplate === item.id}
                        className="flex h-6 items-center rounded-full bg-[#D95D24] px-3 text-[10px] font-bold text-white transition hover:bg-[#E06328]"
                      >
                        {loadingTemplate === item.id ? 'Loading…' : 'Load Template'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void addExploreItemToBoard(item)}
                        className="flex h-6 items-center gap-1 rounded-full bg-[#0F0C59] px-3 text-[10px] font-bold text-white transition hover:bg-blue-900 shadow-xs"
                        title="Drop reference onto board"
                      >
                        <span>+</span> Drop to Board
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )

  if (docked) {
    return <div className="relative flex h-full w-full flex-col overflow-hidden">{panelContent}</div>
  }

  return (
    <aside
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[640px] flex-col border-l border-white/15 bg-[#0D0948]/95 text-neutral-100 shadow-2xl backdrop-blur-2xl transition-transform"
      aria-label="Creative Resource Directory"
    >
      {panelContent}
    </aside>
  )
}
