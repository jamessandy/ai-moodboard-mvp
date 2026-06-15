import type { Metadata } from 'next'
import { APP_NAME, APP_URL } from '@/lib/site'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: APP_NAME,
  description: 'References in, generated ideas out.',
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: APP_NAME,
    description: 'References in, generated ideas out.',
    siteName: APP_NAME,
    url: APP_URL,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: APP_NAME,
    description: 'References in, generated ideas out.',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  )
}
