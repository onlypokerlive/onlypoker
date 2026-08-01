// Where everything on the table goes.
//
// All of this used to live inside `poker-table.tsx`, which meant it could only
// be checked by rendering a table and looking at it. That is exactly what kept
// going wrong: a chip on somebody's stack at nine seats on a 320px phone with
// five cards out is a real bug, it is invisible at every other combination,
// and there are more combinations than anybody checks by hand. Ten rounds of
// checking by hand is what this file replaces with a test that runs in
// milliseconds.
//
// Nothing here reads or writes the DOM. It takes measured boxes and returns
// coordinates, which is the only shape that can be tested — and, not
// incidentally, the only shape that can be run three times in a row inside one
// layout effect without the second run measuring what the first one wrote.
//
// The order is fixed and it is not negotiable: **erase, then measure
// everything, then compute, then write everything**. Interleaving a write
// between two reads forces the browser to lay the page out again to answer the
// second one. Measured on the prototype, separating the phases took the layout
// count from 97 to 40 on a bet and from 99 to 42 on a resize, with an
// identical result on screen.

/** A box in table-relative pixels: origin at the table's top-left corner. */
export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

export interface Size {
  w: number
  h: number
}

export interface TableSize {
  w: number
  h: number
}

export interface Point {
  x: number
  y: number
}

/**
 * Every number the table's geometry depends on, in one place.
 *
 * Scattered through a component these are unfindable, and the third time
 * somebody tunes one of them by trial and error they tune a different one from
 * the one they meant. Together they are half of what this module is.
 */
export const LAYOUT = {
  /**
   * The ring the seats ride, as a percentage of the table box. Percentages
   * because the table is a fixed aspect ratio; the things that have to dodge
   * each other are in pixels, which is the whole reason those two systems had
   * to be brought together.
   *
   * Set for the narrowest phone supported (320px). Anything wider gains slack.
   *
   * Wider than the 37/38 this started at, and the reason is the whole argument
   * for having a test: at 320px the old ring put three-handed flank seats on
   * top of a five-card board and nine-handed seats on top of each other. Both
   * are real and both were invisible at every other size. The extreme seats
   * now hang about seven pixels past the table box, which is margin the page
   * has anyway and is what a rail looks like from above.
   */
  SEAT_RX: 41,
  SEAT_RY: 41,

  /** How far the felt is inset inside the table box, matching `.baize`. */
  BAIZE_INSET: 16,

  /**
   * How far outside the middle of the felt something may sit before it is
   * hanging over the rail. Squared-radius units, so 1 is exactly the edge —
   * a little over is a chip resting against the wood, which is fine and
   * happens at a real table.
   */
  ON_THE_FELT: 0.94,

  /** Covering something costs this. Hanging over the rail costs this per unit. */
  COVERING: 100,
  OFF_THE_FELT: 40,

  /** Breathing room: chip to seat, and stack to its own seat. */
  BET_GAP: 8,
  STACK_GAP: 4,

  /** How the bet chip hunts for a gap: in towards the middle, and sideways. */
  PUSH_STEP: 3,
  MAX_PUSH: 90,
  SLIDE_STEP: 4,
  /**
   * Generous, because on a three-handed 320px table the lane between a flank
   * seat and the board is around 15px wide — nothing fits in it, and the only
   * free felt is a good way along the ring. Small slides are tried first.
   */
  MAX_SLIDE: 72,

  /** How far a stack may be pulled in towards its owner looking for room. */
  STACK_PULL: [0, 8, 16, 26],

  /**
   * A chip over the board costs far more than a chip over a seat: the
   * community cards and the pot are what everybody is reading, and a seat has
   * room to spare around its edge. High enough to be a rule rather than a
   * trade-off, but still a weight, so a hopeless table degrades instead of
   * snapping to an arbitrary corner.
   */
  BOARD_WEIGHT: 200,
} as const

// --------------------------------------------------------------------------- //
// Boxes
// --------------------------------------------------------------------------- //
export function expand(box: Box, px: number): Box {
  return {
    left: box.left - px,
    top: box.top - px,
    right: box.right + px,
    bottom: box.bottom + px,
  }
}

export function boxAt(centre: Point, size: Size): Box {
  return {
    left: centre.x - size.w / 2,
    top: centre.y - size.h / 2,
    right: centre.x + size.w / 2,
    bottom: centre.y + size.h / 2,
  }
}

