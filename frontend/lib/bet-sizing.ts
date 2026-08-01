// Bet sizing for the action bar.
//
// Kept apart from the component because this is the one piece of arithmetic in
// the app that costs real chips when it is wrong: a "half pot" that computes
// high pushes more into the middle than the player meant to.
//
// Everything here speaks in "raise to" totals, which is what the engine takes
// (pokerkit's complete_bet_or_raise_to), not in "raise by" amounts.

import type { GameView } from '@/lib/poker-api'

export interface SizingContext {
  bigBlind: number
  /** Chips already collected into the middle, excluding the current street. */
  pot: number
  /** Everything wagered out on the felt right now, across all players. */
  betsOnFelt: number
  /** Extra chips you owe to match the largest bet. */
  callAmount: number
  /** What you already have out on this street. */
  myBet: number
  minRaise: number
  maxRaise: number
  /** Preflop with nobody having raised, sizes read naturally in big blinds. */
  preflopUnopened: boolean
}

export interface Preset {
  label: string
  /** The "raise to" total this preset stands for. */
  amount: number
}

/** Fractions offered postflop, and preflop once somebody has raised. */
const POT_FRACTIONS: [string, number][] = [
  ['⅓', 1 / 3],
  ['½', 1 / 2],
  ['¾', 3 / 4],
  ['Pot', 1],
]

/** Opening sizes preflop, in big blinds. */
const BB_MULTIPLES: [string, number][] = [
  ['2x', 2],
  ['2.5x', 2.5],
  ['3x', 3],
]

/**
 * What to offer when the pot has outgrown the stack.
 *
 * Shares of what you have left, not of what is in the middle. A third of a
 * 25,200 pot is 8,400, and a player sitting behind 7,200 cannot make that bet
 * or any of the three above it — so every pot fraction clamped to the maximum,
 * collapsed into one another, and the row offered a single button reading
 * "All-in". Which was arithmetically true and useless: there were perfectly
 * good bets at 2,400 and 3,600 that nothing offered a way to reach except
 * dragging a slider across a whole stack.
 *
 * This is the case that decides tournaments, so it gets sizes of its own. Below
 * a third they stop being bets and start being change, hence no smaller entry.
 */
const STACK_FRACTIONS: [string, number][] = [
  ['⅓', 1 / 3],
  ['½', 1 / 2],
  ['¾', 3 / 4],
]

export function sizingContext(view: GameView): SizingContext | null {
  const legal = view.legal
  if (!legal) return null
  const callAmount = legal.callAmount
  return {
    bigBlind: view.bigBlind,
    pot: view.pot,
    betsOnFelt: view.players.reduce((sum, p) => sum + p.bet, 0),
    callAmount,
    myBet: view.you?.bet ?? 0,
    minRaise: legal.minRaise ?? 0,
    maxRaise: legal.maxRaise ?? 0,
    // Facing nothing bigger than a big blind means nobody has raised yet, so
    // "3x" still means what a player expects. Once there is a raise to answer,
    // big-blind multiples stop making sense and pot fractions take over.
    preflopUnopened: view.street === 'preflop' && callAmount <= view.bigBlind,
  }
}

/**
 * The pot a raise is measured against: what would be in the middle once you
 * call.
 *
 * ``view.pot`` deliberately excludes chips still sitting on the felt (see
 * ``poker.pot_total`` on the server), so they have to be added back or every
 * postflop preset comes out short.
 */
export function potAfterCall(c: SizingContext): number {
  return c.pot + c.betsOnFelt + c.callAmount
}

/** Raise-to total for a pot-fraction bet. */
export function raiseToForFraction(c: SizingContext, fraction: number): number {
  return Math.round(c.myBet + c.callAmount + fraction * potAfterCall(c))
}

/** Raise-to total for an opening size expressed in big blinds. */
export function raiseToForMultiple(c: SizingContext, multiple: number): number {
  return Math.round(multiple * c.bigBlind)
}

/**
 * The buttons to show, left to right.
 *
 * A size the player cannot afford is not shown greyed out — it collapses into
 * All-in, because that is the bet it would actually become. A size below the
 * minimum raise is dropped entirely: it is not a bet that exists.
 */
export function presets(c: SizingContext): Preset[] {
  if (c.maxRaise <= 0) return []
  const raw: Preset[] = c.preflopUnopened
    ? BB_MULTIPLES.map(([label, m]) => ({ label, amount: raiseToForMultiple(c, m) }))
    : POT_FRACTIONS.map(([label, f]) => ({ label, amount: raiseToForFraction(c, f) }))

  const keep = (list: Preset[]) => {
    const out: Preset[] = []
    const seen = new Set<number>()
    for (const p of list) {
      if (p.amount < c.minRaise) continue
      const amount = Math.min(p.amount, c.maxRaise)
      if (seen.has(amount)) continue
      seen.add(amount)
      out.push({ ...p, amount })
    }
    return out
  }

  let out = keep(raw)
  // Everything the pot suggested was more than there is behind, so the sizes
  // that survived are one size wearing four labels. Measure against the stack
  // instead — those bets exist, and this is the spot where choosing between
  // them matters most.
  if (out.length <= 1) {
    const byStack = keep(
      STACK_FRACTIONS.map(([label, f]) => ({
        label,
        amount: Math.round(c.myBet + c.callAmount + f * (c.maxRaise - c.myBet - c.callAmount)),
      })),
    )
    if (byStack.length > out.length) out = byStack
  }

  const seen = new Set(out.map((p) => p.amount))
  if (!seen.has(c.maxRaise)) out.push({ label: 'All-in', amount: c.maxRaise })
  else out[out.length - 1] = { label: 'All-in', amount: c.maxRaise }
  return out
}

/**
 * Pull a dragged slider onto a nearby preset.
 *
 * A phone-sized slider covering a whole stack cannot land on an exact size, and
 * the sizes players actually want are the presets — so within a small window,
 * snap to them.
 */
export function snapToPreset(value: number, list: Preset[], range: number): number {
  const window = Math.max(1, range * 0.03)
  let best = value
  let bestGap = window
  for (const p of list) {
    const gap = Math.abs(p.amount - value)
    if (gap <= bestGap) {
      bestGap = gap
      best = p.amount
    }
  }
  return best
}

/** "12 BB", "2.5 BB" — the unit people actually think in. */
export function inBigBlinds(amount: number, bigBlind: number): string {
  if (!bigBlind) return ''
  const bb = amount / bigBlind
  const rounded = bb < 10 ? Math.round(bb * 10) / 10 : Math.round(bb)
  return `${rounded} BB`
}
