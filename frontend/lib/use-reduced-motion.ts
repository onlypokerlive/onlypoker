'use client'

import { useEffect, useState } from 'react'

/**
 * Whether this player has asked the system for less movement.
 *
 * A whole tanda of movement needs its own branch, and the branch is not "turn
 * the animations off" — it is *go straight to the end state while keeping the
 * timing*. A showdown that resolves in one frame tells somebody with this set
 * that a hand finished; it does not tell them who won or in what order it
 * happened, which is the information the movement was carrying. So the flights
 * are skipped and the beats are not.
 *
 * Read after mount rather than during render: the server has no media queries,
 * and answering during the first render is how the markup and the hydration
 * disagree.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!query) return
    setReduced(query.matches)
    const listen = (e: MediaQueryListEvent) => setReduced(e.matches)
    query.addEventListener('change', listen)
    return () => query.removeEventListener('change', listen)
  }, [])

  return reduced
}
