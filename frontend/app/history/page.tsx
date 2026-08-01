import Link from 'next/link'
import { ChevronRight, History, LogIn, Trophy } from 'lucide-react'

import { SiteHeader } from '@/components/site-header'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const PLACE_LABEL = ['1st', '2nd', '3rd']
function ordinal(place: number | null): string {
  if (!place) return '—'
  return PLACE_LABEL[place - 1] ?? `${place}th`
}

type GameRow = {
  id: string
  room_name: string | null
  finished_at: string | null
  position: number | null
  total_players: number | null
  participants: { name: string; place: number }[] | null
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return ''
  }
}

export default async function HistoryPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return (
      <main className="min-h-dvh">
        <SiteHeader />
        <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-5 py-24 text-center">
          <History className="size-10 text-muted-foreground" aria-hidden />
          <h1 className="font-serif text-2xl font-bold text-foreground">
            Your game history
          </h1>
          <p className="text-pretty text-muted-foreground">
            Sign in to keep a record of every tournament you play — final
            standings, the last hand, and who was at the table.
          </p>
          <Button render={<Link href="/profile" />}>
            <LogIn className="size-4" />
            Sign in
          </Button>
        </div>
      </main>
    )
  }

  const { data } = await supabase
    .from('games')
    .select(
      'id, room_name, finished_at, position, total_players, participants',
    )
    .order('created_at', { ascending: false })

  const games = (data ?? []) as GameRow[]

  return (
    <main className="min-h-dvh">
      <SiteHeader />
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-5 py-10">
        <header className="flex flex-col gap-1">
          <h1 className="font-serif text-3xl font-bold text-foreground">
            Game history
          </h1>
          <p className="text-muted-foreground">
            {games.length
              ? `${games.length} ${games.length === 1 ? 'game' : 'games'} played`
              : 'No games yet — your finished tournaments will show up here.'}
          </p>
        </header>

        {games.length > 0 && (
          <ul className="flex flex-col gap-3">
            {games.map((g) => {
              const isWin = g.position === 1
              return (
                <li key={g.id}>
                  <Link
                    href={`/history/${g.id}`}
                    className="flex items-center gap-4 rounded-xl border border-border/60 bg-card/70 p-4 transition-colors hover:border-primary/40 hover:bg-card"
                  >
                    <span
                      className={
                        isWin
                          ? 'flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary'
                          : 'flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground'
                      }
                    >
                      {isWin ? (
                        <Trophy className="size-5" aria-hidden />
                      ) : (
                        <span className="font-mono text-sm font-bold">
                          {ordinal(g.position)}
                        </span>
                      )}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-semibold text-card-foreground">
                        {g.room_name || 'Poker game'}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {ordinal(g.position)}
                        {g.total_players ? ` of ${g.total_players}` : ''}
                        {g.finished_at ? ` · ${formatDate(g.finished_at)}` : ''}
                      </span>
                    </span>
                    <ChevronRight
                      className="size-5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </main>
  )
}
