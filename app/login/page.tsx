import { Suspense } from 'react'
import type { Metadata } from 'next'
import { AuthCard } from '@/components/AuthCard'

export const metadata: Metadata = {
  title: 'Log in | Moodblendy',
  description: 'Sign in to create, save, generate, and share boards on Moodblendy.',
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen w-full items-center justify-center bg-[#f4f1ea] px-4 text-neutral-900">
          <div className="text-sm font-semibold text-neutral-500">Loading…</div>
        </main>
      }
    >
      <AuthCard initialMode="login" />
    </Suspense>
  )
}
