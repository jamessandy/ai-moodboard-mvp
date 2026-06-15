export const APP_NAME = 'Moodblendy'
export const APP_DOMAIN = 'moodblendy.com'
export const DEFAULT_APP_URL = `https://${APP_DOMAIN}`
export const APP_URL = getPublicAppUrl()

export function normalizeAppUrl(value?: string | null) {
  const trimmed = value?.trim()
  if (!trimmed) return null

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`

  try {
    return new URL(withProtocol).origin
  } catch {
    return null
  }
}

export function getPublicAppUrl(fallback?: string | null) {
  return normalizeAppUrl(process.env.NEXT_PUBLIC_APP_URL) ?? normalizeAppUrl(fallback) ?? DEFAULT_APP_URL
}

export function getBrowserAppUrl() {
  return getPublicAppUrl(typeof window !== 'undefined' ? window.location.origin : undefined)
}
