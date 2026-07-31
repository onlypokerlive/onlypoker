'use client'

import { Trophy } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { GameView } from '@/lib/poker-api'

const PLACE_LABEL = ['1st', '2nd', '3rd']

function ordinal(place: number): string {
  return PLACE_LABEL[place - 1] ?? `${place}th`
}

/** Final table: who took the chips, and in what order everyone went out. */
export function TournamentResults({ view }: { view: GameView }) {
  if (!view.standings.length) return null
  const [winner, ...rest] = view.standings

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 rounded-2xl border border-primary/30 bg-card/80 p-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <Trophy className="size-8 text-primary" aria-hidden />
        <h2 className="font-serif text-2xl font-bold text-card-foreground">
          {winner.name} takes it
        </h2>
        <p className="font-mono text-sm text-muted-foreground">
          {winner.chips.toLocaleString()} chips · {view.handNumber} hands
        </p>
      </div>

      <ol className="flex flex-col gap-1.5">
        {[winner, ...rest].map((s) => (
          <li
            key={s.playerId}
            className={cn(
              'flex items-center justify-between rounded-lg border px-3 py-2 text-sm',
              s.place === 1
                ? 'border-primary/40 bg-primary/10'
                : 'border-border/50 bg-background/40',
            )}
          >
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  'w-8 shrink-0 font-mono text-xs font-bold uppercase',
                  s.place === 1 ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                {ordinal(s.place)}
              </span>
              <span className="text-card-foreground">{s.name}</span>
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {s.chips.toLocaleString()}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