export function overlapArea(a: Box, b: Box): number {
  const x = Math.min(a.right, b.right) - Math.max(a.left, b.left)
  const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  return x > 0 && y > 0 ? x * y : 0
}

export function overlaps(a: Box, b: Box): boolean {
  return overlapArea(a, b) > 0
}

// --------------------------------------------------------------------------- //
// The ring
// --------------------------------------------------------------------------- //
/** Seats start at the bottom — that is always you — and work round. */
export function seatAngle(index: number, total: number): number {
  return Math.PI / 2 + (index * 2 * Math.PI) / Math.max(1, total)
}

export function seatCentre(index: number, total: number, table: TableSize): Point {
  const angle = seatAngle(index, total)
  return {
    x: table.w / 2 + (LAYOUT.SEAT_RX / 100) * table.w * Math.cos(angle),
    y: table.h / 2 + (LAYOUT.SEAT_RY / 100) * table.h * Math.sin(angle),
  }
}

export function seatBox(
  index: number,
  total: number,
  table: TableSize,
  size: Size,
): Box {
  return boxAt(seatCentre(index, total, table), size)
}

/**
 * Which way is out of the table from this seat, and which way is the player's
 * own left.
 *
 * "Their left" is worth keeping rather than collapsing to a screen direction,
 * because it is the thing that stays true all the way round the ring: chips
 * live to a player's left, and for the player sitting opposite you that is the
 * right-hand side of your screen.
 */
export function seatAxes(index: number, total: number) {
  const angle = seatAngle(index, total)
  const out = { x: Math.cos(angle), y: Math.sin(angle) }
  // Facing the middle, turned a quarter to their own left.
  const left = { x: -Math.sin(angle), y: Math.cos(angle) }
  return { angle, out, left, in: { x: -out.x, y: -out.y } }
}

/**
 * How far out on the felt a point is, as a squared radius: 0 is the middle, 1
 * is the edge of the cloth, more than that is over the wood.
 *
 * A single number rather than a boolean, so "nearly off" can be paid for by a
 * weight instead of being either allowed or forbidden — which is what lets a
 * table with no clean answer degrade gracefully instead of snapping.
 */
export function feltRadius(point: Point, table: TableSize): number {
  const rx = Math.max(1, table.w / 2 - LAYOUT.BAIZE_INSET)
  const ry = Math.max(1, table.h / 2 - LAYOUT.BAIZE_INSET)
  const u = (point.x - table.w / 2) / rx
  const v = (point.y - table.h / 2) / ry
  return u * u + v * v
}

/**
 * What a spot costs, in the one currency both placements are priced in.
 *
 * Covering something you have to be able to read has to outweigh grazing the
 * edge of the wood, and by enough that it is a rule rather than a preference —
 * but it still has to be a *weight*, because on a 375px phone seating nine
 * with five cards out there is no spot that costs nothing, and something has
 * to be the least bad. An `if` cascade cannot express "least bad".
 */
export function spotCost(box: Box, blockers: Box[], table: TableSize): number {
  let cost = 0
  for (const blocker of blockers) {
    if (overlaps(box, blocker)) {
      cost += LAYOUT.COVERING + overlapArea(box, blocker) / 100
    }
  }
  const centre = { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 }
  const felt = feltRadius(centre, table)
  cost += Math.max(0, felt - LAYOUT.ON_THE_FELT) * LAYOUT.OFF_THE_FELT
  return cost
}

// --------------------------------------------------------------------------- //
// Where the wagered chips go
// --------------------------------------------------------------------------- //
/**
 * A player's bet: walked in from their seat towards the middle, and slid along
 * the ring, until it covers neither another seat nor the pot and board.
 *
 * Works in pixels against the measured table, because the things it has to
 * avoid are sized in pixels while the seat ring is a percentage. On a 320px
 * phone seating nine, the lane between a flank seat and the community cards is
 * a few pixels wide — guessing at percentages puts chips on top of a seat.
 *
 * It searches rather than solving in one shot because the obstacles are boxes
 * on a ring, not a single edge: past its own seat the chip can still be inside
 * a neighbour's, and every pixel further in opens that gap up, since the seats
 * are all centred on the ring it is leaving.
 *
 * **Called in a chain, and each bet must dodge the ones already placed in the
 * positions they were just given** — not in the positions the DOM still says
 * they have. Reading placed bets back out of the document halfway through
 * makes the answer depend on the order of iteration and on coordinates that
 * are about to stop being true.
 */
