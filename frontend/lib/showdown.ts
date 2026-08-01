// The end of a hand, in the order it happens at a table.
//
// A showdown used to arrive as one frame: every hand face up, the winner
// announced, the chips already moved. That is the answer to the hand rather
// than the hand, and it is the single most-watched moment of the night — the
// only one where everybody at the table is looking at the same thing.
//
// At a real table it takes about four seconds and has an order: the last player
// who bet turns over first, then everyone left round the ring, then the room
// works out who won. This is that order, as pure arithmetic, so it can be
// tested without a table.

/**
 * How far apart two hands turn over.
 *
 * Slow enough that six of them are six events and not a shuffle, fast enough
 * that the whole reveal fits inside the pause a showdown gets from the server —
 * nine seconds, and more when there was an all-in. See `_handover_seconds`.
 *
 * Deliberately unhurried. This is one table with friends round it, not a room
 * optimising hands per hour, and the showdown is the part of the night people
 * talk over. A reveal that is *finished* by the time anybody looks up has told
 * them the result and none of the hand.
 */
export const REVEAL_STEP_MS = 420

/** And how long after the last hand before the winning five light up. */
export const HAND_LIT_DELAY_MS = 700

/** Between each of the five cards of the made hand. */
export const HAND_LIT_STEP_MS = 200

/**
 * When each seat turns its hand over, as a delay per seat.
 *
 * `order` is the server's — who has to show and in what order, which is the
 * showdown rule itself (`_seats_that_must_show`). This used to be worked out
 * here from the action log, and it got it wrong twice: it looked for the last
 * aggressor of the whole *hand* rather than of the last street, and where
 * nobody had bet it started from the front of `seats` — an array each viewer
 * rotates to put themselves at the bottom, so two people at one table saw two
 * different orders and each saw themselves show first.
 *
 * Everybody not in the order gets `null` and never turns over: the players who
 * folded, and the beaten hands the rule lets muck. A card either of them
 * chooses to show anyway is not part of this — it arrives face up on its own
 * (`shownIndices`), because deciding to show is not a showdown.
 */
export function revealBeats(
  seats: { id: string }[],
  order: string[],
): (number | null)[] {
  const beat = new Map(order.map((id, step) => [id, step * REVEAL_STEP_MS]))
  return seats.map((seat) => beat.get(seat.id) ?? null)
}

/**
 * When each of the winning five lights up, keyed by card.
 *
 * A map rather than a list because the five are spread across the board and two
 * hole cards, drawn by two different components that have no way to talk to
 * each other about position. Both can ask "when does this card light".
 *
 * The delay is measured from the same zero as `revealBeats`, so the lighting
 * starts after the last hand has turned over and not on top of it.
 */
export function litBeats(
  handCards: string[] | undefined,
  afterReveals: number,
): Map<string, number> {
  const lit = new Map<string, number>()
  if (!handCards) return lit
  for (const card of handCards) {
    // A chop is two winners with two made hands, and on one board those hands
    // usually share cards — the whole reason it is a chop. Passed both lists
    // end to end, a card named twice must light once, on the beat it first
    // came up, or the board flickers back on under the second hand.
    if (lit.has(card)) continue
    lit.set(card, afterReveals + HAND_LIT_DELAY_MS + lit.size * HAND_LIT_STEP_MS)
  }
  return lit
}

/** How long the whole thing takes, for checking it fits in the pause. */
export function showdownDurationMs(liveHands: number, handCards = 5): number {
  return (
    Math.max(0, liveHands - 1) * REVEAL_STEP_MS +
    HAND_LIT_DELAY_MS +
    Math.max(0, handCards - 1) * HAND_LIT_STEP_MS
  )
}
