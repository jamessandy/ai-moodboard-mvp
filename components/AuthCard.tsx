'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createBrowserSupabaseClient } from '@/lib/supabase/client'
import { APP_NAME } from '@/lib/site'
import { captureClientEvent } from '@/lib/analytics/client'

type AuthMode = 'login' | 'signup'

interface AuthCardProps {
  initialMode?: AuthMode
}

export function AuthCard({ initialMode = 'login' }: AuthCardProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectPath = searchParams.get('redirect') || searchParams.get('next') || '/'

  const [mode, setMode] = useState<AuthMode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [checkingSession, setCheckingSession] = useState(true)

  const supabase = createBrowserSupabaseClient()

  const navigateToDestination = useCallback(() => {
    // Force a fresh navigation so the destination picks up the new Supabase session
    window.location.href = redirectPath
  }, [redirectPath])

  useEffect(() => {
    // If the user already has an active session, send them straight to the app
    let mounted = true
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!mounted) return
      if (!sessionError && data?.session) {
        navigateToDestination()
      } else {
        setCheckingSession(false)
      }
    })

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return
      if (session && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
        navigateToDestination()
      }
    })

    return () => {
      mounted = false
      authListener?.subscription.unsubscribe()
    }
  }, [navigateToDestination, supabase])

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode)
    setError(null)
    setMessage(null)
    const targetUrl = nextMode === 'signup' ? '/signup' : '/login'
    const query = searchParams.toString()
    const fullUrl = query ? `${targetUrl}?${query}` : targetUrl
    window.history.replaceState(null, '', fullUrl)
  }

  const handlePasswordAuth = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmedEmail = email.trim()

    if (!trimmedEmail || !password) {
      setError('Enter your email and password.')
      return
    }

    if (mode === 'signup' && password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setError(null)
    setMessage(null)
    setSubmitting(true)

    try {
      if (mode === 'signup') {
        const origin = typeof window !== 'undefined' ? window.location.origin : ''
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
          options: {
            emailRedirectTo: `${origin}${redirectPath}`,
          },
        })

        if (signUpError) throw signUpError

        captureClientEvent('signup', { method: 'password' }, data.user?.id)

        if (data.session) {
          setMessage('Account created! Redirecting…')
          navigateToDestination()
        } else {
          setMessage('Check your email to confirm your account, then log in.')
        }
        return
      }

      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      })

      if (signInError) throw signInError

      captureClientEvent('login', { method: 'password' }, signInData.user?.id)
      setMessage('Authenticated! Redirecting…')
      navigateToDestination()
    } catch (caught) {
      const errMessage = caught instanceof Error ? caught.message : 'Authentication failed.'
      setError(errMessage)
    } finally {
      setSubmitting(false)
    }
  }

  const continueWithGoogle = async () => {
    setError(null)
    setMessage(null)
    setSubmitting(true)

    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : ''
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${origin}${redirectPath}`,
        },
      })

      if (oauthError) throw oauthError
    } catch (caught) {
      const errMessage = caught instanceof Error ? caught.message : 'Google sign-in failed.'
      setError(errMessage)
      setSubmitting(false)
    }
  }

  const sendMagicLink = async () => {
    const trimmed = email.trim()
    if (!trimmed) {
      setError('Enter an email address for the magic link.')
      return
    }

    setError(null)
    setMessage(null)
    setSubmitting(true)

    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : ''
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: {
          emailRedirectTo: `${origin}${redirectPath}`,
        },
      })

      if (otpError) throw otpError
      setMessage('Magic link sent! Check your inbox.')
    } catch (caught) {
      const errMessage = caught instanceof Error ? caught.message : 'Could not send magic link.'
      setError(errMessage)
    } finally {
      setSubmitting(false)
    }
  }

  const continueAsGuest = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('moodboard-guest-mode', 'true')
    }
    navigateToDestination()
  }

  if (checkingSession) {
    return (
      <main className="flex min-h-screen w-full items-center justify-center bg-[#f4f1ea] px-4 text-neutral-900">
        <div className="text-sm font-semibold text-neutral-500">Checking credentials…</div>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-[#f4f1ea] px-4 py-12 text-neutral-950">
      <section className="w-full max-w-md rounded-lg border border-neutral-950/10 bg-[#fbfaf6] p-6 sm:p-7 shadow-sm">
        <div className="mb-5">
          <h1 className="m-0 text-2xl font-serif font-bold tracking-normal text-neutral-950">{APP_NAME}</h1>
          <p className="m-0 mt-1 text-sm text-neutral-600">Sign in to create, save, generate, and share boards.</p>
        </div>

        {/* Tab switcher: Log in vs Sign up */}
        <div className="mb-4 grid grid-cols-2 rounded border border-neutral-300 bg-white p-1">
          <button
            type="button"
            className={`h-9 rounded text-sm font-semibold transition ${
              mode === 'login' ? 'bg-neutral-950 text-white shadow-sm' : 'text-neutral-700 hover:text-neutral-950'
            }`}
            onClick={() => switchMode('login')}
          >
            Log in
          </button>
          <button
            type="button"
            className={`h-9 rounded text-sm font-semibold transition ${
              mode === 'signup' ? 'bg-neutral-950 text-white shadow-sm' : 'text-neutral-700 hover:text-neutral-950'
            }`}
            onClick={() => switchMode('signup')}
          >
            Sign up
          </button>
        </div>

        {/* Email & Password Form */}
        <form className="grid gap-3" onSubmit={handlePasswordAuth}>
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            autoComplete="email"
            placeholder="Email"
            required
            className="h-11 rounded border border-neutral-300 bg-white px-3 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-neutral-950 focus:ring-1 focus:ring-neutral-950"
          />
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            placeholder="Password"
            required
            className="h-11 rounded border border-neutral-300 bg-white px-3 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-neutral-950 focus:ring-1 focus:ring-neutral-950"
          />
          {mode === 'signup' ? (
            <input
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              type="password"
              autoComplete="new-password"
              placeholder="Confirm password"
              required
              className="h-11 rounded border border-neutral-300 bg-white px-3 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-neutral-950 focus:ring-1 focus:ring-neutral-950"
            />
          ) : null}
          <button
            type="submit"
            disabled={submitting}
            className="h-11 rounded bg-neutral-950 px-4 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 shadow-sm"
          >
            {submitting ? 'Working…' : mode === 'signup' ? 'Sign up' : 'Log in'}
          </button>
        </form>

        {/* Divider */}
        <div className="my-4 flex items-center gap-3 text-xs uppercase text-neutral-400">
          <span className="h-px flex-1 bg-neutral-300" />
          OR
          <span className="h-px flex-1 bg-neutral-300" />
        </div>

        {/* OAuth & Magic Link */}
        <div className="grid gap-2">
          <button
            type="button"
            className="h-11 rounded border border-neutral-300 bg-white px-4 text-sm font-semibold text-neutral-800 transition hover:bg-neutral-50 hover:border-neutral-400 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void continueWithGoogle()}
            disabled={submitting}
          >
            Continue with Google
          </button>
          <button
            type="button"
            className="h-11 rounded border border-neutral-300 bg-white px-4 text-sm font-semibold text-neutral-800 transition hover:bg-neutral-50 hover:border-neutral-400 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void sendMagicLink()}
            disabled={submitting}
          >
            Email magic link
          </button>
        </div>

        {/* Feedback messages */}
        {message ? (
          <p className="m-0 mt-3 text-center text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded p-2.5">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="m-0 mt-3 text-center text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded p-2.5">
            {error}
          </p>
        ) : null}

        <p className="m-0 mt-4 text-xs leading-relaxed text-neutral-500">
          Signup may require email confirmation depending on your Supabase Auth setting.
        </p>

        {/* Guest fallback link */}
        <div className="mt-4 pt-3 border-t border-neutral-200/70 text-center">
          <button
            type="button"
            onClick={continueAsGuest}
            className="text-xs font-medium text-neutral-500 hover:text-neutral-900 transition underline underline-offset-2"
          >
            Or continue as guest (explore & compose) →
          </button>
        </div>
      </section>
    </main>
  )
}

