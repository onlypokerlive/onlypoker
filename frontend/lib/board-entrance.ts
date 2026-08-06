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
export function useBoardEntrance(
  board: string[],
  /**
   * How long these cards wait before they start landing.
   *
   * The response that carries a new card usually also carries the end of the
   * betting round it closed, and a card that lands while the chips are still
   * standing in front of everybody is a card dealt onto a street that has not
   * finished. Held back, it lands into the rake instead — see `sweepLeadIn`.
   *
   * A function, because the answer is decided by the effect that sets the
   * chips moving and this is asked from inside the effect that reacts to the
   * same view: the caller cannot have worked it out in time to pass a number.
   */
  leadInMs: number | (() => number) = 0,
): (number | null)[] {
  const seen = useRef<number | null>(null)
  const [fresh, setFresh] = useState<{ from: number; to: number; lead: number } | null>(
    null,
  )

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
    // The lead-in is read here, at the moment the cards arrive, and kept with
    // them: it is a property of *this* street closing, and a later re-render
    // for some unrelated reason must not restart these cards on a different
    // clock.
    setFresh({
      from: previous,
      to: length,
      lead: typeof leadInMs === 'function' ? leadInMs() : leadInMs,
    })
    // The lead-in is an argument to this arrival, not a reason to have one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board])

  return board.map((_, i) =>
    fresh && i >= fresh.from && i < fresh.to
      ? fresh.lead + (i - fresh.from) * DEAL_STEP_MS
      : null,
  )
}

/**
 * The same, for a hand being run twice.
 *
 * One hook rather than one per board, because a board is a list and hooks are
 * not allowed to be. It keys off the first board's length: both boards are
 * dealt to the same street on the same beat (`use-runout`), so one of them
 * knowing a street has landed is all of them knowing it.
 *
 * Every board's cards land on the *same* beats, not staggered one board after
 * the other. Two flops arriving three cards apart is two events; arriving
 * together it is one flop, twice — which is the thing being watched.
 */
export function useBoardsEntrance(
  boards: string[][],
  leadInMs: number | (() => number) = 0,
): (number | null)[][] {
  const first = useBoardEntrance(boards[0] ?? [], leadInMs)
  return boards.map((board, b) =>
    b === 0 ? first : board.map((_, i) => first[i] ?? null),
  )
}
