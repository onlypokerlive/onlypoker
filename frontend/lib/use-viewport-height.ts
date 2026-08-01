'use client'

import { useLayoutEffect, useState } from 'react'

/**
 * How tall the screen actually is right now.
 *
 * `visualViewport` rather than `innerHeight` where it exists, for the same
 * reason the room is sized in `svh`: on a phone the URL bar slides away and
 * `innerHeight` reports the tallest the viewport ever gets, which is the one
 * measurement guaranteed not to fit.
 *
 * Starts at 0 — "not measured yet" — so nothing derived from it is drawn at a
 * size taken from a server render that has never seen a screen.
 *
 * Measured in a *layout* effect, which is the whole difference between that
 * being true and being visible. Zero scales the controls up to full size and
 * reserves 212px for them; a real 568px phone reserves 180. Read after paint,
 * the table was drawn 32px short, shown, and then re-drawn — a table that
 * changes size on arrival, on a screen whose one rule is that it does not.
 */
export function useViewportHeight(): number {
  const [height, setHeight] = useState(0)

  useLayoutEffect(() => {
    const read = () =>
      setHeight(Math.round(window.visualViewport?.height ?? window.innerHeight))
    read()
    window.addEventListener('resize', read)
    window.visualViewport?.addEventListener('resize', read)
    return () => {
      window.removeEventListener('resize', read)
      window.visualViewport?.removeEventListener('resize', read)
    }
  }, [])

  return height
}
