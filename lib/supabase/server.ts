import { createClient } from '@supabase/supabase-js'

export const IMPORT_BUCKET = 'moodboard-imports'
export const OUTPUT_BUCKET = 'moodboard-outputs'
export const ELEMENT_BUCKET = 'moodboard-elements'

const knownMissingBucketStatuses = new Set(['400', '404'])

export function createServiceSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    const missing = [
      !url ? 'NEXT_PUBLIC_SUPABASE_URL' : null,
      !serviceRoleKey ? 'SUPABASE_SERVICE_ROLE_KEY' : null,
    ].filter(Boolean)

    throw new Error(`Missing required Supabase env: ${missing.join(', ')}.`)
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

export async function createServiceSupabaseClientWithBucket(bucket: string) {
  const supabase = createServiceSupabaseClient()
  const { error } = await supabase.storage.getBucket(bucket)

  if (!error) return supabase

  if (!knownMissingBucketStatuses.has(String(error.statusCode))) {
    throw error
  }

  const { error: createError } = await supabase.storage.createBucket(bucket, {
    public: true,
  })

  if (createError && !createError.message.toLowerCase().includes('already exists')) {
    throw createError
  }

  return supabase
}
