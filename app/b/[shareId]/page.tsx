import { notFound } from 'next/navigation'
import { ReadOnlyBoard } from '@/components/ReadOnlyBoard'
import { createServiceSupabaseClient } from '@/lib/supabase/server'
import { StoredBoard } from '@/lib/boards'

export default async function SharedBoardPage({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params
  const supabase = createServiceSupabaseClient()
  const { data } = await supabase
    .from('boards')
    .select('id, title, brief, document, share_id, created_at, updated_at')
    .eq('share_id', shareId)
    .maybeSingle<StoredBoard>()

  if (!data) notFound()

  return (
    <main className="flex h-screen min-h-[640px] flex-col bg-[#f4f1ea] text-neutral-950">
      <header className="border-b border-neutral-950/10 bg-[#fbfaf6] px-4 py-3">
        <h1 className="m-0 text-base font-semibold">{data.title}</h1>
        {data.brief ? <p className="m-0 mt-1 text-sm text-neutral-600">{data.brief}</p> : null}
      </header>
      <section className="min-h-0 flex-1">
        <ReadOnlyBoard snapshot={data.document} />
      </section>
    </main>
  )
}
