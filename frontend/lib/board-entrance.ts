'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * How far apart the cards of a street land.
 *
 * Fast enough that a flop is one gesture rather than three events, slow enough
 * that the three cards are three cards. Under about 200ms they blur into one;
 * over about 400ms the table starts waiting for the app.
 */
export const DEAL_STEP_MS = 290

/**
 * Which board cards have just arrived, and when each of them should land.
 *
 * Returns a delay per index, or null for a card that was already on the table
 * — because somebody who opens the app mid-hand is not watching a flop being
 * dealt, they are looking at a flop. Animating what was already there is the
 * same mistake as playing every sound at once on the first poll, and it is
 * the rule `use-runout` already follows.
 */
export function useBoardEntrance(board: string[]): (number | null)[] {
  const seen = useRef<number | null>(null)
  const [fresh, setFresh] = useState<{ from: number; to: number } | null>(null)

  useEffect(() => {
    const length = board.length
    const previous = seen.current
    seen.current = length

    // The first board this component ever sees is the state of the world, not
    // an event in it.
    if (previous === null) return
    // A new hand clears the board; that is not cards arriving.
    if (length <= previous) {
      setFresh(null)
      return
    }
    setFresh({ from: previous, to: length })
  }, [board])

  return board.map((_, i) =>
    fresh && i >= fresh.from && i < fresh.to ? (i - fresh.from) * DEAL_STEP_MS : null,
  )
}
