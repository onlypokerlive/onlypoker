'use client'

import { RotateCcw, Trophy } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { GameView } from '@/lib/poker-api'

const PLACE_LABEL = ['1st', '2nd', '3rd']

function ordinal(place: number): string {
  return PLACE_LABEL[place - 1] ?? `${place}th`
}

/**
 * What to do now the night is over.
 *
 * Its own component, and deliberately not part of the podium above: the podium
 * is as long as the field and scrolls, and an action at the bottom of a
 * scrolling list is an action most people never find. This one sits below the
 * scroll, where the app puts every other thing you press.
 *
 * The end of a tournament is not the end of an evening — everybody is still in
 * the room and the chips are still on the table, so "again?" is the only thing
 * anybody actually says at that moment. It is the one button here because
 * leaving is what closing the tab already does.
 */
export function PlayAgain({
  onPlayAgain,
  busy = false,
}: {
  /** Host only. Absent for everybody else, who are told to expect it instead. */
  onPlayAgain?: () => void
  busy?: boolean
}) {
  // A table where nothing can happen and nothing says so is indistinguishable
  // from one that has broken.
  if (!onPlayAgain) {
    return (
      <p className="text-center text-xs text-muted-foreground">
        Stay where you are — the host can deal another.
      </p>
    )
  }
  return (
    <Button onClick={onPlayAgain} disabled={busy} className="w-full max-w-md">
      <RotateCcw data-icon="inline-start" />
      Play again
    </Button>
  )
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
