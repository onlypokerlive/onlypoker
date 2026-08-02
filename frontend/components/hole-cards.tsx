'use client'

import { useEffect, useRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

import { cn } from '@/lib/utils'
import { PEEK_BAND_H } from '@/lib/table-layout'
import { PlayingCard } from '@/components/playing-card'

/** How long a quick tap keeps the cards up before they drop back down. */
const TAP_REVEAL_MS = 3000
/** Below this, a press counts as a tap rather than a hold. */
const TAP_MAX_MS = 250

/**
 * Where the cards sit, in pixels of `translateY` inside the band.
 *
 * The card is 48 tall in a band of 54, anchored to the bottom and clipped by
 * it. Pushed down 18 it leaves thirty pixels showing — most of a card, sitting
 * under the lip of the rail. Pulled to −4 the whole card is out with a hair of
 * clearance from the top edge.
 *
 * This is the mechanism and not a decoration: **the reveal is the occlusion**.
 * Fading a face in makes cards that were always there become visible, which is
 * not a thing objects do; sliding one out from under a lip is. Five attempts in
 * the prototype went to fades and dissolves before this landed.
 *
 * It was 34 — fourteen pixels, the corner index and nothing else. That number
 * came from a design where the tuck was also the hiding place, and it stopped
 * being true when the drag became the only way to fold: the cards are what you
 * reach for now, and a target you can barely see is a target people miss. The
 * secret was never in how far they were tucked anyway. It is that they are
 * face down.
 */
const TUCKED = 18
const OUT = -4

/**
 * How far up the thumb travels before the cards leave the rail and come with
 * it, and how far before letting go throws them away.
 *
 * `CARRY_AT` is past any thumb wobble on a press — under it, a hold is a hold.
 * The gap to `MUCK_AT` is the part of the gesture where you can see exactly
 * what is about to happen and still change your mind, which is the only thing
 * standing between this and folding aces by accident.
 */
const CARRY_AT = 44
const MUCK_AT = 96

/**
 * Your hand: pull it out from under the lip of the rail, or throw it away.
 *
 * Everyone is sitting at the same table looking at each other's phones, so a
 * hand that stays on screen is a hand the player next to you has already read.
 * Holding means the cards are only up while a thumb is on them. A quick tap
 * still works — it just puts them away again on its own.
 *
 * Keep pulling and the cards come off the rail and follow the thumb up onto the
 * felt, where a target says what letting go there does. That is the same
 * gesture a player makes at a real table, and it is the only way to fold
 * without going near a button — which matters because folding is the action
 * that gets pressed most and the one it hurts most to press by mistake.
 */
export function HoleCards({
  cards,
  revealed,
  onRevealChange,
  folded,
  made,
  canMuck = false,
  onMuck,
  className,
}: {
  cards: (string | null)[] | null
  revealed: boolean
  onRevealChange: (next: boolean) => void
  folded?: boolean
  /**
   * What this hand has made against the board, in words. Worked out by the
   * server, which is where the evaluator lives — two evaluators is two answers.
   */
  made?: string | null
  /**
   * Whether throwing the hand away is a legal move right now.
   *
   * Off, the drag still lifts the cards — refusing to move them would read as
   * the app having missed the gesture — but nothing arms and letting go just
   * puts them back.
   */
  canMuck?: boolean
  onMuck?: () => void
  className?: string
}) {
  /**
   * The gesture in progress: which pointer owns it, where it started and when.
   *
   * One object and not three loose refs, and it holds the `pointerId`, because
   * this control's only job on a phone with two thumbs on it is to decide
   * *which* thumb is folding the hand. Without an owner, a second finger
   * landing anywhere on the band moved the origin of the drag already under
   * way, and a second finger lifting ended it — with `armed` read from
   * whatever the first thumb had reached. That is a hand thrown away by
   * somebody's palm, in the one action at this table that cannot be undone.
   */
  const gesture = useRef<{ id: number; startY: number; at: number } | null>(null)
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Window listeners standing in for a capture the browser refused. */
  const fallback = useRef<(() => void) | null>(null)
  /**
   * Where the thumb is, once it has pulled far enough to take the cards with
   * it. `null` while the cards are still on the rail.
   *
   * Held in state rather than written straight to the DOM because the target
   * above the band and the cards under the thumb are two drawings of one
   * number, and the moment they disagree the gesture stops reading as physical.
   */
  const [carry, setCarry] = useState<{ x: number; y: number; travel: number } | null>(null)
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

  const dropFallback = () => {
    fallback.current?.()
    fallback.current = null
  }

  // Going away — the hand ended, the player left the table — is not a reason to
  // leave a hand face up on the way out.
  useEffect(
    () => () => {
      clearTapTimer()
      dropFallback()
      hideRef.current(false)
    },
    [],
  )

  const armed = canMuck && carry !== null && carry.travel >= MUCK_AT

  /** Whether this event belongs to the thumb that started the gesture. */
  const mine = (e: React.PointerEvent) =>
    gesture.current !== null && gesture.current.id === e.pointerId

  function press(e: React.PointerEvent) {
    // A gesture already has an owner: a second finger is a second finger, not a
    // new press, and it must not move the origin of the one in progress.
    if (gesture.current) return
    // Right and middle mouse buttons open menus rather than gestures. Written
    // to treat "not reported" as the ordinary left press, because a synthetic
    // pointer reports no button at all — and a control that refuses every
    // pointer it does not fully recognise is a control nobody can use.
    //
    // Deliberately *not* gated on `isPrimary`. It is the obvious test for "a
    // second finger" and it is the wrong one here: the owner check above
    // already turns every finger after the first away, and `isPrimary`
    // defaults to false on a synthetic pointer — so gating on it would refuse
    // every press in a test while looking like it worked.
    if ((e.button ?? 0) !== 0) return
    clearTapTimer()
    gesture.current = { id: e.pointerId, startY: e.clientY, at: Date.now() }
    setCarry(null)
    // `setPointerCapture` throws on a pointerId the browser never issued, which
    // is every synthetic pointer a test fires, and can simply be refused. The
    // capture is what keeps the drag alive once the thumb leaves the control,
    // so without it the gesture has to be watched on the window instead — and
    // what that watch does is *cancel*. A press whose end we did not see is not
    // a decision to fold.
    let captured = false
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      captured = true
    } catch {
      captured = false
    }
    if (!captured && typeof window !== 'undefined') {
      const give = (ev: PointerEvent) => {
        if (gesture.current?.id !== ev.pointerId) return
        cancel()
      }
      window.addEventListener('pointerup', give)
      window.addEventListener('pointercancel', give)
      fallback.current = () => {
        window.removeEventListener('pointerup', give)
        window.removeEventListener('pointercancel', give)
      }
    }
    onRevealChange(true)
  }

  function move(e: React.PointerEvent) {
    if (!mine(e)) return
    const travel = gesture.current!.startY - e.clientY
    if (travel < CARRY_AT) {
      if (carry) setCarry(null)
      return
    }
    setCarry({ x: e.clientX, y: e.clientY, travel })
  }

  function release(e?: React.PointerEvent) {
    // Somebody else's finger coming off the glass ends nothing. This is the
    // event that folds a hand, so it answers to one pointer only.
    if (e && !mine(e)) return
    const started = gesture.current
    const held = started ? Date.now() - started.at : Infinity
    /**
     * How far the thumb had actually travelled when it came off the glass.
     *
     * Not `armed`, which is the last *move* the browser bothered to tell us
     * about — and it is under no obligation to tell us about the last one.
     * Moves are coalesced, and a thumb that pulls past the line and comes back
     * down can have its return trip dropped while the release still arrives
     * carrying the position it really ended on. Reading `armed` there throws
     * the hand away from a place the player had already left, in the one
     * action at this table that cannot be undone.
     *
     * A release with no position at all — the keyboard, which has no thumb —
     * is the only one that answers with what the drag had reached.
     */
    const travel = e && started ? started.startY - e.clientY : null
    const throwing = travel === null ? armed : canMuck && travel >= MUCK_AT
    gesture.current = null
    dropFallback()
    setCarry(null)
    if (throwing) {
      // The hand is gone; there is nothing left to keep face up.
      onRevealChange(false)
      onMuck?.()
      return
    }
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
   * screen for three seconds with nobody's thumb on it. Hide immediately — and
   * never fold: a gesture that was interrupted did not decide anything.
   */
  function cancel() {
    clearTapTimer()
    dropFallback()
    gesture.current = null
    setCarry(null)
    onRevealChange(false)
  }

  if (!cards || cards.length === 0) {
    return (
      // Folded, the band goes out. The cards are gone and they do not come back
      // until the next deal, so leaving this lit — or worse, still holding a
      // hand you have thrown away — is the app disagreeing with the table about
      // whether you are still in it.
      <div
        style={{ height: PEEK_BAND_H }}
        className={cn(
          'flex items-center justify-center rounded-xl border text-sm',
          folded
            ? 'border-border/30 bg-background/40 text-muted-foreground/70'
            : 'border-border/60 bg-card/50 text-muted-foreground',
          className,
        )}
      >
        {folded ? 'Out of this hand' : 'You are not in this hand'}
      </div>
    )
  }

  // On the rail while the thumb has not pulled far enough; all the way out once
  // it has, because from there the cards belong to the thumb and not the band.
  const lift = revealed || carry ? OUT : TUCKED

  return (
    // Named so the fit test can find its top edge. The zone above clips in
    // silence, and this band is what it clips first — see `data-own-zone`.
    <div data-peek-band className={cn('relative', className)}>
      {/* The target, above the line that divides your zone from the table —
          which is where a muck goes at a real table, and which is also the only
          place it can go: the band itself is where the thumb started, so a
          target drawn inside it would be under the hand making the gesture. */}
      {carry && (
        <div
          className={cn(
            'pointer-events-none absolute inset-x-0 bottom-full z-30 mb-2 flex h-16 items-center justify-center rounded-xl border-2 border-dashed text-[13px] font-semibold uppercase tracking-wider transition-colors',
            armed
              ? 'border-destructive bg-destructive/20 text-destructive'
              : 'border-border/70 bg-background/70 text-muted-foreground',
          )}
          aria-hidden
        >
          {!canMuck ? 'Nothing to fold' : armed ? 'Let go to fold' : 'Keep pulling to fold'}
        </div>
      )}

      {/* The cards, once they are off the rail: drawn under the thumb rather
          than inside the band, because the band clips — that clip is the whole
          reveal — and a card cannot both be occluded by a lip and be carried
          over it. Fixed rather than absolute so it is in the viewport's
          coordinates, which is what the pointer reports. */}
      {carry && (
        <div
          className="pointer-events-none fixed z-40 flex gap-1.5"
          style={{
            left: carry.x,
            top: carry.y,
            transform: `translate(-50%, -50%) rotate(${armed ? -7 : 0}deg) scale(${armed ? 0.9 : 1})`,
            transition: 'transform 140ms ease-out',
            opacity: armed ? 0.75 : 1,
          }}
          aria-hidden
        >
          {cards.map((card, i) => (
            <PlayingCard key={i} card={card} size="sm" className="shadow-2xl" />
          ))}
        </div>
      )}

      <button
        type="button"
        aria-pressed={revealed}
        aria-label={revealed ? 'Hiding your cards' : 'Hold to see your cards'}
        onPointerDown={(e) => {
          e.preventDefault()
          press(e)
        }}
        onPointerMove={move}
        onPointerUp={release}
        onPointerCancel={(e) => {
          if (mine(e)) cancel()
        }}
        // The browser took the capture away mid-drag — a scroll claimed it, the
        // element went away, a call arrived. It only ever cancels: a gesture
        // that was interrupted did not decide to fold.
        onLostPointerCapture={(e) => {
          if (mine(e)) cancel()
        }}
        // Not `onPointerLeave`: with the pointer captured the thumb is meant to
        // leave this element — that is the drag. Losing the capture fires
        // `pointercancel`, which is handled, and a browser that stole the
        // gesture fires it too.
        onBlur={cancel}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault()
            if (!e.repeat && !gesture.current) {
              clearTapTimer()
              // A keyboard press owns the gesture like a thumb does. `-1` is
              // not a pointer id any browser issues, so a finger landing
              // mid-hold cannot be mistaken for the key that started it.
              gesture.current = { id: -1, startY: 0, at: Date.now() }
              onRevealChange(true)
            }
          }
        }}
        onKeyUp={(e) => {
          if (e.key === ' ' || e.key === 'Enter') release()
        }}
        onContextMenu={(e) => e.preventDefault()}
        style={{ height: PEEK_BAND_H }}
        className={cn(
          'group relative block w-full touch-none select-none overflow-hidden rounded-xl border text-left transition-colors',
          revealed
            ? 'border-primary/60 bg-card'
            : 'border-border/60 bg-card/80 hover:border-primary/40',
        )}
      >
        <div className="flex h-full items-center gap-3 px-3">
          <div className="flex flex-col gap-0.5">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {revealed ? (
                <Eye className="size-3 text-primary" />
              ) : (
                <EyeOff className="size-3" />
              )}
              Your hand
            </span>
            {/* What you have, while you are looking at it.
                A player at a table works this out for themselves and it is half
                of what the pause before acting is *for* — but they work it out
                from cards they can hold at arm's length and study, not from
                fourteen millimetres of screen under their own thumb. Saying it
                is not doing the thinking for anybody; it is giving them back
                the reading conditions.

                Only while the cards are up, which is the same rule the cards
                themselves follow: the person next to you must not be able to
                learn your hand by reading a caption you left on screen. */}
            <span
              className={cn(
                'truncate text-sm font-medium',
                revealed ? 'text-primary' : 'text-foreground',
              )}
            >
              {carry
                ? 'Pull up to fold'
                : revealed
                  ? (made ?? 'Release to hide')
                  : 'Hold to see'}
            </span>
          </div>

          {/* The pocket. The cards live under the lip of the rail and the band's
              own clip is what hides them, so the offsets are inline: they are
              two states of one animated value, and reading them as a pair of
              conflicting transform utilities is how the geometry gets lost. */}
          <div className="relative ml-auto h-full w-24">
            <div
              className="absolute bottom-0 left-1/2 flex gap-1.5 transition-transform duration-200 ease-out"
              style={{
                transform: `translateX(-50%) translateY(${lift}px)`,
                // Carried away, the pair under the thumb is the real one and
                // this is the hole they came out of.
                opacity: carry ? 0 : 1,
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
                    size="sm"
                    className="shadow-lg"
                  />
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* The lip the cards sit under used to be drawn here: a strip of the
            same wood as the rail, so the cards were coming out from under the
            table's own edge. It was the literal version of the idea and it
            read as a brown bar across the bottom of a control — furniture in
            the middle of the interface, and the one piece of the table that
            was not on the table.

            Nothing replaces it, because nothing has to: the band clips its own
            content, and *that* is the occlusion. The wood was a picture of the
            edge that was already doing the work. What tells this band apart
            from the screen around it is now what tells any surface apart — it
            is a shade lighter, and no more than that. */}
      </button>
    </div>
  )
}
