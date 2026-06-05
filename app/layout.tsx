import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'AI Moodboard MVP',
  description: 'References in, generated ideas out.',
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
