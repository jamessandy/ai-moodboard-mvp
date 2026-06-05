'use client'

import dynamic from 'next/dynamic'

const BoardClient = dynamic(() => import('@/components/BoardClient').then((module) => module.BoardClient), {
  ssr: false,
  loading: () => <main className="h-screen bg-[#f4f1ea]" />,
})

export default function Home() {
  return <BoardClient />
}