export function betSpot(
  index: number,
  total: number,
  table: TableSize,
  seats: Box[],
  chip: Size,
  centre: Box | null,
  placed: Box[] = [],
): Point {
  const { out } = seatAxes(index, total)
  const c = seatCentre(index, total, table)

  const own = seats[index]
  const halfW = (own.right - own.left) / 2
  const halfH = (own.bottom - own.top) / 2
  // Distance at which the chip's *box* clears its own seat's box on at least
  // one axis. Stepping off the seat edge and adding a fixed gap falls short on
  // the diagonals, where clearing one axis is what the geometry actually asks
  // for and the shortfall lands the chip inside the seat it came from.
  const needX =
    Math.abs(out.x) < 1e-6 ? Infinity : (halfW + chip.w / 2 + LAYOUT.BET_GAP) / Math.abs(out.x)
  const needY =
    Math.abs(out.y) < 1e-6 ? Infinity : (halfH + chip.h / 2 + LAYOUT.BET_GAP) / Math.abs(out.y)
  const start = Math.min(needX, needY)

  const reserved = centre ? expand(centre, LAYOUT.BET_GAP) : null
  const blocked = seats.map((s) => expand(s, LAYOUT.BET_GAP))

  const cost = (at: Point) => {
    const box = boxAt(at, chip)
    let spent = reserved ? LAYOUT.BOARD_WEIGHT * overlapArea(box, reserved) : 0
    for (const s of blocked) spent += overlapArea(box, s)
    // Bets already placed this pass, in the spots they were just given.
    // Weighted far above a seat, because a seat has margin to graze and two
    // pills on top of each other are one unreadable number — the same failure
    // as covering the board, and for the same reason.
    for (const p of placed) {
      spent += (LAYOUT.BOARD_WEIGHT / 3) * overlapArea(box, expand(p, LAYOUT.BET_GAP / 2))
    }
    return spent
  }

  // Sideways along the ring, for the tables where there is no room straight in.
  const tanX = -out.y
  const tanY = out.x
  // Never search past the middle: the far side belongs to the players there.
  const toMiddle = Math.hypot(c.x - table.w / 2, c.y - table.h / 2)

  let best = { x: c.x - out.x * start, y: c.y - out.y * start, cost: Infinity }

  for (
    let pushed = 0;
    start + pushed <= Math.min(start + LAYOUT.MAX_PUSH, toMiddle);
    pushed += LAYOUT.PUSH_STEP
  ) {
    const cx = c.x - out.x * (start + pushed)
    const cy = c.y - out.y * (start + pushed)
    for (let slide = 0; slide <= LAYOUT.MAX_SLIDE; slide += LAYOUT.SLIDE_STEP) {
      for (const dir of slide === 0 ? [1] : [1, -1]) {
        const at = { x: cx + tanX * slide * dir, y: cy + tanY * slide * dir }
        const spent = cost(at)
        if (spent === 0) return at
        if (spent < best.cost) best = { ...at, cost: spent }
      }
    }
  }

  return { x: best.x, y: best.y }
}

// --------------------------------------------------------------------------- //
// Where a player's own stack goes
// --------------------------------------------------------------------------- //
/**
 * The chips a player still has, beside their seat.
 *
 * One rule is hard and cost three rounds to learn: **never above the seat.**
 * That is where the cards are, and a stack there covers the one thing the seat
 * exists to show. Below it is the felt everybody is reading. So it goes to
 * their own left; if that does not fit, their right; if neither, underneath.
 *
 * And it has to clear four things, not one: its own seat, the bets already out
 * on the felt, the middle of the table, and **the neighbouring seats** — which
 * is the pair that was missing and that showed up exactly where it hurts, on a
 * short screen with the board complete and hands turned over.
 */
