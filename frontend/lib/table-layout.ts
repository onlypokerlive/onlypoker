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
  /**
   * The ring's own box, as a percentage of the table. A stadium inscribed in
   * it: corner radius is half the width, and whatever height is left over
   * becomes the two straight sides. See {@link seatRing}.
   */
  RING_W: 82,
  RING_H: 78,
  // Wider and shorter than the 41/41 this had, and than §1.6(f)'s 41/40.
  // The plates got taller when they became plates, so the ring had to get
  // *flatter* to keep nine of them apart — and wider to make up the
  // circumference it lost. RY 38 is also what finally puts the bottom seat
  // fully inside the table instead of thirteen pixels under the action bar,
  // which had been on the known-issues list since the first pass.


  /**
   * Where the middle of that ring sits, vertically.
   *
   * §1.6(f) says 53, and 53 does not work here — which is worth writing down,
   * because it is not a rounding difference. In the prototype the ring lives in
   * a table *zone* with your own zone below it, so the bottom of the ring is
   * another player and pushing it down costs nothing. Here you are the bottom
   * seat, and the same three points put your own plate thirteen pixels under
   * the action bar. The constant transferred; the structure it assumed did not.
   *
   * Named rather than written as `/ 2` so the next person finds a decision
   * instead of an arithmetic accident.
   */
  SEAT_CY: 50,

  /**
   * And where the board sits.
   *
   * Just above the middle of the ring, not well above it — the ellipse is at
   * its widest across its own centre, so a board pushed up towards the top of
   * the table is a board squeezed into the narrowest part of the ring. Moving
   * it *down* from 42 to 47 is what cleared the last of the flank-seat
   * collisions, which is the opposite of what it looks like it should do.
   * `poker-table.tsx` positions the real one at the same 47%.
   */
  BOARD_CY: 47,

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
  /** And leaving the table costs this per pixel — a rule, not a preference. */
  OFF_THE_TABLE: 30,

  /**
   * Breathing room: bet to seat, and stack to its own plate.
   *
   * The prototype's numbers, and tighter than the ones this had. They read as
   * too tight written down and are right on the felt, because the gap is not
   * doing the separating — the plate has its own border and the chips their own
   * shadow, and a wide gap on top of both just pushes the chips out to where
   * there is no room for them.
   */
  BET_GAP: 4,
  STACK_GAP: 2,

  /** How the bet chip hunts for a gap: in towards the middle, and sideways. */
  PUSH_STEP: 3,
  MAX_PUSH: 110,
  SLIDE_STEP: 4,
  /**
   * Generous, because on a three-handed 320px table the lane between a flank
   * seat and the board is around 15px wide — nothing fits in it, and the only
   * free felt is a good way along the ring. Small slides are tried first.
   *
   * 180 and not 130, and measured rather than argued: across the whole matrix
   * — fifteen widths, eleven heights, two to nine seats, one to three pots —
   * 130 leaves 212 bets sitting on a plate and 180 leaves 120. It could only be
   * raised once the slide followed the ring, because a straight tangent this
   * long is off the table entirely; that is why the two changes are one change.
   * 240 is worse again (180), which is what an over-long slide does: it finds
   * room for the bet being placed by taking the room the next one needed.
   */
  MAX_SLIDE: 180,
  /** How far back towards the rail a bet may be nudged looking for room. */
  MAX_PULL_BACK: 18,

  /**
   * What a pixel of wandering from the natural spot costs.
   *
   * The tie-breaker, and the thing that keeps a bet in front of the person who
   * made it. See `betSpot`.
   */
  WANDER: 0.35,

  /** How far a stack may be pulled in towards its owner looking for room. */
  STACK_PULL: [0, 10, 20, 30],

  /**
   * A chip over the board costs far more than a chip over a seat: the
   * community cards and the pot are what everybody is reading, and a seat has
   * room to spare around its edge. High enough to be a rule rather than a
   * trade-off, but still a weight, so a hopeless table degrades instead of
   * snapping to an arbitrary corner.
   */
  BOARD_WEIGHT: 200,

  /**
   * And a chip over its *own* seat costs more than one over anybody else's.
   *
   * This used to be priced the same as a neighbour, which sounds fair and is
   * the wrong way round. The start distance walks the chip clear of its owner
   * before the search begins, so the only way back onto that plate is the
   * search choosing it — and it chose it, because eight pixels on your own
   * plate scored exactly like eight on the seat next door. On a table where
   * some players are in the hand and some are sat out the seats are different
   * heights, and that is the case that made it pick: the neighbour had grown,
   * the owner had not, so the cheapest felt left was the owner's own corner.
   *
   * It is the wrong answer because the plate is where the stack figure is
   * written. Chips landing on it cover the one number the bet is supposed to be
   * read against. Priced below the board — a covered plate is recoverable, a
   * covered board is not — and far above a neighbour, so it stays a rule.
   */
  OWN_SEAT_WEIGHT: 60,
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
/**
 * The ring is a racetrack, not an ellipse — and that is the load-bearing choice.
 *
 * An ellipse ties the seats to the *shape* of the box: make the table taller and
 * the ellipse gets taller with it, which spreads the seats at the sides and
 * bunches the ones at the top and bottom. That is why the table used to have
 * exactly one aspect ratio that worked — between 3:3.8 and 3:4.2 the matrix went
 * from clean to a hundred and forty-four collisions — and why spare height on a
 * tall phone could not be given to the table.
 *
 * A stadium has a straight section down each side. Extra height makes the
 * straights *longer*, so the seats spread out along them and the arcs at the
 * ends never change. More room is always more room. That is what makes the
 * layout sustainable rather than a set of numbers tuned to one phone: the table
 * can now take whatever height the screen has left and simply get roomier.
 *
 * It is also the shape the table is already drawn as, so the seats now sit on
 * the rail they are supposed to be sitting on instead of on an ellipse inscribed
 * somewhere inside it.
 */
interface Ring {
  cx: number
  cy: number
  /** Corner radius — half the ring's width, since it is a stadium. */
  r: number
  /** Length of each straight side. Zero when the ring is as wide as it is tall. */
  straight: number
  perimeter: number
}

