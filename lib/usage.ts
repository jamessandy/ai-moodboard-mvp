import { createServiceSupabaseClient } from '@/lib/supabase/server'
import { FREE_IMAGE_LIMIT, IMAGES_PER_GENERATION } from '@/lib/usage-constants'

export { FREE_IMAGE_LIMIT, IMAGES_PER_GENERATION }

export type UsageQuota = {
  imagesUsed: number
  imageLimit: number
  imagesRemaining: number
}

type ServiceSupabaseClient = ReturnType<typeof createServiceSupabaseClient>

type ReserveProfileImagesResult = {
  images_used?: number
  limit_reached?: boolean
}

type RefundProfileImagesResult = {
  images_used?: number
}

function quotaFromUsed(imagesUsed: number): UsageQuota {
  const normalized = Math.max(0, Math.min(FREE_IMAGE_LIMIT, imagesUsed))
  return {
    imagesUsed: normalized,
    imageLimit: FREE_IMAGE_LIMIT,
    imagesRemaining: Math.max(0, FREE_IMAGE_LIMIT - normalized),
  }
}

export async function ensureProfile(supabase: ServiceSupabaseClient, userId: string) {
  const { error } = await supabase.from('profiles').upsert({ user_id: userId }, { onConflict: 'user_id' })
  if (error) throw error
}

export async function getUsageQuota(supabase: ServiceSupabaseClient, userId: string): Promise<UsageQuota> {
  await ensureProfile(supabase, userId)

  const { data, error } = await supabase
    .from('profiles')
    .select('images_used')
    .eq('user_id', userId)
    .single<{ images_used: number }>()

  if (error) throw error
  return quotaFromUsed(data.images_used)
}

export async function reserveImagesForGeneration(supabase: ServiceSupabaseClient, userId: string) {
  await ensureProfile(supabase, userId)

  const { data, error } = await supabase.rpc('reserve_profile_images', {
    p_user_id: userId,
    p_count: IMAGES_PER_GENERATION,
    p_limit: FREE_IMAGE_LIMIT,
  })

  if (error) throw error

  const row = (Array.isArray(data) ? data[0] : data) as ReserveProfileImagesResult | null
  const imagesUsed = row?.images_used ?? FREE_IMAGE_LIMIT
  const quota = quotaFromUsed(imagesUsed)

  return {
    reserved: !row?.limit_reached,
    quota,
  }
}

export async function refundReservedImages(supabase: ServiceSupabaseClient, userId: string, count: number) {
  const refundCount = Math.max(0, Math.floor(count))
  if (!refundCount) return getUsageQuota(supabase, userId)

  const { data, error } = await supabase.rpc('refund_profile_images', {
    p_user_id: userId,
    p_count: refundCount,
  })

  if (error) throw error

  const row = (Array.isArray(data) ? data[0] : data) as RefundProfileImagesResult | null
  return quotaFromUsed(row?.images_used ?? 0)
}
