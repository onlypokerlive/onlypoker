'use client'

import { useCallback, useRef, useState } from 'react'

/**
 * Two taps close together, in about the same place.
 *
 * Both halves matter. Without the time window every pair of taps a minute
 * apart is a double tap; without the *distance* window, a tap at one end of
 * the table and a tap at the other end count as one gesture, which is how a
 * player who taps two different seats to read them ends up checking.
 */
export const DOUBLE_TAP_MS = 320
const DOUBLE_TAP_PX = 40

/**
 * Checking by rapping the table, which is what checking is.
 *
 * The gesture is the whole felt rather than a button, because it is the one
 * action at a poker table that has a physical form everybody already knows.
 * It has to answer even when it refuses, though — a gesture that silently
 * does nothing is indistinguishable from a gesture the app did not receive,
 * and the player taps harder and then gives up on it.
 */
export function useDoubleTap({
  onDoubleTap,
  enabled,
}: {
  onDoubleTap: () => void
  /** False when checking is not on the table right now. */
  enabled: boolean
}) {
  const last = useRef<{ t: number; x: number; y: number } | null>(null)
  // What to say, when the answer is "not now". Cleared by the caller.
  const [refused, setRefused] = useState(0)

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      // Anything that is already a control keeps its own meaning. A seat, a
      // button, the pot — tapping those twice is not a check.
      if ((event.target as HTMLElement).closest('button,a,input,[role="slider"]')) {
        last.current = null
        return
      }
      const now = event.timeStamp
      const previous = last.current
      last.current = { t: now, x: event.clientX, y: event.clientY }
      if (!previous) return
      const close =
        now - previous.t < DOUBLE_TAP_MS &&
        Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < DOUBLE_TAP_PX
      if (!close) return

      // Consumed either way, so a third tap starts a fresh pair rather than
      // firing again off the second one.
      last.current = null
      if (enabled) onDoubleTap()
      else setRefused((n) => n + 1)
    },
    [enabled, onDoubleTap],
  )

  return { onPointerDown, refused }
}
