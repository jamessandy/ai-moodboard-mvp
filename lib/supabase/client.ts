import { createClient } from '@supabase/supabase-js'

let browserClient: ReturnType<typeof createClient> | null = null

export function createBrowserSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.')
  }

  if (!browserClient) {
    browserClient = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      global: {
        fetch: async (input, init) => {
          try {
            return await fetch(input, init)
          } catch {
            // When Supabase host is unreachable (e.g. invalid URL, offline, DNS NXDOMAIN),
            // return a 400 invalid_grant response instead of 5xx. Status 400 causes GoTrueClient
            // to discard the dead session cleanly without retrying or throwing AuthRetryableFetchError.
            return new Response(
              JSON.stringify({
                error: 'invalid_grant',
                error_description: 'Session unreachable or expired',
              }),
              {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
              }
            )
          }
        },
      },
    })
  }

  return browserClient
}
