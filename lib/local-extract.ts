'use client'

export async function extractSubjectClient(imageSrc: string): Promise<string> {
  const response = await fetch('/api/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceUrl: imageSrc }),
  })
  const result = (await response.json().catch(() => null)) as { url?: string; error?: string } | null
  if (!response.ok || !result?.url) {
    throw new Error(result?.error ?? 'Local background removal failed.')
  }
  return result.url
}
