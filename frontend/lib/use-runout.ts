'use client'

import { useEffect, useRef, useState } from 'react'

import { runoutBeats, runoutDurationMs, runoutPauseSeconds, type RunoutBeat } from '@/lib/runout'
import { revealDurationMs } from '@/lib/showdown'
import type { GameView } from '@/lib/poker-api'

export interface Runout {
  /** The board to draw right now. */
  board: string[]
  /**
   * Every board being dealt, each held to the same street.
   *
   * Together and not one after the other. Two boards run in sequence is eight
   * seconds of a table nobody can act on, and it also answers the question
   * twice: the whole reason for dealing twice is watching the same card come
   * for one board and not the other, which you can only do side by side.
   */
  boards: string[][]
  /** Whether the reveal is still running. */
  revealing: boolean
  /**
   * When the board finishes being dealt, measured from the hand ending — zero
   * on a hand where nothing was ever held back.
   *
   * Published because the showdown is one sequence told by two hooks. The hands
   * turn over first (`use-showdown`), the board is dealt out over them, and only
   * then does the winning hand light up and the pot go out. That last part is
   * timed by the other hook, which has no way of knowing how long the board
   * took — so it is told.
   *
   * **It outlives the reveal, and that is the point.** It said "how long is
   * left" and was dropped to zero the instant the river landed, which put every
   * beat still to come into a past the clock had already gone by: the winning
   * five lit in one frame and the pot left underneath them. The last two
   * seconds of the hand did not exist. It is a fact about the hand that ended —
   * *when the board was complete* — and it stands until the next one is dealt.
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
      pauseSeconds: runoutPauseSeconds(
        view.autoDealAtMs,
        view.autoDealSeconds,
        Date.now(),
        view.paused,
      ),
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
  // The same street on every board. Both are the same length at every beat, so
  // one held-to answers all of them — which is also what keeps `runoutBeats`
  // unchanged: the beats are about how far the board has got, not how many
  // there are.
  const held = (cards: string[]) => (revealing ? cards.slice(0, heldTo!) : cards)
  const dealt = view?.boards?.length ? view.boards : view?.board ? [view.board] : []
  return {
    board: view ? held(view.board) : [],
    boards: dealt.map(held),
    revealing,
    // Not `revealing ? duration : 0` — see the field. Cleared where it becomes
    // untrue, which is the next hand, and nowhere else.
    boardCompleteMs: duration,
  }
}
