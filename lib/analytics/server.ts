type AnalyticsProperties = Record<string, string | number | boolean | null | undefined>

const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com'
const ANALYTICS_TIMEOUT_MS = 1_500

export async function captureServerEvent(
  event: string,
  distinctId: string,
  properties: AnalyticsProperties = {}
) {
  const apiKey = process.env.POSTHOG_SERVER_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY
  if (!apiKey) return

  const host = process.env.POSTHOG_HOST || process.env.NEXT_PUBLIC_POSTHOG_HOST || DEFAULT_POSTHOG_HOST
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ANALYTICS_TIMEOUT_MS)

  try {
    await fetch(`${host.replace(/\/$/, '')}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        event,
        distinct_id: distinctId,
        properties: {
          app: 'ai-moodboard',
          source: 'server',
          ...properties,
        },
      }),
      signal: controller.signal,
    })
  } catch {
    // Analytics must never block the generation path.
  } finally {
    clearTimeout(timeout)
  }
}
