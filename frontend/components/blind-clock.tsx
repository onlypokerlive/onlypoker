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
    // `shrink-0`, and the two columns inside it too.
    //
    // It used to be allowed to shrink, and what happened on a 320px phone is
    // worth writing down: the right-hand column is `items-end`, so when the box
    // was squeezed its text overflowed *leftwards* and printed the coming
    // blinds straight over the current ones. Nothing was clipped and nothing
    // wrapped — two numbers simply occupied the same pixels, which is the one
    // failure mode that reads as a rendering bug rather than a tight fit. The
    // room's name truncates instead; a name is a thing you already know.
    <div className="relative flex shrink-0 items-center gap-2 overflow-hidden rounded-xl border border-border/60 bg-card/60 px-2 py-1">
      <div className="flex shrink-0 flex-col leading-none">
        <span className="whitespace-nowrap text-[8px] font-bold uppercase tracking-wider text-muted-foreground">
          {frozen ? 'Blinds' : `Level ${level.number}`}
        </span>
        <span className="mt-0.5 font-mono text-[13px] font-bold tabular-nums text-primary">
          {level.smallBlind.toLocaleString()}/{level.bigBlind.toLocaleString()}
        </span>
      </div>

      {!frozen && (
        <>
          <div className="h-6 w-px shrink-0 bg-border" aria-hidden />
          {level.pending ? (
            // The clock ran out mid-hand: the new level starts on the next deal.
            <div className="flex shrink-0 flex-col items-end leading-none">
              <span className="flex items-center gap-1 whitespace-nowrap text-[8px] font-bold uppercase tracking-wider text-primary">
                <TrendingUp className="size-3" />
                Next hand
              </span>
              <span className="mt-0.5 font-mono text-[13px] font-bold tabular-nums text-primary">
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
            <div className="flex shrink-0 flex-col items-end leading-none">
              <span className="font-mono text-sm font-bold tabular-nums text-foreground">
                {view.levelMinutes} min
              </span>
              <span className="mt-1 text-[9px] uppercase tracking-widest text-muted-foreground">
                per level
              </span>
            </div>
          ) : (
            <div className="flex shrink-0 flex-col items-end leading-none">
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
              {/* What comes after this level is the one thing on this bar a
                  player can do without. At 320px the clock was the widest
                  object on the screen and the room's name had been truncated to
                  a single letter to pay for it — so below 360 this line goes,
                  and the level, the blinds and the countdown stay. */}
              <span className="mt-1 hidden text-[9px] uppercase tracking-widest text-muted-foreground min-[360px]:inline">
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
