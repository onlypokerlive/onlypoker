'use client'

import { useEffect, useRef, useState } from 'react'

import { runoutBeats, runoutDurationMs, runoutPauseSeconds, type RunoutBeat } from '@/lib/runout'
import { revealDurationMs } from '@/lib/showdown'
import type { GameView } from '@/lib/poker-api'

export interface Runout {
  /** The board to draw right now. */
  board: string[]
  /** Whether the reveal is still running. */
  revealing: boolean
  /**
   * When the board will be complete, measured from the hand ending — zero when
   * nothing is being held back.
   *
   * Published because the showdown is one sequence told by two hooks. The hands
   * turn over first (`use-showdown`), the board is dealt out over them, and only
   * then does the winning hand light up and the pot go out. That last part is
   * timed by the other hook, which has no way of knowing how long the board
   * took — so it is told.
   */
  boardCompleteMs: number
}

/**
 * Holds back a board that arrived all at once, and deals it out card by card.
 *
 * When everybody is all-in there is nothing left to decide, so the engine deals
 * the rest of the board and settles the hand in a single step: the most tense
 * moment of the night, over before it registered. Nothing about fixing that
 * needs the server — the client already receives the finished board and just
 * has to refuse to show all of it at once.
 *
 * The hands go face up **first** and the board waits for them. See
 * `RUNOUT_LEAD_IN_MS`: a board dealt out over hole cards nobody has seen is
 * three cards and no stakes.
 */
export function useRunout(view: GameView | null): Runout {
  const [heldTo, setHeldTo] = useState<number | null>(null)
  const [duration, setDuration] = useState(0)
  const seenLength = useRef(0)
  const seenHand = useRef(0)
  const started = useRef(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  const clearTimers = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }

  useEffect(() => clearTimers, [])

  useEffect(() => {
    if (!view) return
    const length = view.board.length

    // Arriving at a table that is already on the river is not a run-out. The
    // first view we ever see only sets the baseline.
    if (!started.current) {
      started.current = true
      seenLength.current = length
      seenHand.current = view.handNumber
      return
    }

    // A new hand outranks anything still playing: the table has moved on, and
    // holding a board from the previous hand would be showing a lie.
    if (view.handNumber !== seenHand.current) {
      clearTimers()
      setHeldTo(null)
      setDuration(0)
      seenHand.current = view.handNumber
      seenLength.current = length
      return
    }

    const from = seenLength.current
    seenLength.current = length
    // How long the hands take to turn over, which is what the first card waits
    // for. Taken from the server's `showOrder` — the same list `use-showdown`
    // times the reveal from, so the two clocks cannot disagree about when the
    // last hand landed face up.
    const handsUpMs = revealDurationMs(view.showOrder?.length ?? 0)
    const beats: RunoutBeat[] = runoutBeats(from, length, {
      pauseSeconds: runoutPauseSeconds(view.autoDealAtMs, view.autoDealSeconds),
      handsUpMs,
    })
    if (!beats.length) return

    clearTimers()
    setHeldTo(from)
    setDuration(runoutDurationMs(beats))
    beats.forEach((beat, i) => {
      timers.current.push(
        setTimeout(() => setHeldTo(i === beats.length - 1 ? null : beat.size), beat.at),
      )
    })
  }, [view])

  const revealing = heldTo !== null
  return {
    board: view && revealing ? view.board.slice(0, heldTo!) : (view?.board ?? []),
    revealing,
    boardCompleteMs: revealing ? duration : 0,
  }
}
