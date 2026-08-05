'use client'

import { useEffect, useState } from 'react'

import { litBeats, revealBeats } from '@/lib/showdown'
import type { GameView, PlayerView } from '@/lib/poker-api'

export interface ShowdownBeats {
  /** Whether this seat's hand has turned over yet, by index in `seats`. */
  shown: (index: number) => boolean
  /** Whether this card is one of the winning five, and lit yet. */
  lit: (card: string) => boolean
  /** Whether the lighting has begun at all — the cue for everything else to dim. */
  dimming: boolean
  /**
   * Whether this hand's ending has finished being told.
   *
   * The cue for the pot to go out. The payout used to leave the middle the
   * moment the server said the hand was over, which is the same response that
   * starts the reveal — so the chips crossed the felt while hands were still
   * turning over and the winning five had not been picked out yet. The money
   * moving *is* the answer, and it was arriving before the question.
   *
   * True when there was no showdown at all (a pot won by folding is over the
   * moment it is won), and true on a hand this client walked in on, where
   * everything is simply where it ends up.
   */
  done: boolean
}

/**
 * The showdown, played out rather than announced.
 *
 * Six beats: the board completes (`use-runout`), the hands turn over one at a
 * time in the order the action went, the winning five light up in sequence, the
 * hand is named in the winner's plate, and the pot goes out in an arc
 * (`chip-flight`). This hook owns the middle three.
 *
 * Somebody who opens the app on a finished hand sees the end state with no
 * animation, which is the same rule `use-runout` and `useBoardEntrance` follow:
 * a first view is the state of the world, not an event in it.
 *
 * With `reduced` set the beats still run — they are simply not animated by
 * whoever consumes them. Collapsing the whole showdown into one frame would tell
 * somebody who turned motion off that a hand ended and nothing else, and the
 * order of a showdown *is* the information.
 */
/** How often the clock ticks. Fine enough that no beat is late by much. */
const TICK_MS = 100

