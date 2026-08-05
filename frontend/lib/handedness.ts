'use client'

import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'holdem:handed'

/** Which hand is holding the phone. */
export type Handed = 'right' | 'left'

/**
 * Right, because most people are.
 *
 * A default that is wrong for one person in ten and fixable in two taps beats
 * asking everybody a question on the way to their seat. See `cardsSide` for
 * what it actually decides.
 */
export const DEFAULT_HANDED: Handed = 'right'

/**
 * Which side of the peek band the cards sit on, given the hand holding the
 * phone: **the other one**.
 *
 * The one piece of arithmetic here, and it is the whole feature. The cards live
 * inside the control your thumb presses and drags, so a thumb coming up the
 * right-hand edge of the screen arrives on top of them — you press to look at
 * your hand and your own thumb is what you are looking at. Everything else on
 * this screen wants to be under the thumb; these two cards are the one thing
 * that has to be beside it.
 *
 * They were pinned to the right, which is the wrong side for nine people in
 * ten. It read as a layout choice and it was a legibility bug.
 */
export function cardsSide(handed: Handed): 'left' | 'right' {
  return handed === 'right' ? 'left' : 'right'
}

/** What a stored value means, ignoring anything this never wrote. */
export function parseHanded(saved: string | null): Handed | null {
  return saved === 'right' || saved === 'left' ? saved : null
}

/**
 * Which hand this device is held in, remembered.
 *
 * Per device and not per player, because it is a fact about the phone in
 * somebody's hand rather than about the seat — the same person joins from the
 * sofa on their own phone every time, and identity here lives in `localStorage`
 * anyway (there are no accounts).
 */
export function useHandedness(): { handed: Handed; setHanded: (next: Handed) => void } {
  const [handed, setState] = useState<Handed>(DEFAULT_HANDED)

  // Not readable while the page is being rendered on the server, so it is
  // picked up on mount — the same rule the sound switch follows.
  useEffect(() => {
    try {
      const saved = parseHanded(localStorage.getItem(STORAGE_KEY))
      if (saved) setState(saved)
    } catch {
      // Storage blocked. The setting still works; it just forgets.
    }
  }, [])

  const setHanded = useCallback((next: Handed) => {
    setState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // ignore
    }
  }, [])

  return { handed, setHanded }
}
