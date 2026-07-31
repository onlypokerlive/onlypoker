'use client'

import { useEffect, useRef } from 'react'
import { Eye, EyeOff } from 'lucide-react'

import { cn } from '@/lib/utils'
import { PlayingCard } from '@/components/playing-card'

/** How long a quick tap keeps the cards up before they drop back down. */
const TAP_REVEAL_MS = 3000
/** Below this, a press counts as a tap rather than a hold. */
const TAP_MAX_MS = 250

/**
 * The only way to see your own hand: press and hold.
 *
 * Everyone is sitting at the same table looking at each other's phones, so a
 * hand that stays on screen is a hand the player next to you has already read.
 * Holding means the cards are only up while a thumb is on them. A quick tap
 * still works — it just puts them away again on its own.
 */
export function HoleCards({
  cards,
  revealed,
  onRevealChange,
  folded,
  className,
}: {
  cards: string[] | null
  revealed: boolean
  onRevealChange: (next: boolean) => void
  folded?: boolean
  className?: string
}) {
  const pressedAt = useRef<number | null>(null)
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The unmount cleanup must hide the cards with whatever callback is current,
  // not the one captured when the component first rendered.
  const hideRef = useRef(onRevealChange)
  hideRef.current = onRevealChange

  const clearTapTimer = () => {
    if (tapTimer.current) {
      clearTimeout(tapTimer.current)
      tapTimer.current = null
    }
  }

  // Going away — the hand ended, the player left the table — is not a reason to
  // leave a hand face up on the way out.
  useEffect(
    () => () => {
      clearTapTimer()
      hideRef.current(false)
    },
    [],
  )

  function press() {
    clearTapTimer()
    pressedAt.current = Date.now()
    onRevealChange(true)
  }

  function release() {
    const held = pressedAt.current ? Date.now() - pressedAt.current : Infinity
    pressedAt.current = null
    if (held < TAP_MAX_MS) {
      // Treat it as a tap: leave the cards up briefly, then hide them.
      tapTimer.current = setTimeout(() => onRevealChange(false), TAP_REVEAL_MS)
      return
    }
    onRevealChange(false)
  }

  /**
   * The press was taken away rather than finished: a call arrived, the thumb
   * slid off the control, the browser claimed the gesture for a scroll.
   *
   * None of that is a tap, and treating it as one is how a hand ends up on
   * screen for three seconds with nobody's thumb on it. Hide immediately.
   */
  function cancel() {
    clearTapTimer()
    pressedAt.current = null
    onRevealChange(false)
  }

  if (!cards || cards.length === 0) {
    return (
      <div
        className={cn(
          'flex h-24 items-center justify-center rounded-xl border border-border/60 bg-card/50 text-sm text-muted-foreground',
          className,
        )}
      >
        {folded ? 'You folded this hand' : 'You are not in this hand'}
      </div>
    )
  }

  return (
    <button
      type="button"
      aria-pressed={revealed}
      aria-label={revealed ? 'Hiding your cards' : 'Hold to see your cards'}
      onPointerDown={(e) => {
        e.preventDefault()
        press()
      }}
      onPointerUp={release}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onBlur={cancel}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          if (!e.repeat) press()
        }
      }}
      onKeyUp={(e) => {
        if (e.key === ' ' || e.key === 'Enter') release()
      }}
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        'group relative h-24 w-full touch-none select-none overflow-hidden rounded-xl border text-left transition-colors',
        revealed
          ? 'border-primary/60 bg-card'
          : 'border-border/60 bg-card/70 hover:border-primary/40',
        className,
      )}
    >
      <div className="flex h-full items-center gap-4 px-4">
        <div className="flex flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {revealed ? (
              <Eye className="size-3 text-primary" />
            ) : (
              <EyeOff className="size-3" />
            )}
            Your hand
          </span>
          <span
            className={cn(
              'text-sm font-medium',
              revealed ? 'text-primary' : 'text-foreground',
            )}
          >
            {revealed ? 'Release to hide' : 'Hold to see your cards'}
          </span>
        </div>

        {/* The cards sit behind the rail and rise out of it while held. The
            offsets are inline because they are two states of one animated
            value, which is clearer to read here than a pair of conflicting
            transform utilities. */}
        <div className="relative ml-auto h-full w-28">
          <div
            className="absolute bottom-0 left-1/2 flex gap-1.5 transition-transform duration-200 ease-out"
            style={{
              // Face down, enough of the card stays above the rail to read as a
              // card rather than a clipped sliver; holding lifts it clear.
              transform: `translateX(-50%) translateY(${revealed ? -18 : 16}px)`,
            }}
          >
            {cards.map((card, i) => (
              <span
                key={i}
                className="block transition-transform duration-200 ease-out"
                style={{
                  transform: `rotate(${revealed ? 0 : i === 0 ? -6 : 6}deg)`,
                }}
              >
                <PlayingCard
                  card={revealed ? card : null}
                  faceDown={!revealed}
                  size="md"
                  className="shadow-lg"
                />
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Table rail: drawn over the cards so they read as tucked underneath. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-2 bg-felt-rail"
        aria-hidden
      />
    </button>
  )
}
