'use client'

import { useEffect, useRef } from 'react'

import { playCue } from '@/lib/sound'

/** When the tick starts, and where it starts double-timing. */
export const WARN_AT = 5
const HURRY_AT = 2

/**
 * How many half-seconds are left, so a tick can accelerate.
 *
 * Pure and exported because "does it speed up at the end" is the whole point
 * of it and is otherwise only checkable by listening.
 */
export function warningStep(secondsLeft: number): number | null {
  if (secondsLeft > WARN_AT || secondsLeft <= 0) return null
  // Once a second, then twice a second at the end. The change of rate is the
  // signal — a metronome at a constant speed becomes background noise in
  // about four beats.
  return secondsLeft <= HURRY_AT
    ? Math.ceil(secondsLeft * 2)
    : Math.ceil(secondsLeft) * 2
}

/**
 * The one warning that is not allowed to fail.
 *
 * Yours only, deliberately. Nine countdowns ticking at once is not a warning,
 * it is a room nobody can sit in — and it would also tell the table when
 * somebody else is under pressure, which is theirs to give away, not ours.
 *
 * It is the third channel alongside the colour and the number on the seat.
 * Three because each one fails somewhere real: haptics do not exist in Safari
 * on iOS, sound is off whenever anybody else is in the room, and colour is the
 * first thing to go on a dim screen or for anybody who does not separate red
 * from gold.
 */
export function useShotClockWarning({
  active,
  secondsLeft,
  audible,
}: {
  /** It is your turn, and there is a clock running on it. */
  active: boolean
  secondsLeft: number | null
  /** The sound switch is not on "nothing". */
  audible: boolean
}) {
  const lastStep = useRef<number | null>(null)

  useEffect(() => {
    if (!active || secondsLeft == null) {
      lastStep.current = null
      return
    }
    const step = warningStep(secondsLeft)
    if (step == null || step === lastStep.current) return
    // A turn that comes back round has to be able to warn again, so the guard
    // is "this step, already done" rather than "we have warned once".
    const first = lastStep.current == null
    lastStep.current = step

    if (audible) playCue('timeWarning')
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        // A single knock the first time, then a tap per tick. The first one is
        // the one that has to reach somebody who is not looking at the phone.
        navigator.vibrate(first ? [30, 40, 30] : 12)
      } catch {
        // Safari on iOS has no Vibration API. Nothing to fall back to.
      }
    }
  }, [active, secondsLeft, audible])
}
