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
  { value: 1, face: '#E8E2D2', edge: '#9C9484' },
  { value: 5, face: '#C1272D', edge: '#7A1519' },
  { value: 25, face: '#1E7A45', edge: '#0F4526' },
  { value: 100, face: '#1B1B20', edge: '#000000' },
  { value: 500, face: '#6B2E9E', edge: '#3E1A5E' },
  { value: 1_000, face: '#D4A32C', edge: '#8A6714' },
  { value: 5_000, face: '#D2601A', edge: '#833709' },
  { value: 25_000, face: '#2270B8', edge: '#12406C' },
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

/**
 * The colours a stack of `amount` is made of, drawn as exactly `discs` discs.
 *
 * Two different questions, and the seat stacks used to answer them with one
 * number, which is why a chip leader and a short stack looked the same. *How
 * many* discs is about how deep somebody is compared to everybody else — that
 * belongs to the table and is decided in `poker-table.tsx`. *Which colours* is
 * about what their chips are actually made of, and that is this.
 *
 * The old drawing had neither: it invented an amount (`startingChips / 20` per
 * disc) and broke that down, so the colours described a number nobody held.
 *
 * Shares are by **value**, not by count. If five sixths of what somebody has is
 * sitting in one blue chip, five sixths of their pile should be blue — that is
 * what makes a deep stack look deep across a table, and counting discs instead
 * would paint it in the colour of their loose change.
 */
export function chipColumn(amount: number, discs: number): ChipGroup[] {
  const want = Math.max(0, Math.round(discs))
  if (want === 0) return []
  // Ask for the honest breakdown first — enough chips that the high
  // denominations actually appear — then repaint `want` discs in those
  // proportions.
  const groups = chipBreakdown(amount, Math.max(12, want))
  if (!groups.length) return []

  const total = groups.reduce((sum, g) => sum + g.value * g.count, 0)
  if (total <= 0) return []

  // Largest first, because that is the order they are stacked in and the order
  // `chipBreakdown` returns. Each denomination takes its share of the pile,
  // and every denomination present takes at least one disc — a stack with a
  // 25,000 chip in it should show that chip even when its share rounds to
  // nothing.
  const out: ChipGroup[] = []
  let left = want
  for (let i = 0; i < groups.length && left > 0; i++) {
    const g = groups[i]
    const remaining = groups.length - i
    const share = (g.value * g.count) / total
    // Leave one disc for each denomination still to come.
    const room = left - (remaining - 1)
    const n = Math.max(1, Math.min(room, Math.round(share * want)))
    for (let k = 0; k < n; k++) out.push({ ...g, count: 1 })
    left -= n
  }
  // Rounding can leave a disc or two over; they go to the biggest, which is
  // what a player would do with them.
  while (left > 0) {
    out.unshift({ ...groups[0], count: 1 })
    left -= 1
  }
  // Largest first — bottom of the pile first, same as `chipStack`.
  return out
}
