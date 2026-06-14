'use client'

type AnalyticsProperties = Record<string, string | number | boolean | null | undefined>

const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com'
const ANONYMOUS_ID_KEY = 'moodboard-anonymous-id'

function getAnonymousId() {
  const existing = window.localStorage.getItem(ANONYMOUS_ID_KEY)
  if (existing) return existing

  const next = crypto.randomUUID()
  window.localStorage.setItem(ANONYMOUS_ID_KEY, next)
  return next
}

export function captureClientEvent(
  event: string,
  properties: AnalyticsProperties = {},
  distinctId?: string | null
) {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY
  if (!apiKey || typeof window === 'undefined') return

  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || DEFAULT_POSTHOG_HOST
  const body = JSON.stringify({
    api_key: apiKey,
    event,
    distinct_id: distinctId || getAnonymousId(),
    properties: {
      app: 'ai-moodboard',
      ...properties,
    },
  })

  const url = `${host.replace(/\/$/, '')}/capture/`

  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: 'application/json' })
    if (navigator.sendBeacon(url, blob)) return
  }

  void fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => null)
}