export function stackOffset(
  index: number,
  total: number,
  table: TableSize,
  seats: Box[],
  stack: Size,
  blockers: Box[],
): Point {
  const { out, left } = seatAxes(index, total)
  const own = seats[index]
  const c = { x: (own.left + own.right) / 2, y: (own.top + own.bottom) / 2 }
  const halfW = (own.right - own.left) / 2
  const halfH = (own.bottom - own.top) / 2

  // Everything it must not cover, including every other seat. Its own seat is
  // in the list too — a stack sitting on its owner's name is no better than
  // one sitting on the neighbour's.
  const avoid = [...seats.map((s) => expand(s, LAYOUT.STACK_GAP)), ...blockers]

  const sideStep = halfW + stack.w / 2 + LAYOUT.STACK_GAP
  const downStep = halfH + stack.h / 2 + LAYOUT.STACK_GAP

  // In preference order. "Below" is screen-down, deliberately not "outward":
  // for the seats along the top of the ring, outward is off the table
  // entirely, and the cost function is what rejects it there.
  const directions = [
    { x: left.x * sideStep, y: left.y * sideStep },
    { x: -left.x * sideStep, y: -left.y * sideStep },
    { x: 0, y: downStep },
    // The two corners below, which is where a crowded ring leaves the only
    // room: straight down runs into the middle of the table and straight
    // sideways runs into the neighbour, and the diagonal misses both.
    { x: left.x * sideStep, y: downStep },
    { x: -left.x * sideStep, y: downStep },
  ]

  let best: { at: Point; cost: number } | null = null
  for (const dir of directions) {
    for (const pull of LAYOUT.STACK_PULL) {
      // Pulling towards the owner is what opens up room on a crowded ring;
      // pushing away from them is what does it on the seats along the top,
      // where "towards the owner" means into the middle of the table.
      for (const sign of [1, -1]) {
        const at = {
          x: c.x + dir.x - out.x * pull * sign,
          y: c.y + dir.y - out.y * pull * sign,
        }
        const spent = spotCost(boxAt(at, stack), avoid, table)
        if (spent === 0) return at
        if (!best || spent < best.cost) best = { at, cost: spent }
        if (pull === 0) break
      }
    }
  }
  return best!.at
}

// --------------------------------------------------------------------------- //
// Sizes, when nothing has been measured yet
// --------------------------------------------------------------------------- //
/**
 * How big a seat is, near enough, before one has been measured.
 *
 * Used for the first frame — and by the test, which is the point. A model of
 * the sizes is what lets the whole matrix be checked without a browser; if the
 * model drifts from the components the test stops meaning anything, so the
 * numbers here are the ones in `player-seat.tsx` and nowhere else.
 */
export function estimateSeatSize({
  width,
  seats = 9,
  revealed = false,
}: {
  width: number
  seats?: number
  /** A hand has been turned over, so the cards — and the seat — are bigger. */
  revealed?: boolean
}): Size {
  const w = crowded(seats)
    ? Math.min(62, Math.max(52, width * 0.17))
    : Math.min(76, Math.max(60, width * 0.2))
  // Cards + name + chips + a badge row, and a revealed hand is taller.
  const h = revealed ? (crowded(seats) ? 86 : 92) : 78
  return { w, h }
}

/**
 * Seven or more, where the ring stops having room to spare.
 *
 * This is the one place the screen wins an argument. Nine seats on a 320px
 * phone put adjacent boxes seven pixels closer together than a full-size seat
 * is wide — the ring cannot be opened up, because it is already as wide as the
 * cloth, so the seat has to give. It is written down here rather than
 * discovered halfway through an implementation, and it is why `PlayerSeat`
 * takes a `compact` flag instead of sizing itself.
 */
export function crowded(seats: number): boolean {
  return seats >= 7
}

/**
 * The pot and board block in the middle, near enough, before it is measured.
 *
 * The numbers are the ones the components actually render — a card at `xs` is
 * 24 wide by 32 tall with a 4px gap, and the pot pill above it is about 96 by
 * 34. Guessing generously here would be the worst of both worlds: it would
 * make the test fail on tables that are fine and pass on tables that are not.
 */
export function estimateCentreBox(table: TableSize, boardCards: number): Box {
  const cards = boardCards > 0 ? boardCards * 24 + (boardCards - 1) * 4 : 96
  const w = Math.max(96, cards)
  const h = 34 + 8 + (boardCards > 0 ? 32 : 20)
  return boxAt({ x: table.w / 2, y: table.h * 0.42 }, { w, h })
}

/**
 * How a bet is written on the felt.
 *
 * Deep stacks in full are wider than the lane they have to sit in: "24,500" is
 * a 68px pill, and on a 320px phone that is most of the gap between a seat and
 * the board. Shortening past five figures is what a real table does with a
 * stack of chips anyway — you read the colour, not the count.
 *
 * Lives here rather than in the component because it is what decides how wide
 * the box is, and a size model that disagrees with the label is a test that
 * fails on tables that are fine.
 */
