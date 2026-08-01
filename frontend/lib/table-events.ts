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

import type { GameView } from '@/lib/poker-api'

export type TableEvent =
  | 'deal'
  | 'street'
  | 'yourTurn'
  | 'chips'
  | 'potWon'
  | 'levelUp'
  | 'elimination'
  | 'tournamentEnd'

/**
 * What happened between two views.
 *
 * ``previous`` is null on the very first view, which deliberately produces
 * nothing: arriving at a table that is already mid-hand is not a hand being
 * dealt, and treating it as one plays every sound the app has at once.
 */
export function diffViews(previous: GameView | null, current: GameView): TableEvent[] {
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

  // Somebody put chips in. The pot only moves between streets, so the live
  // signal is what is sitting out on the felt.
  const onFelt = (v: GameView) => v.players.reduce((sum, p) => sum + p.bet, 0)
  if (current.handNumber === previous.handNumber && onFelt(current) > onFelt(previous)) {
    events.push('chips')
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
  potWon: 24,
  elimination: [40, 80, 40, 80, 120],
  tournamentEnd: [60, 100, 60, 100, 200],
}
