'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** Two taps closer together than this, in time and on the table, are one gesture. */
export const DOUBLE_TAP_MS = 320
const DOUBLE_TAP_PX = 40
/** How far a finger may travel between going down and coming up and still be a tap. */
const SLOP_PX = 10

/**
 * Anything that is a piece of the table rather than the table.
 *
 * The gesture is "the green", which means every seat, card, bet, stack and pot
 * is *not* it. Matching on `data-piece` and the board rather than on element
 * types, because all of those are plain divs — a selector that only excludes
 * `button` excludes nothing that is actually in the way.
 */
const PIECES = '[data-piece],[data-testid="board"],button,a,input,[role="slider"]'

/**
 * Checking by rapping the table, which is what checking is.
 *
 * A gesture and not a button, because it is the one action at a poker table
 * with a physical form everybody already knows. It also has to answer when it
 * refuses: a gesture that silently does nothing is indistinguishable from one
 * the app never received, and the player taps harder and then gives up on it.
 *
 * **This is the only way to take an action without pressing anything, so every
 * doubt resolves towards not firing.** A tap is a full press and release that
 * did not travel, from the primary pointer, on the felt itself — a scroll that
 * starts here, a second finger joining a pinch, a drag, or a tap on somebody's
 * cards are all *not* this.
 */
export function useDoubleTap({
  onDoubleTap,
  enabled,
}: {
  onDoubleTap: () => void
  /** False when checking is not on the table right now. */
  enabled: boolean
}) {
  // The tap being made: where it went down, and whether it is still a tap.
  const pressing = useRef<{ id: number; x: number; y: number } | null>(null)
  // The last completed tap, waiting to be joined by a second one.
  const previous = useRef<{ t: number; x: number; y: number } | null>(null)
  // What to say when the answer is "not now".
  const [refused, setRefused] = useState(0)

  // A half-finished gesture does not survive the turn moving on. Without this
  // a tap left over from a previous turn pairs up with the first tap of this
  // one and checks on a single deliberate touch.
  useEffect(() => {
    pressing.current = null
    previous.current = null
  }, [enabled])

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    // A second finger is a pinch or a fumble, never the second half of a knock.
    if (!event.isPrimary) {
      pressing.current = null
      previous.current = null
      return
    }
    // Every piece of furniture on the table keeps its own meaning. Tapping
    // your own cards twice to look at them is not a check.
    if ((event.target as HTMLElement).closest(PIECES)) {
      pressing.current = null
      previous.current = null
      return
    }
    pressing.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
  }, [])

  const finish = useCallback(() => {
    pressing.current = null
    previous.current = null
  }, [])

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const down = pressing.current
    if (!down || down.id !== event.pointerId) return
    // Moved: this is a scroll or a drag, and it stops being a tap the moment
    // it travels. Cheaper to lose a real tap than to check by accident.
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > SLOP_PX) {
      pressing.current = null
    }
  }, [])

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const down = pressing.current
      pressing.current = null
      if (!down || down.id !== event.pointerId) return
      if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > SLOP_PX) {
        previous.current = null
        return
      }

      const now = event.timeStamp
      const first = previous.current
      previous.current = { t: now, x: event.clientX, y: event.clientY }
      if (!first) return

      const together =
        now - first.t < DOUBLE_TAP_MS &&
        Math.hypot(event.clientX - first.x, event.clientY - first.y) < DOUBLE_TAP_PX
      if (!together) return

      // Consumed either way, so a third tap starts a fresh pair rather than
      // firing again off the second one.
      previous.current = null
      if (enabled) onDoubleTap()
      else setRefused((n) => n + 1)
    },
    [enabled, onDoubleTap],
  )

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    // A pointer the browser took away — a scroll starting, a system gesture,
    // the app going to the background mid-touch — is not a tap that finished.
    onPointerCancel: finish,
    onLostPointerCapture: finish,
    refused,
  }
}
