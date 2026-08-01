'use client'

import { TrendingUp } from 'lucide-react'

import { cn } from '@/lib/utils'
import { formatClock, useSecondsLeft } from '@/lib/use-countdown'
import type { GameView } from '@/lib/poker-api'

/**
 * The tournament clock: what the blinds are now, and how long that lasts.
 *
 * The countdown runs off the server's own deadline, so every phone at the table
 * shows the same number even if their clocks disagree.
 */
export function BlindClock({ view }: { view: GameView }) {
  const level = view.level
  const secondsLeft = useSecondsLeft(view.levelEndsAtMs)

  if (!level) {
    return (
      <span className="font-mono text-xs text-muted-foreground">
        Blinds {view.smallBlind}/{view.bigBlind}
      </span>
    )
  }

  const frozen = view.levelMinutes === 0
  const urgent = secondsLeft != null && secondsLeft <= 60
  const critical = secondsLeft != null && secondsLeft <= 10
  const progress =
    secondsLeft != null && level.durationSec > 0
      ? Math.min(1, Math.max(0, secondsLeft / level.durationSec))
      : 0

  return (
    <div className="relative flex min-h-11 w-full items-center justify-between gap-3 overflow-hidden rounded-xl border border-border/60 bg-background/35 px-3 py-1.5 sm:w-auto sm:justify-start">
      <div className="flex flex-col leading-none">
        <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
          {frozen ? 'Blinds' : `Level ${level.number}`}
        </span>
        <span className="mt-1 font-mono text-sm font-bold tabular-nums text-primary">
          {level.smallBlind.toLocaleString()}/{level.bigBlind.toLocaleString()}
        </span>
      </div>

      {!frozen && (
        <>
          <div className="h-7 w-px bg-border" aria-hidden />
          {level.pending ? (
            // The clock ran out mid-hand: the new level starts on the next deal.
            <div className="flex flex-col items-end leading-none">
              <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-primary">
                <TrendingUp className="size-3" />
                Up next hand
              </span>
              <span className="mt-1 font-mono text-sm font-bold tabular-nums text-primary">
                {level.pending.smallBlind.toLocaleString()}/
                {level.pending.bigBlind.toLocaleString()}
              </span>
            </div>
          ) : level.isLast ? (
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Final level
            </span>
          ) : secondsLeft == null ? (
            // Before the first deal there is nothing to count down yet.
            <div className="flex flex-col items-end leading-none">
              <span className="font-mono text-sm font-bold tabular-nums text-foreground">
                {view.levelMinutes} min
              </span>
              <span className="mt-1 text-[9px] uppercase tracking-widest text-muted-foreground">
                per level
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-end leading-none">
              <span
                className={cn(
                  'font-mono text-sm font-bold tabular-nums',
                  critical
                    ? 'text-destructive'
                    : urgent
                      ? 'text-primary'
                      : 'text-foreground',
                )}
              >
                {formatClock(secondsLeft)}
              </span>
              <span className="mt-1 text-[9px] uppercase tracking-widest text-muted-foreground">
                {level.next
                  ? `then ${level.next.smallBlind}/${level.next.bigBlind}`
                  : 'final level'}
              </span>
            </div>
          )}
        </>
      )}

      {/* Hairline that drains across the level. */}
      {!frozen && secondsLeft != null && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px origin-left bg-primary/70 transition-transform duration-200 ease-linear"
          style={{ transform: `scaleX(${progress})` }}
          aria-hidden
        />
      )}
    </div>
  )
}