export function seatRing(table: TableSize): Ring {
  const cx = table.w / 2
  const cy = (table.h * LAYOUT.SEAT_CY) / 100
  const rw = (table.w * LAYOUT.RING_W) / 100
  const rh = (table.h * LAYOUT.RING_H) / 100
  const r = Math.max(1, rw / 2)
  const straight = Math.max(0, rh - rw)
  return { cx, cy, r, straight, perimeter: 2 * Math.PI * r + 2 * straight }
}

/**
 * Where a seat sits, and which way it faces.
 *
 * Walked by arc length from the bottom of the ring — which is always you — in
 * the same rotational direction the old ellipse used, so "the seat to your left"
 * still means what it meant. On the straights the outward normal is horizontal;
 * on the arcs it is radial. Both fall out of the walk, which is why this returns
 * the point and the normal together rather than making callers rediscover the
 * geometry.
 */
function walkRing(ring: Ring, t: number): { point: Point; out: Point } {
  const { cx, cy, r, straight: s, perimeter } = ring
  const quarter = (Math.PI * r) / 2
  let d = ((t % 1) + 1) % 1 * perimeter

  // 1. Bottom-left quarter arc, from the bottom of the ring round to the left.
  if (d <= quarter) {
    const a = Math.PI / 2 + d / r
    return {
      point: { x: cx + r * Math.cos(a), y: cy + s / 2 + r * Math.sin(a) },
      out: { x: Math.cos(a), y: Math.sin(a) },
    }
  }
  d -= quarter

  // 2. Up the left straight.
  if (d <= s) {
    return { point: { x: cx - r, y: cy + s / 2 - d }, out: { x: -1, y: 0 } }
  }
  d -= s

  // 3. Over the top, left to right.
  if (d <= 2 * quarter) {
    const a = Math.PI + d / r
    return {
      point: { x: cx + r * Math.cos(a), y: cy - s / 2 + r * Math.sin(a) },
      out: { x: Math.cos(a), y: Math.sin(a) },
    }
  }
  d -= 2 * quarter

  // 4. Down the right straight.
  if (d <= s) {
    return { point: { x: cx + r, y: cy - s / 2 + d }, out: { x: 1, y: 0 } }
  }
  d -= s

  // 5. And the last quarter arc, back to the bottom.
  const a = 2 * Math.PI + d / r
  return {
    point: { x: cx + r * Math.cos(a), y: cy + s / 2 + r * Math.sin(a) },
    out: { x: Math.cos(a), y: Math.sin(a) },
  }
}

