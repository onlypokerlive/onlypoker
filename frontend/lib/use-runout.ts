'use client'

import { useEffect, useRef, useState } from 'react'

import { runoutBeats, runoutDurationMs, runoutPauseSeconds, type RunoutBeat } from '@/lib/runout'
import { revealDurationMs } from '@/lib/showdown'
import type { GameView } from '@/lib/poker-api'

export interface Runout {
  /** The board to draw right now. */
  board: string[]
  /**
   * Every board being dealt, each held to its own street.
   *
   * One after the other, which is how a card room deals them: the first board
   * runs out, the table reacts, and only then does the second come. The row
   * waiting its turn is empty rather than absent — its room was reserved when
   * the second board came into existence, because a middle that grows halfway
   * through a run-out is a middle every seat was placed against a moment ago.
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
  // How many cards of each board to show, or null once the whole run-out is
  // over and the table is simply looking at what it dealt. One entry per board:
  // while the first is running the second is still at zero.
  const [heldTo, setHeldTo] = useState<number[] | null>(null)
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
    const boards = Math.max(1, view.boards?.length ?? 1)
    const beats: RunoutBeat[] = runoutBeats(from, length, {
      pauseSeconds: runoutPauseSeconds(
        view.autoDealAtMs,
        view.autoDealSeconds,
        Date.now(),
        view.paused,
      ),
      handsUpMs,
      boards,
    })
    if (!beats.length) return

    /**
     * Where every board stands at one beat.
     *
     * The boards behind the one being dealt are finished, the one being dealt
     * is at this street, and the ones still to come are empty — not missing.
     * `from` and not zero for the boards behind: a run-out that begins on the
     * turn shares the cards that were already out.
     */
    const at = (beat: RunoutBeat) =>
      Array.from({ length: boards }, (_, b) =>
        b < beat.board ? length : b === beat.board ? beat.size : from,
      )

    clearTimers()
    setHeldTo(Array.from({ length: boards }, () => from))
    setDuration(runoutDurationMs(beats))
    beats.forEach((beat, i) => {
      timers.current.push(
        setTimeout(() => setHeldTo(i === beats.length - 1 ? null : at(beat)), beat.at),
      )
    })
  }, [view])

  const revealing = heldTo !== null
  const dealt = view?.boards?.length ? view.boards : view?.board ? [view.board] : []
  // Each board to its own street. The first board is the one the rest of the
  // table reads from — `board` is what everything outside this hook still
  // asks for — so it takes index 0's length.
  const held = (cards: string[], b: number) =>
    revealing ? cards.slice(0, heldTo![b] ?? 0) : cards
  return {
    board: view ? held(view.board, 0) : [],
    boards: dealt.map(held),
    revealing,
    // Not `revealing ? duration : 0` — see the field. Cleared where it becomes
    // untrue, which is the next hand, and nowhere else.
    boardCompleteMs: duration,
  }
}
