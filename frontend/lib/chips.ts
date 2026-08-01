// Turning a number into a stack of chips.
//
// Nobody at a real table builds a tower of one colour, so a drawing that does
// looks wrong before anybody can say why: the whole language of chips is that
// the colours tell you the size without counting. Getting from an amount to
// the chips that make it is arithmetic, so it lives here and gets tested,
// rather than being approximated inside a component.

/**
 * The ladder, low to high. The classic casino colours, which are worth keeping
 * even in a game with no money in it: they are the one thing everybody who has
 * ever played already knows.
 */
export const DENOMINATIONS = [
  { value: 1, face: 'oklch(0.93 0.01 90)', edge: 'oklch(0.62 0.02 60)' },
  { value: 5, face: 'oklch(0.52 0.19 25)', edge: 'oklch(0.34 0.14 25)' },
  { value: 25, face: 'oklch(0.5 0.13 155)', edge: 'oklch(0.33 0.1 155)' },
  { value: 100, face: 'oklch(0.28 0.02 260)', edge: 'oklch(0.16 0.02 260)' },
  { value: 500, face: 'oklch(0.45 0.16 305)', edge: 'oklch(0.3 0.12 305)' },
  { value: 1_000, face: 'oklch(0.8 0.15 90)', edge: 'oklch(0.58 0.13 80)' },
  { value: 5_000, face: 'oklch(0.65 0.18 45)', edge: 'oklch(0.45 0.15 40)' },
  { value: 25_000, face: 'oklch(0.55 0.14 220)', edge: 'oklch(0.37 0.11 220)' },
] as const

export interface ChipGroup {
  value: number
  count: number
  face: string
  edge: string
}

/**
 * The chips that make `amount`, largest first.
 *
 * Greedy, then flattened until it fits: a hundred and one chips is the right
 * answer arithmetically and an unreadable smear on a phone, so the smallest
 * denomination is repeatedly folded up into the next one until the stack is
 * short enough to look at. That makes the drawing approximate on purpose —
 * the exact number is written next to it, and a player reads the number for
 * the amount and the colours for the size, which is what they do at a table.
 */
export function chipBreakdown(amount: number, maxChips = 12): ChipGroup[] {
  if (!Number.isFinite(amount) || amount <= 0) return []
  const rounded = Math.round(amount)

  const build = (from: number) => {
    const groups: ChipGroup[] = []
    let left = rounded
    for (let i = DENOMINATIONS.length - 1; i >= from; i--) {
      const d = DENOMINATIONS[i]
      const count = Math.floor(left / d.value)
      if (count > 0) {
        groups.push({ value: d.value, count, face: d.face, edge: d.edge })
        left -= count * d.value
      }
    }
    // Whatever is left is smaller than the smallest chip we are willing to
    // draw, so it rides on one more of that chip. Rounding *up* rather than
    // dropping it: a stack that renders as nothing for a bet that exists is
    // the one error here that reads as a bug.
    if (left > 0 && from < DENOMINATIONS.length) {
      const d = DENOMINATIONS[from]
      const existing = groups.find((g) => g.value === d.value)
      if (existing) existing.count += 1
      else groups.push({ value: d.value, count: 1, face: d.face, edge: d.edge })
    }
    return groups
  }

  let from = 0
  let groups = build(from)
  while (
    groups.reduce((n, g) => n + g.count, 0) > maxChips &&
    from < DENOMINATIONS.length - 1
  ) {
    from += 1
    groups = build(from)
  }
  return groups
}

/**
 * The same chips, one entry per disc, bottom of the stack first.
 *
 * Big ones underneath, which is how anybody who has ever stacked chips stacks
 * them — and it also means the top of the stack is the part that changes when
 * the amount does, so the stack grows and shrinks from the end you are looking
 * at.
 */
export function chipStack(amount: number, maxChips = 12): ChipGroup[] {
  const discs: ChipGroup[] = []
  for (const group of chipBreakdown(amount, maxChips)) {
    for (let i = 0; i < group.count; i++) discs.push({ ...group, count: 1 })
  }
  return discs
}