export function useShowdown(
  view: GameView | null,
  seats: PlayerView[],
  /**
   * When the board will be finished being dealt out, measured from the hand
   * ending — zero when it arrived complete. See `Runout.boardCompleteMs`.
   *
   * This used to be a boolean, `waiting`, and it held *everything* back until
   * the board landed: the hands stayed face down through the whole run-out. The
   * reasoning was sound — a winning hand face up next to a river that is still
   * face down answers the hand before it has been asked — and the conclusion
   * was backwards. What a run-out is *for* is watching two known hands wait for
   * a card, which is why every room turns them over first and why an all-in now
   * gets its lead-in (`RUNOUT_LEAD_IN_MS`).
   *
   * So the hands turn over on their own beats from the moment the hand ends,
   * the board is dealt out over them, and only the part that answers the hand —
   * the winning five lighting up, the pot going out — waits for this.
   */
  boardCompleteMs = 0,
): ShowdownBeats {
  const hasView = !!view
  const showdown = !!view?.wentToShowdown && view.phase === 'handover'
  const handNumber = view?.handNumber ?? 0

  /**
   * The very first view this client ever held, and whether it was already a
   * showdown.
   *
   * The difference between "a hand just ended in front of me" and "I opened the
   * app on a hand that was already over", which are the same view and must not
   * be the same picture. State rather than a ref, and compared during the
   * render rather than inside an effect, for the reason below.
   */
  const [arrived, setArrived] = useState<{ hand: number; showdown: boolean } | null>(null)
  if (hasView && arrived === null) setArrived({ hand: handNumber, showdown })
  const walkedInOn = arrived?.showdown ? arrived.hand : null

  /**
   * The showdown being played out: which hand, how far into it, and how long it
   * runs. Null when nothing is being played.
   *
   * Started here, in the middle of the render, and not in the effect below.
   *
   * `null` means "this is simply where it ends up" — every hand face up, every
   * winning card lit, the pot free to go out. That is the right picture for a
   * hand this client walked in on and the wrong one for a hand it watched, and
   * the two arrive as the same view. Started from an effect, the transition
   * from a live hand painted exactly one frame of the ending before the clock
   * came back to zero: the whole showdown, told and then untold. React re-runs
   * a component that sets its own state during a render before committing
   * anything, so starting it here means that frame never exists.
   */
  const [run, setRun] = useState<{ hand: number; from: number; at: number } | null>(null)

  // The order of the reveal, recomputed freely: it is cheap, and it is derived
  // from the view rather than stored, so a poll landing mid-reveal cannot leave
  // it describing a hand that is over.
  const reveals = showdown
    ? revealBeats(seats, view!.showOrder ?? [])
    : seats.map(() => null)
  const lastReveal = reveals.reduce<number>((max, b) => (b == null ? max : Math.max(max, b)), 0)
  /**
   * Every hand that took chips out of the middle, not the one player who
   * finished ahead.
   *
   * This asked `delta > 0`, which is a different question with a different
   * answer twice over: a player who put in 100 and won a side pot of 20
   * finished at -80, and a chop hands both players back exactly what they put
   * in. On the first the winning five never lit; on the second — the hand where
   * two people are staring at the board working out whether they share it —
   * nothing lit at all. See `HandResult.won`.
   */
  const winners = showdown ? view!.lastResults.filter((r) => r.won > 0) : []
  // The lighting starts after both of the things it is the answer to: every
  // hand face up, and every card of the board on the table. On an ordinary
  // showdown the board is already there and the reveals decide it; on an all-in
  // the board is still being dealt long after the last hand turned over.
  const answered = Math.max(lastReveal, boardCompleteMs)
  const lit = showdown
    ? litBeats(
        winners.flatMap((r) => r.handCards ?? []),
        answered,
      )
    : new Map<string, number>()
  const firstLit = lit.size ? Math.min(...lit.values()) : Infinity
  /**
   * When the last thing in this showdown happens.
   *
   * The clock used to run for a flat 2.4 seconds, which is a number that fits a
   * heads-up pot and truncates a full one: from seven hands the reveals alone
   * outlast it, and the last winning cards never light at all. The showdown is
   * as long as the showdown is.
   */
  const endsAt = Math.max(lastReveal, ...(lit.size ? [...lit.values()] : [0]))

  // Nothing to play until there has been a view before this one, and never for
  // the hand this client opened the app on. Polling brings the same handover
  // back every 1.2 seconds, so the hand number is what stops it being started
  // again on each of them.
  if (arrived !== null && showdown && handNumber !== walkedInOn && run?.hand !== handNumber) {
    setRun({ hand: handNumber, from: Date.now(), at: 0 })
  }

  const playing = run?.hand === handNumber ? run : null

  // A clock rather than a list of per-element timers: the beats are already
  // arithmetic, so one ticking number answers every "has this happened yet"
  // and the whole thing stays testable as pure functions.
  //
  // It reads elapsed *time* rather than counting its own ticks, and that is
  // what lets the end move. `boardCompleteMs` is measured by the other hook and
  // arrives a render after the handover does, so the last beat of a showdown is
  // not known when the clock starts. Counting ticks, learning that meant
  // rescheduling them, and rescheduling them put the clock back to 100ms — the
  // showdown told from the top, halfway through. Elapsed time does not care
  // when the timer was set.
  const runHand = playing?.hand ?? null
  const runFrom = playing?.from ?? null
  const at = playing?.at ?? null
  const ends = endsAt
  const ticking = runHand !== null && at !== null && at < ends
  useEffect(() => {
    if (!ticking) return
    const timer = setInterval(() => {
      setRun((r) => (r && r.hand === runHand ? { ...r, at: Date.now() - r.from } : r))
    }, TICK_MS)
    return () => clearInterval(timer)
  }, [ticking, runHand, runFrom])

  // No run is "not playing this", and at a showdown that means the view arrived
  // already finished — so everything is simply where it ends up.
  return {
    // The hands turn over from the moment the hand ends, board or no board.
    // Which is the opposite of what this did — see `boardCompleteMs`.
    shown: (index) => {
      if (!showdown) return false
      const beat = reveals[index]
      if (beat == null) return false
      return at == null || at >= beat
    },
    lit: (card) => {
      const beat = lit.get(card)
      if (beat == null) return false
      return at == null || at >= beat
    },
    dimming: lit.size > 0 && (at == null || at >= firstLit),
    // Still dealing the board out is still telling it — which `answered`, and
    // therefore `ends`, already accounts for.
    done: !showdown ? true : at == null || at >= ends,
  }
}