export function betLabel(amount: number): string {
  if (amount < 10_000) return amount.toLocaleString()
  const thousands = amount / 1000
  const rounded =
    thousands < 100 ? thousands.toFixed(1).replace(/\.0$/, '') : Math.round(thousands)
  return `${rounded}k`
}

/** A bet pill, near enough. Wider for bigger numbers, which is the point of it. */
export function estimateBetSize(amount: number): Size {
  // The chips beside the number, the padding, and then the number itself at
  // roughly 6px a glyph in the mono face used for it.
  const chars = Math.max(1, betLabel(amount).length)
  return { w: 26 + chars * 6.5, h: 18 }
}

/** A stack of chips, near enough. See `chipStack` for where the height comes from. */
export function estimateStackSize(discs: number): Size {
  return { w: 15, h: Math.max(8, (Math.max(1, discs) - 1) * 3 + 8) }
}

// --------------------------------------------------------------------------- //
// The whole table at once
// --------------------------------------------------------------------------- //
export interface TableLayoutInput {
  width: number
  height?: number
  seats: number
  /** How many community cards are out. */
  board: number
  /** What each seat has wagered this street, by seat index. */
  bets?: number[]
  /** How many chips each seat is showing beside them. */
  stacks?: number[]
  /** A hand has been turned over: seats are taller. */
  revealed?: boolean
}

export interface PlacedBox {
  what: string
  seat: number | null
  box: Box
}

export interface TableLayout {
  table: TableSize
  boxes: PlacedBox[]
}

/**
 * Everything on the table, placed, with nothing rendered.
 *
 * This is what makes §1.2 possible: the invariant "nothing covers anything"
 * stops being ten minutes of squinting at a phone and becomes an assertion.
 * The phases are separated here exactly as they are in the component — every
 * seat box first, then every bet, then every stack — because that ordering is
 * not an optimisation, it is the reason each layer can see the one before it.
 */
export function layoutTable(input: TableLayoutInput): TableLayout {
  const { width, seats, board, revealed = false } = input
  // The table box is a 3/4.4 portrait aspect, capped at max-w-sm.
  const w = Math.min(384, width - 24)
  const h = input.height ?? (w * 4.4) / 3
  const table: TableSize = { w, h }

  const seatSize = estimateSeatSize({ width, seats, revealed })
  const seatBoxes = Array.from({ length: seats }, (_, i) =>
    seatBox(i, seats, table, seatSize),
  )
  const centre = estimateCentreBox(table, board)

  const boxes: PlacedBox[] = [
    { what: 'centre', seat: null, box: centre },
    ...seatBoxes.map((box, seat) => ({ what: 'seat', seat, box })),
  ]

  // Bets, in a chain: each one dodges the ones already placed, in the spots
  // they were just given.
  const placedBets: Box[] = []
  const bets = input.bets ?? []
  for (let i = 0; i < seats; i++) {
    const amount = bets[i] ?? 0
    if (amount <= 0) continue
    const size = estimateBetSize(amount)
    const at = betSpot(i, seats, table, seatBoxes, size, centre, placedBets)
    const box = boxAt(at, size)
    placedBets.push(box)
    boxes.push({ what: 'bet', seat: i, box })
  }

  // Stacks last, because they have to clear the bets — which is the ordering
  // that was got wrong twice.
  const stacks = input.stacks ?? []
  const placedStacks: Box[] = []
  for (let i = 0; i < seats; i++) {
    const discs = stacks[i] ?? 0
    if (discs <= 0) continue
    const size = estimateStackSize(discs)
    const at = stackOffset(i, seats, table, seatBoxes, size, [
      centre,
      ...placedBets,
      ...placedStacks,
    ])
    const box = boxAt(at, size)
    placedStacks.push(box)
    boxes.push({ what: 'stack', seat: i, box })
  }

  return { table, boxes }
}

/** Every pair of boxes that covers one another, named so a failure says where. */
export function collisions(layout: TableLayout): string[] {
  const found: string[] = []
  const { boxes } = layout
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      // A seat's own bet and its own stack are stepped off that seat by
      // construction; what is being looked for is one player's furniture
      // landing on another's.
      if (overlaps(a.box, b.box)) {
        found.push(
          `${a.what}${a.seat ?? ''} × ${b.what}${b.seat ?? ''}`,
        )
      }
    }
  }
  return found
}
