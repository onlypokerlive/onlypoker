// Chips crossing the felt.
//
// Every street of every hand, money moves twice: out of nine stacks onto the
// cloth, and off the cloth into the middle. The table used to draw the two
// resting positions and nothing in between, so the chips people pushed in
// simply stopped existing when the street closed — the pot's number went up and
// that was the whole of it. A pot that grows by arithmetic is a scoreboard; a
// pot you watched get bigger is a pot.
//
// The arithmetic of getting a chip from A to B is here, away from the drawing,
// because it is the part with an answer that can be wrong.

import type { Point } from '@/lib/table-layout'

/**
 * How long a chip is in the air, and how far apart two of them leave.
 *
 * Slower than they were, and deliberately. 420ms was the number that stopped
 * reading as a jump; it was not the number that reads as chips. Money crossing
 * a table is heavy and it is the thing everybody at it is watching, so it gets
 * time — and the whole sweep still lands well inside the shortest pause between
 * hands, which is what actually bounds this. The stagger is what makes four
 * bets read as four bets: leaving together they are one object with four
 * parts.
 */
export const FLIGHT_MS = 620
export const FLIGHT_STAGGER_MS = 80

/**
 * The pot going to whoever won it is slower on purpose. It is the last thing
 * that happens in a hand and the only one anybody is still watching.
 */
export const PAYOUT_MS = 820

/** A bet leaving somebody's stack for the felt in front of them. */
export const BET_MS = 380

export interface Flight {
  key: string
  from: Point
  to: Point
  amount: number
  /**
   * The seat whose bet is in the air, for the ones that have one.
   *
   * The drawing at the destination has to stand down while this is flying, or
   * the same chips are on screen twice — once under way and once already
   * arrived. Carried as a number rather than encoded in the key, because
   * reading state back out of a string is the family of bug this repo has a
   * rule against.
   */
  seat?: number
  /**
   * These chips are on their way *into* the middle.
   *
   * Same problem as `seat`, at the other end of the felt: the mound has to
   * stand down for whatever is still crossing towards it, or the pot is drawn
   * at its new size while the money that made it new is halfway there. Carried
   * as a field rather than sniffed out of the key, for the reason `seat` is.
   */
  toPot?: boolean
  /** When this one leaves, relative to the rest of its group. */
  delay: number
  /**
   * When these chips can first be seen, if that is not when they leave.
   *
   * A flight is invisible until it moves, because a rake that appears in the
   * bet's spot while the bet is still flying towards it is the same chips on
   * screen twice. But a rake does not leave the instant it is created — it
   * waits its turn in the stagger, and the last bet of a street it waits for
   * that bet to land — and the felt it is leaving has already been cleared by
   * the server, so between the two the money was simply nowhere. This is the
   * moment the chips are standing somewhere: on the cloth from the start for
   * the ones that were already resting there, and at the end of the bet's own
   * flight for the one that just closed the street.
   */
  seenAt?: number
  ms: number
  /**
   * How high the hop arches, in pixels.
   *
   * The path is two layers: the outer one travels in a straight line and the
   * inner one hops, and a straight line plus a vertical hop is an arc. Doing it
   * as one curved path would mean animating a transform per frame in
   * JavaScript; done as two it is two compositor properties and the phone does
   * not notice.
   */
  arc: number
}

/** Where a measured box has its middle. */
export function centreOf(box: {
  left: number
  top: number
  right: number
  bottom: number
}): Point {
  return { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 }
}

/**
 * How long the last bet of a street rests on the cloth before it is raked in.
 *
 * The street closes on the last player to act, so their chips and the rake
 * arrive in the same response — and drawn without this, the two happen in the
 * same frame: the bet is pushed out and pulled into the middle at once, which
 * is the one moment of a betting round that nobody can read. A beat of it
 * sitting there is what makes it a call and then a collection rather than a
 * number changing.
 */
export const SWEEP_HOLD_MS = 220

/**
 * How far into the rake the next card lands.
 *
 * Not after it. A dealer's hands overlap — the chips are still coming in as
 * the card goes down — and waiting for the felt to be clear puts a dead
 * second in the middle of the street where the table simply watches the app.
 */
export const CARD_ON_SWEEP_MS = 300

/** When the rake starts, given whether it is waiting on a bet to land first. */
export function sweepStart(afterBet: boolean): number {
  return afterBet ? BET_MS + SWEEP_HOLD_MS : 0
}

/** When the next street's first card lands, measured from the same response. */
export function sweepLeadIn(afterBet: boolean): number {
  return sweepStart(afterBet) + CARD_ON_SWEEP_MS
}

