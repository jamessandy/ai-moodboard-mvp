'use client'

import dynamic from 'next/dynamic'

const BoardClient = dynamic(() => import('@/components/BoardClient').then((module) => module.BoardClient), {
  ssr: false,
  loading: () => (
    <main className="flex h-screen w-screen items-center justify-center bg-[#0B0838] text-[#FCECD5]">
      <div className="flex items-center gap-3 rounded-full border border-white/10 bg-[#120E6A]/60 px-5 py-2.5 backdrop-blur-xl">
        <span className="inline-block h-2 w-2 rounded-full bg-[#D95D24] animate-ping" />
        <span className="font-mono text-xs uppercase tracking-widest text-[#FCECD5]/90">
          Initializing Bento Cockpit…
        </span>
      </div>
    </main>
  ),
})

export default function Home() {
  return <BoardClient />
}