/** Seats start at the bottom — that is always you — and work round. */
export function seatCentre(index: number, total: number, table: TableSize): Point {
  return walkRing(seatRing(table), index / Math.max(1, total)).point
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
export function seatAxes(index: number, total: number, table: TableSize) {
  const { out } = walkRing(seatRing(table), index / Math.max(1, total))
  // Facing the middle, turned a quarter to their own left.
  const left = { x: -out.y, y: out.x }
  return { out, left, in: { x: -out.x, y: -out.y } }
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
 *
 * This is the stacks' cost function. Bets have their own, inside `betSpot`,
 * because they trade against a different set of things — the board, the seat
 * they came from, the bets already down. The two do share the last term below,
 * and for a while they did not: `betSpot` had the soft felt cost without the
 * hard bounds, so "leaving the table is out of bounds" was a rule about
 * stacks that read like a rule about everything.
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

  // And leaving the table altogether is not a trade — it is out of bounds.
  //
  // Measured on the *edges*, not the centre, because that is the difference
  // between "leaning on the wood" and "floating on the page". The felt term
  // above prices drifting past the cloth as a soft cost, which is right; but on
  // a 320px phone the flank seats are already at the edge of the table, so a
  // stack pushed one step further out costs a few points of felt while landing
  // completely off the wood — and the search took it, every time, over any spot
  // that so much as grazed a neighbour. Priced per pixel and above COVERING, so
  // a stack will sit on somebody's plate before it will sit on the page.
  const out = Math.max(
    0,
    -box.left,
    box.right - table.w,
    -box.top,
    box.bottom - table.h,
  )
  cost += out * LAYOUT.OFF_THE_TABLE
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
  const { out } = seatAxes(index, total, table)
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

  // Where the chips would go if nothing were in the way: straight out in front
  // of their owner, as close as clears the plate.
  const home = { x: c.x - out.x * start, y: c.y - out.y * start }

  const cost = (at: Point) => {
    const box = boxAt(at, chip)
    // Wandering costs something. It has to, and this is the term that was
    // missing: without it every free spot on the felt scores exactly zero and
    // the search returns whichever it reaches first — which is the most pulled
    // back, then the furthest slid, because that is the order the loops run in.
    // On a table with room to spare, which is most tables most of the time,
    // that put everybody's bet somewhere behind and to one side of them rather
    // than in front, and it read as chips scattered about the felt by nobody.
    //
    // Priced low on purpose: a whole slide across the ring costs about what
    // fifty square pixels of overlap does, so it decides between spots that are
    // otherwise equal and never argues with a collision.
    let spent = Math.hypot(at.x - home.x, at.y - home.y) * LAYOUT.WANDER
    spent += reserved ? LAYOUT.BOARD_WEIGHT * overlapArea(box, reserved) : 0
    for (let i = 0; i < blocked.length; i++) {
      spent +=
        (i === index ? LAYOUT.OWN_SEAT_WEIGHT : 1) * overlapArea(box, blocked[i])
    }
    // Hanging over the rail, priced the same way a stack prices it, so the two
    // placements trade off against each other in one currency instead of two.
    spent += Math.max(0, feltRadius(at, table) - LAYOUT.ON_THE_FELT) * LAYOUT.OFF_THE_FELT
    // And leaving the table altogether is out of bounds, in exactly the words
    // `spotCost` uses. This function had the soft term and not the hard one, so
    // the comment over `OFF_THE_TABLE` — "a stack will sit on somebody's plate
    // before it will sit on the page" — was true of stacks and simply not true
    // of bets. Given a crowded ring the search happily slid a pill thirty
    // pixels past the edge of the table, where it costs a little felt and
    // nothing else, rather than graze a neighbour.
    spent +=
      Math.max(0, -box.left, box.right - table.w, -box.top, box.bottom - table.h) *
      LAYOUT.OFF_THE_TABLE
    // Bets already placed this pass, in the spots they were just given.
    // Weighted far above a seat, because a seat has margin to graze and two
    // pills on top of each other are one unreadable number — the same failure
    // as covering the board, and for the same reason.
    for (const p of placed) {
      spent += (LAYOUT.BOARD_WEIGHT / 3) * overlapArea(box, expand(p, LAYOUT.BET_GAP / 2))
    }
    return spent
  }

  // Sideways *along the ring*, and that is the whole of this change.
  //
  // It used to slide along the straight tangent at the seat, which is the
  // ring's direction for about the first twenty pixels and then increasingly
  // is not: the racetrack curves away and the tangent carries straight on, so
  // a long slide walked the chip off the cloth and eventually off the table
  // altogether — thirty pixels past the edge on a 320px phone, which is a bet
  // the player it belongs to cannot see. Walked by arc length instead, the
  // candidates stay on the ring however far they go, which is what "slid along
  // the ring" always claimed to mean, and each one brings its own outward
  // normal so the step in is taken from where it now stands.
  const ring = seatRing(table)
  const t0 = index / Math.max(1, total)
  // Never search past the middle: the far side belongs to the players there.
  const toMiddle = Math.hypot(c.x - table.w / 2, c.y - table.h / 2)

  let best = { ...home, cost: Infinity }

  // Slightly *outward* as well as inward. On a crowded ring the only free felt
  // is sometimes a few pixels behind the seat, towards the rail — which costs
  // a little now that the rail has a price, and costs far less than sitting on
  // a neighbour.
  for (
    let pushed = -LAYOUT.MAX_PULL_BACK;
    start + pushed <= Math.min(start + LAYOUT.MAX_PUSH, toMiddle);
    pushed += LAYOUT.PUSH_STEP
  ) {
    for (let slide = 0; slide <= LAYOUT.MAX_SLIDE; slide += LAYOUT.SLIDE_STEP) {
      for (const dir of slide === 0 ? [1] : [1, -1]) {
        // Two ways to be `slide` pixels to one side, and both are offered.
        //
        // Along the ring is the one that keeps its promise at any distance, and
        // it is the only one that can reach the far end of a crowded arc. Along
        // the tangent leaves the ring immediately and that is sometimes exactly
        // what is wanted — the free felt on a three-handed table is a little
        // inside the ring, not on it — so taking it away to fix the long slides
        // cost more collisions than it saved. The cost function is what chooses,
        // which is the arrangement this file is built on.
        const stood = walkRing(ring, t0 + (slide * dir) / ring.perimeter)
        for (const at of [
          {
            x: stood.point.x - stood.out.x * (start + pushed),
            y: stood.point.y - stood.out.y * (start + pushed),
          },
          {
            x: c.x - out.x * (start + pushed) - out.y * slide * dir,
            y: c.y - out.y * (start + pushed) + out.x * slide * dir,
          },
        ]) {
          const spent = cost(at)
          if (spent === 0) return at
          if (spent < best.cost) best = { ...at, cost: spent }
        }
      }
    }
  }

  return { x: best.x, y: best.y }
}

/**
 * Every bet on the table, placed — the chain, and then the repair.
 *
 * `betSpot` places one bet against the ones already down, which is a greedy
 * pass and has the failure greedy passes have: the last seat to be placed
 * inherits whatever room the earlier ones left it, and on a crowded ring that
 * can be none. Seat eight got the corner nobody wanted, every time, because it
 * was asked last — and asking in a different order only moves which seat pays.
 *
 * So whatever still overlaps after the chain is asked again, now knowing where
 * *everything* went rather than only what came before it. That is strictly more
 * information than the first pass had, so a second answer is either better or
 * the same, and it is only kept when it is better. Two rounds: the first fixes
 * almost all of it and the second settles the cases where two bets were each
 * dodging the other's old spot.
 *
 * Both callers go through here — the model in `layoutTable` and the real table
 * in `poker-table` — because a repair the matrix does and the screen does not
 * is a matrix that passes for a table nobody is looking at. Sizes come in as a
 * callback because those two do not agree on where a size comes from: the
 * model estimates, the screen has measured.
 */
export function placeBets(
  total: number,
  table: TableSize,
  seats: Box[],
  centre: Box | null,
  sizeOf: (index: number) => Size | null,
): (Point | null)[] {
  const sizes = Array.from({ length: total }, (_, i) => sizeOf(i))
  const spots: (Point | null)[] = []
  const boxes: (Box | null)[] = []
  const laid: Box[] = []
  for (let i = 0; i < total; i++) {
    const size = sizes[i]
    if (!size) {
      spots.push(null)
      boxes.push(null)
      continue
    }
    const at = betSpot(i, total, table, seats, size, centre, laid)
    const box = boxAt(at, size)
    laid.push(box)
    spots.push(at)
    boxes.push(box)
  }

  /**
   * How bad an arrangement is for one bet, in `betSpot`'s own currency.
   *
   * The same three weights, or the repair would trade a pill off a plate and
   * onto the board and call it an improvement.
   */
  const harm = (box: Box, self: number): number => {
    let bad = centre ? LAYOUT.BOARD_WEIGHT * overlapArea(box, centre) : 0
    for (const seat of seats) bad += overlapArea(box, expand(seat, LAYOUT.BET_GAP))
    for (let j = 0; j < total; j++) {
      const other = boxes[j]
      if (j === self || !other) continue
      bad += (LAYOUT.BOARD_WEIGHT / 3) * overlapArea(box, expand(other, LAYOUT.BET_GAP / 2))
    }
    return bad
  }

  for (let round = 0; round < 2; round++) {
    let better = false
    for (let i = 0; i < total; i++) {
      const size = sizes[i]
      const box = boxes[i]
      if (!size || !box) continue
      const before = harm(box, i)
      if (before === 0) continue
      const others = boxes.filter((b, j): b is Box => j !== i && b !== null)
      const at = betSpot(i, total, table, seats, size, centre, others)
      const moved = boxAt(at, size)
      if (harm(moved, i) < before) {
        spots[i] = at
        boxes[i] = moved
        better = true
      }
    }
    if (!better) break
  }

  return spots
}

// --------------------------------------------------------------------------- //
// Where a player's own stack goes
// --------------------------------------------------------------------------- //

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
/**
 * The scale everything on the table is drawn at.
 *
 * One number, and it is the whole of E2. Every piece on the felt used to be a
 * fixed pixel size while the ring was a percentage of the table, so shrinking
 * the table moved the seats closer together without making them any smaller —
 * which is why a table that fits the screen and a table that fits nine players
 * were two different tables. Sized off the reference phone, so `u === 1` is a
 * 390px-wide screen and everything below reads as the numbers a designer would
 * have written for that phone.
 *
 * Floored rather than open-ended: past a point the names stop being names. If
 * the screen cannot give the table that much, the table takes it anyway and the
 * page finds the room — a cramped table you can read beats a tidy one you
 * cannot.
 */
export const MIN_SCALE = 0.74

/**
 * The least room the table needs before it starts crowding itself.
 *
 * Not a floor the table refuses to go below — it will shrink to whatever it is
 * given — but the point at which {@link MIN_SCALE} starts binding, so the
 * pieces stop shrinking with it and nine of them begin to touch. It is the
 * budget the rest of the screen has to respect: on the shortest phone supported
 * (568px) everything else may spend 258, and it spends 256 — your own zone
 * takes 183 (see {@link ownZoneHeight}) and the room's own header, padding and
 * gaps take the other 73 (see {@link roomChrome}). What is left is 312, which
 * is what the live DOM measures at 320×568.
 */
export const MIN_TABLE_ROOM = 310

/**
 * The height your own zone holds — always, in every phase of every hand.
 *
 * **The rule this layout is built on: the table is the constant.** It is a
 * drawing of a physical object in a room, and physical objects do not change
 * size when the person looking at them is offered a different button. What
 * changes is the device; nothing else may.
 *
 * Your zone is one row of a screen that adds up, so whatever it does not take,
 * the table gets. That made every difference in your own controls a difference
 * in the size of the table: measured on a 375px phone, 218 while a hand is
 * being played against 210 between hands, and each of those against 104 for a
 * spectator — so the ring moved, every seat moved, and every chip was placed
 * against a box that had just stopped existing. It is the single worst thing
 * this layout has ever done and it has been fixed twice; the first fix reserved
 * a height for the controls *during a hand* and left every other phase free to
 * go on resizing the table.
 *
 * So the whole zone is one fixed height, taken from its tallest honest state:
 * the peek band (54) and the full action controls (152) with the gap between
 * them — measured on a live table across playing, waiting, folded and between
 * hands, where the tallest of the four came to 200. Everything else — between-hands offers, a spectator's one line — is
 * shorter and is padded out to it rather than allowed to shrink the felt.
 *
 * `height`, not `min-height`. A minimum is a floor a tall state simply steps
 * over, which is exactly what "between hands" was doing. Anything that does not
 * fit scrolls inside the zone; nothing gets to push the table.
 */
export const OWN_ZONE_H = 212

/**
 * The peek band: the lip your own cards sit under, at the top of your zone.
 *
 * Here rather than in the component because it is one of the two numbers
 * {@link OWN_ZONE_H} is made of, and a band that grew without the zone growing
 * with it would push the controls into a scroller on every hand.
 */
export const PEEK_BAND_H = 54

/** The gap between the rows of your zone — Tailwind's `gap-1.5`. */
export const OWN_ZONE_GAP = 6

/**
 * The shortest and tallest screens the zone is drawn at full size between.
 *
 * 568 is the iPhone SE, still the floor this is built to. 760 is where a phone
 * has enough height that the controls can be the size they were designed at
 * without the table paying for it.
 */
const SHORT_SCREEN = 568
const TALL_SCREEN = 760

/** How small the controls are allowed to get before the table has to give. */
const MIN_ZONE_SCALE = 0.8

/**
 * How big your own controls are drawn on this screen, as a fraction.
 *
 * The table is the constant *for a given device* — and this is the "for a given
 * device" half of that rule. A 52px button and a 28px preset row are the sizes
 * they were designed at on a 6-inch phone; drawn at the same 52 and 28 on an
 * SE they are the same buttons on two thirds of the screen, and the table gets
 * what is left, which was 282px of felt under 218px of controls. Buttons that
 * big next to a table that small is not a table with controls under it.
 *
 * So the whole zone is drawn at a scale taken from the height of the screen,
 * and it is the same idea as `tableScale` one row down: one multiplication,
 * continuous, no breakpoint to be wrong on one side of. It is published to the
 * CSS as `--zu` so a button's height and the gap above it come from one number
 * rather than from a prop threaded through four components.
 *
 * Floored at 0.8, which is where a 52px button is still 42 — past the 44px
 * touch target guidance by two pixels on the shortest phone we support, and a
 * button that misses is worse than a table that is small.
 */
export function zoneScale(viewportH: number): number {
  if (!Number.isFinite(viewportH) || viewportH <= 0) return 1
  const t = (viewportH - SHORT_SCREEN) / (TALL_SCREEN - SHORT_SCREEN)
  return Math.max(MIN_ZONE_SCALE, Math.min(1, MIN_ZONE_SCALE + t * (1 - MIN_ZONE_SCALE)))
}

/**
 * The height your zone holds on this screen. See {@link zoneScale}.
 *
 * The band does *not* scale, and that is not an oversight: it is a pocket a
 * 48px card slides out of, so a band drawn at 44 clips the card at the moment
 * it is fully out — which is the one frame the whole gesture exists for. What
 * scales is everything that is only a button.
 */
export function ownZoneHeight(viewportH: number): number {
  const u = zoneScale(viewportH)
  return Math.round(PEEK_BAND_H + OWN_ZONE_GAP * u + ownActionHeight(u))
}

/**
 * The blind clock, the level and the room's name, across the top.
 *
 * 44 and not 36, which is what this said while the DOM measured 44 — the help
 * and sound buttons are 44px targets and the row is as tall as they are. Eight
 * pixels of felt that the model was handing the table and the browser was not,
 * on every screen, in every hand.
 */
export const HEADER_H = 44

/** What the room keeps clear of its own edge, top and bottom. */
export const ROOM_PAD = 8

/** Between the three rows of the room: header, felt, your zone. */
export const ROOM_GAP = 8

/**
 * Everything the room spends before the table gets what is left.
 *
 * Written down because it was being *left out*. The check that says the
 * shortest phone we support still gets a table subtracted a header and your
 * zone and stopped there — no padding, no gaps, no safe area — so it was
 * measuring a room 29px roomier than any room that exists, and passing on the
 * strength of pixels the table never receives. Measured against the live DOM at
 * 320×568: header 36, padding 8 and 8, two gaps of 6.4.
 *
 * The gap scales with the controls (`--zu`); the padding does not.
 */
export function roomChrome(viewportH: number): number {
  return HEADER_H + ROOM_PAD * 2 + ROOM_GAP * zoneScale(viewportH) * 2
}

/** What is actually left for the felt, on a screen this tall. */
export function tableRoom(viewportH: number): number {
  return viewportH - roomChrome(viewportH) - ownZoneHeight(viewportH)
}

/**
 * What the controls cost however small they are drawn.
 *
 * The bar has always had a part that does not scale — a border is a border,
 * "2 BB" is 10px of type at any size, and the slider is 32px of track and thumb
 * whatever `--zu` says. The old model handled that by multiplying one number by
 * the scale and padding it: 152 × 0.8 predicted 122 for controls that measured
 * 119, and 152 × 1 reserved 152 for controls that measured 139. Thirteen
 * pixels of slack on a big phone and three on the phone that needs it — the
 * wrong way round, and slack the table was paying for either way.
 *
 * Measured on a live table, on your turn, with the sizes, the slider and the
 * three buttons — the tallest the column ever gets, because `PreActions`
 * renders nothing on your own turn and `ShowCards` only offers itself to
 * somebody who has folded, whose bar has no sizing row at all:
 *
 *     --zu 1.0 → 138.8      --zu 0.8 → 119.3
 *
 * Two points, one line: 41.3 fixed plus 97.5 that scales. Rounded up to 44 and
 * 100, which is five pixels of slack at both ends instead of thirteen at one
 * and two at the other.
 */
export const OWN_ACTION_FIXED = 44

/** …and what it costs on top of that, at full size. See {@link OWN_ACTION_FIXED}. */
export const OWN_ACTION_SCALED = 100

/**
 * Where the controls sit inside that zone while a hand is being played, on a
 * screen whose zone is drawn at `u`. See {@link zoneScale}.
 */
export function ownActionHeight(u: number): number {
  return OWN_ACTION_FIXED + OWN_ACTION_SCALED * u
}
export function tableScale(table: TableSize): number {
  return Math.max(MIN_SCALE, Math.min(1.25, table.w / REFERENCE_TABLE_W))
}
const REFERENCE_TABLE_W = 366

/**
 * What a seat is holding, which is what decides how tall it is.
 *
 * Three states, not two, and the third is the one that was missing: a player
 * who is sat out or already folded has no card block at all, so their seat is
 * shorter than everybody else's. A model in which every seat is the same height
 * is a model of a table nobody has ever sat at — and it hid a real bug, because
 * the search that places chips reads the seats around it, and a neighbour that
 * is shorter in life than on paper opens up a spot the model never offered.
 */
export type SeatHand = 'none' | 'down' | 'up'

export function estimateSeatSize({
  table,
  seats = 9,
  revealed = false,
  hand: handState,
}: {
  /** The table this seat is on. Everything is a share of it — see {@link tableScale}. */
  table: TableSize
  seats?: number
  /** A hand has been turned over, so the cards — and the seat — are bigger. */
  revealed?: boolean
  /** This seat in particular. Falls back to `revealed` for the whole table. */
  hand?: SeatHand
}): Size {
  const u = tableScale(table)
  // Nine plates are drawn smaller than six, and that is a separate decision
  // from the scale: nine of them have to share one ring however big the table
  // is, so it is a function of the table being *crowded*, not of it being
  // small. Both then scale together.
  const tight = crowded(seats)
  const plate = (tight ? 60 : 68) * u

  // Plus the half of the stack that hangs off the plate's corner.
  //
  // Only half: the chips rest *on* the corner rather than beside the plate,
  // which is what they do in front of a real player and — the part that decides
  // it — costs eight pixels of seat instead of twenty. Twenty does not fit;
  // nine plates that wide will not ring a phone-sized table, and the matrix
  // says so a hundred and forty different ways. Reserved whether or not this
  // player still has chips, because a box that changes width when the last one
  // goes in is a box everything else was placed against a moment ago.
  const w = plate + (CHIP_W / 2) * u

  // Measured off `player-seat.tsx`, which is the only place these come from:
  //
  //   hand peeking out from behind the avatar, less its negative margin
  // + the avatar, less its own
  // + the plate: padding, name, stack, border
  // + the position tag's row
  //
  // A turned-over hand is the case that breaks tables, because the cards go
  // from a marker to something that has to be read and the seat grows with
  // them. `revealed` is in the matrix for that reason.
  const state: SeatHand = handState ?? (revealed ? 'up' : 'down')
  const hand =
    state === 'none' ? 0 : state === 'up' ? (tight ? 18 : 24) : tight ? 6 : 7
  const avatar = tight ? 25 : 31
  // 8 of padding above, 3 below, a 9px name and an 11px stack figure at
  // `leading-tight`, and a pixel of border top and bottom: 8+3+11.25+13.75+2.
  //
  // Not a function of `tight`, which is what it used to be and what made this
  // wrong. Nothing inside the plate is: crowding takes the plate's *width* and
  // the avatar's diameter, and leaves the two lines of type alone, because a
  // name you cannot read is not a smaller seat, it is a seat with nobody in it.
  // The old 34 was four units short of every seat on a nine-handed table, and
  // four units short in the direction that makes the matrix optimistic.
  const plateH = 38
  const TAG = 11
  return { w, h: (hand + avatar + plateH + TAG) * u }
}

/**
 * The viewport where the table stops being a phone table.
 *
 * §1.4 said this had to be decided explicitly rather than discovered halfway
 * through, and here is the decision, with the working.
 *
 * There *was* a second table — `sm:aspect-[3/2] sm:max-w-3xl`, with `sm:w-28`
 * seats — and it does not work. Nine 112×124 seats will not fit on a 3:2
 * ellipse at any radius: the vertical room a landscape table has is smaller
 * than two seats stacked, so the pair flanking each side always overlaps, and
 * the radii that come closest do not even fit inside the table. It was never
 * visible because the geometry model only knew about the portrait table, which
 * is precisely the failure mode §1.4 warned about — the test guaranteed an
 * invariant for a table that was not the one being shipped.
 *
 * So there is **one table**, and a wide screen gets a *bigger* one rather than
 * a differently-shaped one. Same ellipse, same code path, one thing to reason
 * about — and the seats grow, which is what a big screen should buy.
 */
export const SM_BREAKPOINT = 640

/**
 * A community card, at `u === 1`.
 *
 * There used to be two sizes with a viewport breakpoint between them, which was
 * the wrong shape of answer: the board has to clear the seats, the seats are on
 * a ring that is a share of the table, so the board is a share of the table
 * too. One number that scales beats two numbers and a threshold, and it is why
 * `BIG_BOARD_AT` is gone.
 */
export const BOARD_CARD_W = 30
export const BOARD_CARD_H = 40

/**
 * How wide the table box is allowed to get, phone and desktop.
 *
 * The phone cap is high enough not to bite on any phone — a 430px screen should
 * get a 406px table, not a 384px one with twenty-two pixels of black either
 * side. It exists only so a tablet in portrait does not get a table the width of
 * the screen. Past `u`'s own ceiling the pieces stop growing anyway and the
 * extra width simply becomes more felt between the seats.
 */
const MAX_TABLE_W = 460
const MAX_TABLE_W_WIDE = 512

export function isWide(width: number): boolean {
  return width >= SM_BREAKPOINT
}

/**
 * The table box itself, for a given viewport.
 *
 * One shape at both breakpoints — see {@link SM_BREAKPOINT} for why — so this
 * is the only place the box is worked out and the component reads the same
 * numbers the test does.
 */
/**
 * The table's shape.
 *
 * Shorter than the 3:4.4 it was, and that is what fixes "the players at the top
 * are miles from the edge". The ring is a share of the *height*, so a taller
 * box puts the top and bottom seats further into the middle and leaves a band
 * of dead felt at each end — which is exactly what it looked like. 3:3.7 is the
 * shortest the matrix will take with nine plates on it, and it is close to the
 * prototype's own table zone.
 */
/**
 * How tall the table is allowed to be, as a multiple of its width.
 *
 * A *range*, not a number, and that is what the racetrack ring bought. With an
 * elliptical ring the table had exactly one shape that worked — a fifth of a
 * point either side of 3:3.8 and the seats started touching — so any height the
 * screen had spare had to be given to something else. On a stadium, extra height
 * becomes longer straights, so the seats spread out along them: the matrix is
 * clean from 1.3 to 1.6 and only stops because past that the board and the seats
 * on the straights start competing.
 *
 * So spare height now goes where it belongs, into the ring.
 */
export const ASPECT_MIN = 1.3
export const ASPECT_MAX = 1.6

/**
 * The table box, for the space it has been given.
 *
 * Takes the room rather than a viewport, because that is the honest input: the
 * table is one row of a screen that adds up, and what it can be is decided by
 * what the header and your own zone left behind. Fills that room as far as the
 * shape allows and no further.
 */
export function tableBox(width: number, available?: number): TableSize {
  const cap = width - RAIL_MARGIN * 2 >= SM_BREAKPOINT - 100 ? MAX_TABLE_W_WIDE : MAX_TABLE_W
  const byWidth = Math.min(cap, width - RAIL_MARGIN * 2)
  // The widest the table can be and still be at least ASPECT_MIN tall in the
  // room available. Without this a short screen would give a squat table the
  // ring cannot use.
  const byHeight = available != null ? available / ASPECT_MIN : Infinity
  const w = Math.max(1, Math.min(byWidth, byHeight))
  // Then take the height, up to what the shape allows.
  const h = available != null ? Math.min(available, w * ASPECT_MAX) : w * ASPECT_MAX
  return { w, h: Math.max(h, w * ASPECT_MIN) }
}

/**
 * The clear space kept either side of the table, for the plates to lean into.
 *
 * The seats at the waist of the ring sit up to eighteen pixels proud of the
 * table box — that is a plate resting on the rail, which is what a plate does.
 * But proud of the *box* is only fine if there is page left underneath it, and
 * with twelve pixels of page padding the flank plates were being clipped by the
 * edge of the screen. So the table gives up eight pixels of its own width to
 * buy them somewhere to lean. `poker-table.tsx` sets the same number as a
 * max-width, and this is the only place it is written down.
 */
export const RAIL_MARGIN = 12

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
 * The numbers are the ones the components actually render, and they are the
 * constants below rather than a copy of them in prose: `BOARD_CARD_W`×
 * `BOARD_CARD_H` for a card, `POT_W`/`POT_SIDE_W`×`POT_ROW_H` for the pills.
 * They were written out here as 24×32 and 96×34, which is what they were two
 * passes ago — the cards are 30×40 now and the pills 80/76×22 — and a comment
 * that names a number is a second copy of that number, which is why this one
 * points at the first copy instead.
 *
 * Guessing generously would be the worst of both worlds: it would make the
 * test fail on tables that are fine and pass on tables that are not.
 */
export function estimateCentreBox(
  table: TableSize,
  boardCards: number,
  {
    pots = 1,
    seats = 9,
  }: {
    /** How many pots are being shown. Side pots make the block taller. */
    pots?: number
    /** How many are round the table. A crowded one gets a flatter pot mound. */
    seats?: number
  } = {},
): Box {
  const u = tableScale(table)
  // The board scales with the table like everything else. It used to jump
  // between two fixed sizes at a viewport breakpoint, which meant a table that
  // shrank kept its board — and five cards that do not shrink on a table that
  // does is exactly how a three-handed table put its flank seats on the river.
  const cardW = BOARD_CARD_W * u
  const cardH = BOARD_CARD_H * u
  const cards = boardCards > 0 ? boardCards * cardW + (boardCards - 1) * 4 * u : 96 * u

  // The pots sit in a row and wrap, rather than stacking one per line — a
  // middle that grows sideways grows into felt, and one that grows downwards
  // grows into the seats.
  //
  // But only as wide as there actually is room for. The ring is at its
  // narrowest where the middle of the table is, and a row wide enough to look
  // comfortable is a row the flank seats are sitting on: at 320px the gap
  // between the two seats either side of the board is about 230px, and three
  // pills laid end to end are wider than that. So the row is capped, and the
  // third pot wraps to a second line instead of pushing into a chair.
  const rowMax = POT_ROW_MAX * u
  // A row of pots is one main pill and the rest a size down, which is how they
  // are drawn — and using the main pill's width for all of them reserved room
  // for a row that could never occur.
  const potW1 = POT_W * u
  const potWn = POT_SIDE_W * u
  // How many fit before the row wraps: the main pill, then as many side pills
  // as the rest of the row holds. Gaps go *between* items, so there are n-1 of
  // them and not n — counting one too many put the second pill on its own row
  // when it missed by a tenth of a pixel.
  const perRow = Math.max(1, 1 + Math.floor((rowMax - potW1) / (potWn + 4 * u)))
  const potRows = Math.ceil(pots / perRow)
  const potH = (potRows * 22 + (potRows - 1) * 4) * u
  // The mound of chips under the board. Always reserved, whether or not there
  // is a pot yet: a block that grows a row the first time somebody's bet is
  // collected is a block that everything else on the felt was placed against a
  // moment ago. See `potPileTall` for why it is one or two discs and not six.
  //
  // Two units of gap, not the eight between the other rows: chips resting at
  // the foot of the cards is what a table looks like, and it is also two units
  // the flanking seats get to keep. `poker-table.tsx` pulls it up with a
  // negative margin to match.
  const pileH = (stackHeight(potPileTall(seats)) + 2) * u
  const potW = Math.min(
    rowMax,
    potW1 + Math.max(0, pots - 1) * (potWn + 4 * u),
  )

  const w = Math.max(96 * u, cards, potW)
  // The voice, the pot and the board, with a gap between each — the three rows
  // `poker-table.tsx` draws, in the order it draws them.
  const h =
    (SAID_H + 8) * u + potH + 8 * u + (boardCards > 0 ? cardH : 20 * u) + pileH
  return boxAt({ x: table.w / 2, y: (table.h * LAYOUT.BOARD_CY) / 100 }, { w, h })
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

/**
 * The chips a bet is drawn with, and how tall that makes it.
 *
 * A bet is a short pile pushed onto the felt, not somebody's whole stack — six
 * discs is enough to read as "chips" and short enough that eight of them round
 * a phone-sized table still leave the board visible. `poker-table.tsx` passes
 * the same number to `ChipStack`, and the two have to agree or the drawing
 * stands on something the layout thought was empty.
 */
/**
 * Two, not six. A bet on the felt is a *gesture* — chips pushed forward with
 * the figure beside them — and the figure is what carries the amount. Six
 * seventeen-pixel discs is a tower thirty-five pixels tall in front of every
 * seat, and on a nine-handed phone that is the single biggest thing standing
 * between the seats and the board.
 */
export const BET_CHIPS = 2

/**
 * How many chips are drawn beside a seat.
 *
 * Three on a phone, and only on a wide screen does it become a real stack.
 * This is the one place the redesign had to give something up, and it is worth
 * saying why: at 320px with eight players, a seat, its bet and its stack do not
 * all fit on the felt, and the matrix says so in fourteen different ways. Of
 * the three, the stack is the one that is already written down — the number is
 * on the plate, an inch away — so the stack is what shrinks. The colours still
 * carry roughly how deep somebody is, which is the part you read across a table
 * rather than count.
 */
export function seatChips(table: TableSize): number {
  // The tallest a chip leader's stack may stand, in discs.
  //
  // This used to be five, capped at the height of the plate it leans on, and
  // that cap is what made every seat look the same. Five discs for somebody
  // with four times the table and three for somebody nearly out is a dynamic
  // range of *two chips* — and how deep everybody is happens to be the thing
  // you read across a table before you read any number on it.
  //
  // Ten is the height that fits without buying anything. The stack rises from
  // the plate's bottom corner up the seat's right-hand edge: ten discs is 53
  // units against the seat's 76, which clears the plate and stops below the
  // hand, in the column of empty space to the right of a centred avatar. It
  // costs no width — and width is what the ring cannot spare, because every
  // unit of it is nine plates leaning further over the rail.
  return table.w > MAX_TABLE_W ? 12 : 10
}



/**
 * A pot pill, and how wide a row of them may get.
 *
 * `POT_ROW_MAX` is the width of a five-card board, and that is the rule rather
 * than a number: the pot belongs to the cards above it, so a row of pots
 * reaching past the community cards is a row reaching into the felt the flank
 * seats sit on. Derived from the cards so the two cannot drift apart.
 *
 * `POT_W` and `POT_SIDE_W` are measured, not guessed, and the measuring went
 * in two rounds — which is worth one sentence rather than two paragraphs, both
 * of which used to be here and disagreed with each other.
 *
 * `POT_W` was 62 and the pill has never been 62 wide: as it stood it drew 84,
 * so the matrix that says nothing covers anything was checking a middle a
 * quarter narrower than the one on screen. Correcting it put the second pot on
 * a row of its own, and a second row in the middle of a nine-handed table costs
 * 19 units of height the ring does not have — the matrix found that
 * immediately, as two players' bets landing on each other. So the pill was
 * tightened (padding and gap) until two of them fit under the board, remeasured
 * at 79 and 74 against the live DOM, and given a unit of slack each. Past five
 * figures the number is shortened the way a bet is (`betLabel`), which is what
 * bounds the widest either can ever be.
 */
export const POT_W = 80
/** The same pill a size down, which is how side pots are drawn. */
export const POT_SIDE_W = 76
export const POT_ROW_MAX = BOARD_CARD_W * 5 + 4 * 4

/**
 * The mound of chips in the middle of the table.
 *
 * The pot used to be a number and nothing else, and a number is the one thing a
 * real table never uses to say how big a pot is — you read the pile. Worse, it
 * meant the chips people pushed in every street stopped existing the moment the
 * street closed: they left the felt in front of their owner and arrived
 * nowhere.
 *
 * It went inside the pot pill first, as one token disc, and that was the wrong
 * answer to the right complaint — a chip beside a number is a *label*, on a
 * felt already covered in labels. So it is a real mound, on the cloth, under
 * the board, where a dealer stacks one.
 *
 * **Wide, not tall.** Height in the middle of a table is what the flanking
 * seats are sitting in — the matrix says so a hundred and forty ways — and
 * width across the middle is free until `POT_ROW_MAX`. So a growing pot adds
 * *columns* rather than height, which is also what a dealer does with one: a
 * pot is never one tower, it is four short stacks pushed together.
 */
export const POT_PILE_COLUMNS = 4

/**
 * How tall the mound is, which depends on how many people are round it.
 *
 * Every unit of height in the middle of the table comes out of the lane the
 * flanking seats' chips have to fit in, and at seven or more that lane is
 * already the tightest thing on the felt — the matrix said so the moment this
 * row appeared, with a nine-handed bet landing on its neighbour. So a crowded
 * table gets a flatter pot. It is still chips and it still grows sideways;
 * it is one layer of them instead of two.
 */
export function potPileTall(seats: number): number {
  return crowded(seats) ? 1 : 2
}
/** How much of a column the one in front of it hides. A mound, not a row. */
export const POT_PILE_OVERLAP = 6

/**
 * The row the table's own voice sits in, above the pot.
 *
 * Always reserved, whether or not anything is being said. A block that grows
 * and shrinks every time somebody acts is a block that everything else on the
 * felt was placed against a moment ago — the bets in particular, which are
 * stepped off the middle. Sixteen units is the pill: a 10.5 line plus its
 * padding and border.
 */
export const SAID_H = 16

/** A bet on the felt: a pile of chips, a gap, and the figure beside it. */
export function estimateBetSize(amount: number, table: TableSize): Size {
  const u = tableScale(table)
  // The number at roughly 6.5px a glyph in the mono face used for it.
  const chars = Math.max(1, betLabel(amount).length)
  return { w: (CHIP_W + 6 + chars * 6.5) * u, h: stackHeight(BET_CHIPS) * u }
}

/** A chip, and how much of the one below it stays visible. See `chip-stack.tsx`. */
export const CHIP_W = 17
const CHIP_RISE = 4

function stackHeight(discs: number): number {
  return (Math.max(1, discs) - 1) * CHIP_RISE + CHIP_W
}

/** A stack of chips, near enough. See `chipStack` for where the height comes from. */
export function estimateStackSize(discs: number, table: TableSize): Size {
  const u = tableScale(table)
  return { w: CHIP_W * u, h: stackHeight(discs) * u }
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
  /**
   * The height the table has been given, in pixels.
   *
   * Optional, and when it is absent the table takes whatever height its own
   * shape implies — which is the old behaviour and is still right for the test
   * cases that are asking about width alone.
   */
  available?: number
  /** A hand has been turned over: seats are taller. */
  revealed?: boolean
  /**
   * What each seat is holding, by seat index — see {@link SeatHand}.
   *
   * Absent means every seat is the same, which is what this took for granted
   * before and is the one thing a real table never is.
   */
  hands?: SeatHand[]
  /** How many pots are on the table. More than one makes the middle taller. */
  pots?: number
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
  const { width, seats, board, revealed = false, pots = 1 } = input
  const table = tableBox(width, input.available)

  // Per seat, because a real table is never all one thing: some players are in
  // the hand, some folded two streets ago, some are sat out — and their seats
  // are three different heights.
  const seatBoxes = Array.from({ length: seats }, (_, i) =>
    seatBox(
      i,
      seats,
      table,
      estimateSeatSize({ table, seats, revealed, hand: input.hands?.[i] }),
    ),
  )
  const centre = estimateCentreBox(table, board, { pots, seats })

  const boxes: PlacedBox[] = [
    { what: 'centre', seat: null, box: centre },
    ...seatBoxes.map((box, seat) => ({ what: 'seat', seat, box })),
  ]

  // Bets: a chain, and then a repair for whoever the chain boxed in. See
  // `placeBets` — the same call the real table makes.
  const bets = input.bets ?? []
  const betSize = (i: number) =>
    (bets[i] ?? 0) > 0 ? estimateBetSize(bets[i]!, table) : null
  placeBets(seats, table, seatBoxes, centre, betSize).forEach((at, i) => {
    const size = betSize(i)
    if (!at || !size) return
    boxes.push({ what: 'bet', seat: i, box: boxAt(at, size) })
  })

  // No pass for the stacks, and that is the point.
  //
  // A player's own chips used to be placed the same way a bet is: given a size
  // and sent looking round the felt for a gap. It works, in the sense that it
  // never overlapped anything — and it looks wrong, because "somewhere with
  // room near seat 4" is not the same place twice and reads as loose change
  // dropped on the cloth rather than as somebody's stack. §1.6(b) of the plan
  // says it plainly: the stack hangs off the *plate*.
  //
  // So it does, now — inside `player-seat.tsx`, beside the plate, part of the
  // seat's own box. Which means it cannot float, cannot be covered, and needs
  // no pass here at all. `estimateSeatSize` carries its width.
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