/**
 * The chips on the felt, less any part of them that is not going anywhere.
 *
 * An uncalled bet comes back. Somebody opens for 200, the only caller is all
 * in for 132, and 68 of that 200 is returned before the street is collected —
 * so the felt was holding 332 and the middle grew by 264. Raked at face value
 * the mound was being filled with more than went into it, which showed up as
 * the pot *shrinking* by the difference at the instant the rake set off.
 *
 * Only the largest bet can have an uncalled part, and it is exactly the
 * excess: everybody else's chips were called by definition, or they would not
 * be everybody else's. So the trim has one place to go and one size.
 */
export function calledPart<T extends { amount: number }>(chips: T[], intoPot: number): T[] {
  const total = chips.reduce((sum, c) => sum + c.amount, 0)
  const back = total - intoPot
  if (back <= 0 || !chips.length) return chips
  const biggest = chips.reduce((a, b) => (b.amount > a.amount ? b : a))
  return chips
    .map((c) => (c === biggest ? { ...c, amount: c.amount - back } : c))
    .filter((c) => c.amount > 0)
}

/**
 * The bets on the felt, going to the middle.
 *
 * Ordered by how far each has to travel, nearest first — which is the order
 * they arrive in anyway, and staggering by distance rather than by seat number
 * means the group lands as one instead of trailing whoever happened to be
 * sitting in seat nine.
 */
export function sweepToPot(
  chips: {
    key: string
    at: Point
    amount: number
    /**
     * Since when these chips have been standing where they are — see
     * {@link Flight.seenAt}. Zero for the ones that were already on the cloth
     * at the last poll; `BET_MS` for the bet that closed the street, which is
     * still on its way there as this is being worked out.
     */
    since?: number
  }[],
  pot: Point,
  /** Held back this long — see {@link SWEEP_HOLD_MS}. */
  after = 0,
  /**
   * What makes these chips *these* chips and not last street's.
   *
   * Without it the key was the player and the amount, and a player who calls
   * 300 on the flop and 300 on the turn produces the same key twice. React
   * then reuses the element — whose effect runs once, by design, because
   * re-running it would restart a chip in mid-air — so the second rake never
   * animates at all. It is the same class of bug as a list keyed by index.
   */
  gen: string | number = '',
): Flight[] {
  const distance = (p: Point) => Math.hypot(p.x - pot.x, p.y - pot.y)
  return [...chips]
    .sort((a, b) => distance(a.at) - distance(b.at))
    .map((chip, i) => ({
      key: `sweep-${gen}-${chip.key}-${chip.amount}`,
      from: chip.at,
      to: pot,
      amount: chip.amount,
      toPot: true,
      delay: after + i * FLIGHT_STAGGER_MS,
      seenAt: chip.since ?? 0,
      ms: FLIGHT_MS,
      // Shallow. These are being raked in, not thrown.
      arc: 10,
    }))
}

/**
 * Chips leaving a stack for the felt in front of it.
 *
 * The short one. A bet travels about a seat's width and is a push rather than a
 * throw, so it is quick and its arc is barely there — but it has to exist,
 * because a bet appearing fully formed on the cloth is the one moment in a hand
 * where money moves and nothing moves. That is what made the table read as a
 * scoreboard: chips left stacks and arrived at spots without ever having been
 * in between.
 */
export function betToFelt(
  seat: number,
  from: Point,
  to: Point,
  amount: number,
  key: string,
): Flight {
  return { key: `bet-${key}`, from, to, amount, seat, delay: 0, ms: BET_MS, arc: 7 }
}

/**
 * The pot going out to whoever won it.
 *
 * All of them leave at once, because a split pot is one payment made twice and
 * not two payments — and because with a stagger the second winner looks like an
 * afterthought.
 */
export function payoutFromPot(
  pot: Point,
  winners: { key: string; at: Point; amount: number }[],
  /** See `sweepToPot` — two boards can pay the same seat the same amount. */
  gen: string | number = '',
  /**
   * Held back until the rake that made this pot has landed.
   *
   * A hand won by folding ends in the same response that closes the street, so
   * the sweep and the payout were being started together and the middle paid
   * out chips that were still flying towards it. A dealer's two motions are in
   * an order, and it is always this one.
   */
  after = 0,
): Flight[] {
  return winners.map((winner) => ({
    key: `pay-${gen}-${winner.key}-${winner.amount}`,
    from: pot,
    to: winner.at,
    amount: winner.amount,
    delay: after,
    ms: PAYOUT_MS,
    // Higher than the sweep: this one is pushed across, and the arc is what
    // separates being paid from the pot merely relabelling itself.
    arc: 18,
  }))
}
