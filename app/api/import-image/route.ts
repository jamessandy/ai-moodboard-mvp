import { NextRequest, NextResponse } from 'next/server'
import { IMPORT_BUCKET, createServiceSupabaseClientWithBucket } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const MAX_IMAGE_BYTES = 12 * 1024 * 1024

function extensionFromType(contentType: string | null) {
  if (!contentType) return 'bin'
  if (contentType.includes('png')) return 'png'
  if (contentType.includes('webp')) return 'webp'
  if (contentType.includes('gif')) return 'gif'
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg'
  return 'bin'
}

async function bytesFromUrl(url: string) {
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https image URLs are supported.')
  }

  const response = await fetch(parsed, {
    redirect: 'follow',
    headers: { accept: 'image/*' },
  })

  if (!response.ok) {
    throw new Error(`Could not fetch image URL (${response.status}).`)
  }

  const contentType = response.headers.get('content-type')
  if (!contentType?.startsWith('image/')) {
    throw new Error('The URL did not return an image.')
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  return { buffer, contentType }
}

async function bytesFromFile(file: File) {
  if (!file.type.startsWith('image/')) {
    throw new Error('Uploaded file must be an image.')
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  return { buffer, contentType: file.type }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const maybeFile = formData.get('file')
    const maybeUrl = formData.get('url')

    const source =
      maybeFile instanceof File
        ? await bytesFromFile(maybeFile)
        : typeof maybeUrl === 'string' && maybeUrl.trim()
          ? await bytesFromUrl(maybeUrl.trim())
          : null

    if (!source) {
      return NextResponse.json({ error: 'Provide either a file or image URL.' }, { status: 400 })
    }

    if (source.buffer.byteLength > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: 'Image is larger than 12MB.' }, { status: 413 })
    }

    const supabase = await createServiceSupabaseClientWithBucket(IMPORT_BUCKET)
    const path = `imports/${crypto.randomUUID()}.${extensionFromType(source.contentType)}`
    const { error } = await supabase.storage.from(IMPORT_BUCKET).upload(path, source.buffer, {
      contentType: source.contentType,
      upsert: false,
    })

    if (error) {
      throw error
    }

    const { data } = supabase.storage.from(IMPORT_BUCKET).getPublicUrl(path)
    return NextResponse.json({ url: data.publicUrl, path })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Image import failed.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
