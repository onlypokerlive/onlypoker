// Turning a polled snapshot back into the moments it represents.
//
// The table has no event stream: the client asks the server "what does the
// table look like now?" every second or so and gets a whole picture back. So
// the moments worth a sound — cards landing, chips going in, your turn coming
// round — have to be recovered by comparing one picture with the one before it.
//
// Kept as a pure function so the awkward cases can be tested: joining a table
// mid-hand must not fire every sound at once, and a poll that changes nothing
// must not fire anything.

import type { GameView, TableAction } from '@/lib/poker-api'

export type TableEvent =
  | 'deal'
  | 'street'
  | 'yourTurn'
  | 'chips'
  | 'potWon'
  | 'levelUp'
  | 'elimination'
  | 'tournamentEnd'
  // Everything below is read off the server's action log rather than inferred
  // from a diff. `check` is the reason the log exists at all — see TableAction.
  | 'check'
  | 'fold'
  | 'raise'
  | 'allIn'
  /** The street closed and the bets were swept into the middle. */
  | 'potCollect'

/**
 * The decisions in `current` that `previous` had not seen yet.
 *
 * Keyed on `seq`, not on length or on identity: polling means the same action
 * comes back on every response until something else happens, and two quick
 * decisions between two polls arrive together. Both have to work, and only a
 * high-water mark does both.
 */
export function newActions(
  previous: GameView | null,
  current: GameView,
  /**
   * The highest `seq` this client has ever acted on, if the caller is keeping
   * one. Worth keeping: the previous *view* is not a reliable high-water mark
   * on its own, because a slow response can land after a faster one and put an
   * older table back on screen — and then everything between the two would be
   * announced a second time.
   */
  sinceSeq?: number,
): TableAction[] {
  if (!previous) return []
  const fromView = previous.actions.reduce((max, a) => Math.max(max, a.seq), 0)
  const seen = Math.max(fromView, sinceSeq ?? 0)
  return current.actions.filter((a) => a.seq > seen)
}

/**
 * What happened between two views.
 *
 * ``previous`` is null on the very first view, which deliberately produces
 * nothing: arriving at a table that is already mid-hand is not a hand being
 * dealt, and treating it as one plays every sound the app has at once.
 */
export function diffViews(
  previous: GameView | null,
  current: GameView,
  /** See {@link newActions}. */
  sinceSeq?: number,
): TableEvent[] {
  if (!previous) return []
  const events: TableEvent[] = []

  if (current.handNumber > previous.handNumber && current.phase === 'hand') {
    events.push('deal')
  } else if (current.board.length > previous.board.length) {
    // Only when the hand number held: a new deal already clears the board, and
    // that is a deal, not a street.
    events.push('street')
  }

  const you = current.you?.id
  if (you && current.actorId === you && previous.actorId !== you) {
    events.push('yourTurn')
  }

  // What everybody actually did, in the order they did it.
  const fresh = newActions(previous, current, sinceSeq)
  for (const action of fresh) {
    // All-in stops the table, so it is the moment worth naming even when the
    // decision that got there was a call.
    if (action.allIn) {
      events.push('allIn')
      continue
    }
    if (action.kind === 'check') events.push('check')
    else if (action.kind === 'fold') events.push('fold')
    else if (action.kind === 'raise') events.push('raise')
    else events.push('chips') // a call or an opening bet
  }

  // Somebody put chips in. The pot only moves between streets, so the live
  // signal is what is sitting out on the felt.
  //
  // Only consulted when the server said nothing, which is the case on a table
  // that has not been redeployed yet. Running both would play a call twice.
  const onFelt = (v: GameView) => v.players.reduce((sum, p) => sum + p.bet, 0)
  if (
    !fresh.length &&
    current.handNumber === previous.handNumber &&
    onFelt(current) > onFelt(previous)
  ) {
    events.push('chips')
  }

  // The street closed: the bets in front of everybody were swept into the
  // middle. Told apart from a deal, which also clears the felt, by the hand
  // holding — and from a fold, by the pot having grown.
  if (
    current.handNumber === previous.handNumber &&
    onFelt(previous) > 0 &&
    onFelt(current) === 0 &&
    current.pot > previous.pot
  ) {
    events.push('potCollect')
  }

  if (current.phase === 'handover' && previous.phase === 'hand') {
    events.push('potWon')
  }

  if (current.bigBlind > previous.bigBlind) {
    events.push('levelUp')
  }

  const wasOut = new Set(previous.players.filter((p) => p.out).map((p) => p.id))
  if (current.players.some((p) => p.out && !wasOut.has(p.id))) {
    events.push('elimination')
  }

  if (current.phase === 'finished' && previous.phase !== 'finished') {
    events.push('tournamentEnd')
  }

  return events
}

/**
 * Haptic patterns, in the shape ``navigator.vibrate`` takes.
 *
 * The budget follows how often the moment happens: what occurs twenty times a
 * night is a single tick, and only what happens once or twice gets a pattern
 * you would notice. Events not listed here are deliberately silent to the hand.
 */
export const HAPTICS: Partial<Record<TableEvent, number | number[]>> = {
  yourTurn: [18, 60, 18],
  chips: 10,
  // The table stops for this one. Deliberately louder than chips going in and
  // quieter than somebody going out.
  allIn: [30, 60, 30],
  potWon: 24,
  elimination: [40, 80, 40, 80, 120],
  tournamentEnd: [60, 100, 60, 100, 200],
}
