// Where a hand comes from.
//
// Cards used to appear at every seat in the same frame, which is the one thing
// about a deal that never happens: a deal has a *source*, and the source is the
// reason the button matters at all. A table that puts two cards in front of nine
// people simultaneously has a dealer button drawn on it that nothing on screen
// ever refers to.

/**
 * How fast a dealer's hands move.
 *
 * A real pitch is about fifteen cards a second and unwatchable; this is slow
 * enough to follow round the ring and fast enough that nine players are dealt in
 * well under two seconds — which is the budget, because the shortest pause
 * between hands is two.
 */
export const DEAL_CARD_MS = 78

/**
 * The order the cards go out in, as a delay per seat per card.
 *
 * Two passes round the table, one card each, which is how cards are actually
 * dealt everywhere and not a flourish: dealing two at a time is what a
 * card-room calls a misdeal. Starting at the seat after the button, because
 * that is the small blind and the small blind gets the first card.
 *
 * `button` is an index into the same array the delays come back in — whatever
 * order the caller holds its seats in, which at this table is rotated so the
 * viewer sits at the bottom. Posting order is derived from the button and not
 * from the array, so the two never have to agree.
 *
 * Seats that are not in the hand get an empty list rather than a delay: nobody
 * pitches a card at an empty chair.
 */
export function dealBeats(
  seats: number,
  button: number,
  {
    cards = 2,
    dealtTo,
  }: {
    cards?: number
    /** Which seats are being dealt in. Every seat, if not given. */
    dealtTo?: (index: number) => boolean
  } = {},
): number[][] {
  const beats: number[][] = Array.from({ length: seats }, () => [])
  if (seats <= 0) return beats

  const inHand: number[] = []
  for (let step = 1; step <= seats; step++) {
    const seat = (button + step) % seats
    if (!dealtTo || dealtTo(seat)) inHand.push(seat)
  }
  if (!inHand.length) return beats

  let beat = 0
  for (let pass = 0; pass < cards; pass++) {
    for (const seat of inHand) {
      beats[seat].push(beat * DEAL_CARD_MS)
      beat++
    }
  }
  return beats
}

/** How long the whole deal takes, for checking it fits in the pause. */
export function dealDurationMs(seats: number, cards = 2): number {
  return seats * cards * DEAL_CARD_MS
}
