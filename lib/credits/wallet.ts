import { createServiceSupabaseClient } from '@/lib/supabase/server'

type Client = ReturnType<typeof createServiceSupabaseClient>
type WalletInput = { supabase: Client; userId: string; amount: number; actionId: string; actionType: string; metadata?: Record<string, unknown> }

export async function reserveCredits(input: WalletInput) {
  const { data, error } = await input.supabase.rpc('reserve_profile_credits', {
    p_user_id: input.userId, p_amount: input.amount, p_action_id: input.actionId,
    p_action_type: input.actionType, p_metadata: input.metadata ?? {},
  })
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : data) as { reserved?: boolean; credits_balance?: number } | null
  return { reserved: Boolean(row?.reserved), creditsBalance: Number(row?.credits_balance ?? 0) }
}

export async function refundCredits(input: WalletInput) {
  if (input.amount <= 0) return null
  const { data, error } = await input.supabase.rpc('refund_profile_credits', {
    p_user_id: input.userId, p_amount: input.amount, p_action_id: input.actionId,
    p_action_type: input.actionType, p_metadata: input.metadata ?? {},
  })
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : data) as { credits_balance?: number } | null
  return { creditsBalance: Number(row?.credits_balance ?? 0) }
}
