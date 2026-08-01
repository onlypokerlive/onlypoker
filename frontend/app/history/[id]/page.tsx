import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Trophy, Users } from 'lucide-react'

import { PlayingCard } from '@/components/playing-card'
import { SiteHeader } from '@/components/site-header'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const PLACE_LABEL = ['1st', '2nd', '3rd']
function ordinal(place: number | null): string {
  if (!place) return '—'
  return PLACE_LABEL[place - 1] ?? `${place}th`
}

type HandResult = {
  playerId: string
  name: string
  delta: number
  handName?: string
  handCards?: string[]
}

type LastHand = {
  board?: string[]
  boards?: string[][]
  boardResults?: { cards: string[]; winners: string[] }[]
  results?: HandResult[]
  wentToShowdown?: boolean
}

type Stakes = {
  smallBlind?: number
  bigBlind?: number
  ante?: number
  hands?: number
}

type GameRow = {
  id: string
  room_name: string | null
  finished_at: string | null
  position: number | null
  total_players: number | null
  stakes: Stakes | null
  last_hand: LastHand | null
  participants: { name: string; place: number }[] | null
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

export default async function HistoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return (
      <main className="min-h-dvh">
        <SiteHeader />
        <div className="mx-auto max-w-md px-5 py-24 text-center text-muted-foreground">
          <p>Sign in to view this game.</p>
          <Link href="/profile" className="mt-4 inline-block underline">
            Sign in
          </Link>
        </div>
      </main>
    )
  }

  const { data } = await supabase
    .from('games')
    .select(
      'id, room_name, finished_at, position, total_players, stakes, last_hand, participants',
    )
    .eq('id', id)
    .maybeSingle()

  if (!data) notFound()
  const game = data as GameRow

  const lastHand = game.last_hand
  // Prefer the multi-board record (run-it-twice); fall back to the single board.
  const boards =
    lastHand?.boards && lastHand.boards.length
      ? lastHand.boards
      : lastHand?.board && lastHand.board.length
        ? [lastHand.board]
        : []
  const results = lastHand?.results ?? []
  const winners = results.filter((r) => r.delta > 0)
  const stakes = game.stakes

  return (
    <main className="min-h-dvh">
      <SiteHeader />
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-5 py-8">
        <Link
          href="/history"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          All games
        </Link>

        {/* Summary */}
        <header className="flex items-center gap-4">
          <span
            className={
              game.position === 1
                ? 'flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary'
                : 'flex size-14 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground'
            }
          >
            {game.position === 1 ? (
              <Trophy className="size-6" aria-hidden />
            ) : (
              <span className="font-mono text-lg font-bold">
                {ordinal(game.position)}
              </span>
            )}
          </span>
          <div className="flex flex-col">
            <h1 className="font-serif text-2xl font-bold text-foreground">
              {game.room_name || 'Poker game'}
            </h1>
            <p className="text-sm text-muted-foreground">
              You finished {ordinal(game.position)}
              {game.total_players ? ` of ${game.total_players}` : ''}
              {game.finished_at ? ` · ${formatDate(game.finished_at)}` : ''}
            </p>
            {stakes?.bigBlind ? (
              <p className="font-mono text-xs text-muted-foreground">
                Blinds {stakes.smallBlind}/{stakes.bigBlind}
                {stakes.ante ? ` · ante ${stakes.ante}` : ''}
                {stakes.hands ? ` · ${stakes.hands} hands` : ''}
              </p>
            ) : null}
          </div>
        </header>

        {/* Last hand */}
        {boards.length > 0 && (
          <section className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card/70 p-5">
            <h2 className="font-serif text-lg font-semibold text-card-foreground">
              The last hand
            </h2>
            {boards.map((board, bi) => (
              <div key={bi} className="flex flex-col gap-1.5">
                {boards.length > 1 && (
                  <span className="text-xs font-medium text-muted-foreground">
                    Board {bi + 1}
                  </span>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {board.map((c, i) => (
                    <PlayingCard key={i} card={c} size="sm" />
                  ))}
                </div>
              </div>
            ))}

            {results.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1.5">
                {results.map((r) => {
                  const won = r.delta > 0
                  return (
                    <li
                      key={r.playerId}
                      className={cn(
                        'flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm',
                        won
                          ? 'border-primary/40 bg-primary/10'
                          : 'border-border/50 bg-background/40',
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span className="font-medium text-card-foreground">
                          {r.name}
                        </span>
                        {r.handName && (
                          <span className="text-xs text-muted-foreground">
                            {r.handName}
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-2">
                        {r.handCards && r.handCards.length > 0 && (
                          <span className="flex gap-1">
                            {r.handCards.slice(0, 2).map((c, i) => (
                              <PlayingCard key={i} card={c} size="xs" />
                            ))}
                          </span>
                        )}
                        <span
                          className={cn(
                            'font-mono text-xs',
                            won ? 'text-primary' : 'text-muted-foreground',
                          )}
                        >
                          {r.delta > 0 ? `+${r.delta.toLocaleString()}` : r.delta.toLocaleString()}
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
            {!lastHand?.wentToShowdown && winners.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Won without a showdown.
              </p>
            )}
          </section>
        )}

        {/* Participants */}
        {game.participants && game.participants.length > 0 && (
          <section className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card/70 p-5">
            <h2 className="flex items-center gap-2 font-serif text-lg font-semibold text-card-foreground">
              <Users className="size-4" aria-hidden />
              Who played
            </h2>
            <ol className="flex flex-col gap-1.5">
              {[...game.participants]
                .sort((a, b) => a.place - b.place)
                .map((p) => (
                  <li
                    key={`${p.place}-${p.name}`}
                    className="flex items-center gap-3 rounded-lg border border-border/50 bg-background/40 px-3 py-2 text-sm"
                  >
                    <span className="w-8 shrink-0 font-mono text-xs font-bold uppercase text-muted-foreground">
                      {ordinal(p.place)}
                    </span>
                    <span className="text-card-foreground">{p.name}</span>
                  </li>
                ))}
            </ol>
          </section>
        )}
      </div>
    </main>
  )
}
