import { describe, expect, it } from 'vitest'

import {
  boxAt,
  collisions,
  feltRadius,
  layoutTable,
  MIN_TABLE_ROOM,
  LAYOUT,
  ownActionHeight,
  OWN_ZONE_GAP,
  OWN_ZONE_H,
  ownZoneHeight,
  roomChrome,
  tableRoom,
  PEEK_BAND_H,
  zoneScale,
  seatAxes,
  seatCentre,
  spotCost,
  type SeatHand,
  type TableLayout,
} from '@/lib/table-layout'

/**
 * The phones this is actually played on. Real device widths, not round numbers.
 *
 * This is a phone game before it is anything else, so the matrix is a list of
 * hardware rather than a sample of the number line — 393 (Pixel 7/8) and 412
 * (Pixel Pro, most Galaxies) sit between 390 and 430 and were never checked,
 * and a bug that only appears at 402 is a bug for everybody holding a Galaxy
 * S24. Round numbers are the widths a developer thinks of; these are the
 * widths that exist.
 *
 *   320  iPhone SE 1st gen, and the floor
 *   344  Galaxy S8/S9 and the narrow Androids
 *   360  the single most common Android width in the world
 *   375  iPhone SE 2/3, 6/7/8, X/XS, 13 mini
 *   384  Pixel 4a and friends
 *   390  iPhone 12/13/14, 16e
 *   393  Pixel 7/8/9, iPhone 14 Pro/15/16
 *   402  iPhone 16 Pro
 *   412  Pixel Pro, Galaxy S21–S24
 *   414  iPhone 6/7/8 Plus, XR, 11
 *   428  iPhone 12–14 Pro Max
 *   430  iPhone 15/16 Plus and Pro Max
 *   440  Galaxy S24 Ultra
 *   448  the widest phone anybody is holding
 *
 * The last four cross `sm:` and are the laptop end, kept because the table is
 * reachable there and a table nobody checked is a table that breaks.
 */
const WIDTHS = [
  320, 344, 360, 375, 384, 390, 393, 402, 412, 414, 428, 430, 440, 448, 640,
  768, 1024, 1280,
]
/**
 * Every seat count a real table passes through, not a sample of it.
 *
 * 1 happens between the last elimination and the podium; 4, 5, 7 and 8 are
 * every table on its way down from nine. Testing 2/3/6/9 tests the shapes
 * somebody happened to think of.
 */
const SEATS = [1, 2, 3, 4, 5, 6, 7, 8, 9]
const BOARDS = [0, 3, 4, 5]
/** One pot is the ordinary case; three is a hand with two all-ins in it. */
const POTS = [1, 2, 3]

/** Everybody has bet, which is the state that fills the felt. */
const allBetting = (seats: number, amount = 1200) => Array.from({ length: seats }, () => amount)

/**
 * The awkward table: some seats have not bet, some have shoved a five-figure
 * pill, and some are all in with nothing left to show beside them.
 *
 * Uniform tables are the easy case and were the only case being checked.
 */
const ragged = (seats: number) => ({
  bets: Array.from({ length: seats }, (_, i) => (i % 3 === 0 ? 0 : i % 2 ? 1200 : 24_500)),
})

describe('nothing covers anything', () => {
  // The reason this module exists. Ten rounds of checking this by hand in a
  // browser is what it replaces, and by hand it could never be asserted in CI.
  for (const width of WIDTHS) {
    for (const seats of SEATS) {
      for (const board of BOARDS) {
        for (const revealed of [false, true]) {
          it(`${width}px · ${seats} seats · board ${board}${revealed ? ' · hands shown' : ''}`, () => {
            const layout = layoutTable({
              width,
              seats,
              board,
              revealed,
              bets: allBetting(seats)
            })
            expect(collisions(layout)).toEqual([])
          })
        }
      }
    }
  }

  // Ragged tables and side pots, across the whole width range. Rolled into one
  // assertion per width rather than one per combination, or the matrix is
  // three thousand test names and nobody reads the output.
  for (const width of WIDTHS) {
    it(`${width}px · ragged bets, empty stacks and side pots`, () => {
      const bad: string[] = []
      for (const seats of SEATS) {
        for (const board of BOARDS) {
          for (const pots of POTS) {
            for (const revealed of [false, true]) {
              const layout = layoutTable({ width, seats, board, revealed, pots, ...ragged(seats) })
              for (const hit of collisions(layout)) {
                bad.push(`${seats} seats · board ${board} · ${pots} pots · ${hit}`)
              }
            }
          }
        }
      }
      expect(bad).toEqual([])
    })
  }

  // Seats of three different heights on one ring, which is what a table looks
  // like from the second street onwards: some players still holding cards, some
  // who folded, one showing a hand down. The matrix above draws every seat the
  // same height, and that is not a smaller version of this case — it is a
  // different one. A neighbour that is shorter in life than on paper opens a
  // spot the model never offered, and the chip search takes it.
  for (const width of WIDTHS) {
    it(`${width}px · seats of mixed heights, as a real table has`, () => {
      const bad: string[] = []
      for (const seats of SEATS) {
        for (const board of BOARDS) {
          // Every rotation, so no single arrangement of who folded can be the
          // one that happens to work.
          for (let turn = 0; turn < seats; turn++) {
            const hands: SeatHand[] = Array.from({ length: seats }, (_, i) => {
              const at = (i + turn) % 3
              return at === 0 ? 'none' : at === 1 ? 'down' : 'up'
            })
            // Only the players still holding cards have chips out in front.
            const bets = hands.map((h) => (h === 'none' ? 0 : 1200))
            const layout = layoutTable({ width, seats, board, hands, bets })
            for (const hit of collisions(layout)) {
              bad.push(`${seats} seats · board ${board} · turn ${turn} · ${hit}`)
            }
          }
        }
      }
      expect(bad).toEqual([])
    })
  }

  /**
   * The height the matrix never varied, and the one that decides everything.
   *
   * Every case above takes the default height for its width, so the whole
   * matrix was one shape per width — and the shape is what the ring and the
   * middle argue about. `pots: 3` was checked at that one height and at nine
   * seats in `nine(available)`, and between those two the eight-seat table on a
   * short screen was never looked at once.
   */
  const ROOM = [320, 340, 360, 380, 400, 440, 480, 520, 560, 600]

  /** Every seat count, pot count and height, at one width. */
  function everyShape(width: number, heights: number[]) {
    const out: { available: number; seats: number; pots: number; layout: TableLayout }[] = []
    for (const seats of SEATS) {
      for (const pots of POTS) {
        for (const available of heights) {
          out.push({
            available,
            seats,
            pots,
            layout: layoutTable({
              width, available, seats, board: 5, revealed: true, pots,
              bets: allBetting(seats),
            }),
          })
        }
      }
    }
    return out
  }

  for (const width of WIDTHS) {
    it(`${width}px · every height, three pots included`, () => {
      // Three pots at every height, which is the case the matrix had never
      // run: three pots are two rows in the middle, those rows come out of the
      // ring, and the ring is where the bets live. Until now `pots: 3` was
      // only ever checked at each width's default height, and at nine seats.
      const escaped: string[] = []
      const bad: string[] = []
      for (const { available, seats, pots, layout } of everyShape(width, ROOM)) {
        // A bet never leaves the table, at any height. The rule `spotCost`
        // states and `betSpot` did not implement: given a crowded ring the
        // search slid a pill up to thirty pixels past the edge of the table —
        // where it costs a little felt and nothing else — rather than graze a
        // neighbour. Its answer to a bet that would have been hard to read was
        // a bet that could not be seen at all.
        for (const { what, seat, box } of layout.boxes) {
          if (what !== 'bet') continue
          const by = Math.max(
            -box.left,
            -box.top,
            box.right - layout.table.w,
            box.bottom - layout.table.h,
          )
          if (by > 0.01) {
            escaped.push(`${available}px · ${seats} seats · bet${seat} by ${by.toFixed(1)}`)
          }
        }
        // And nothing covers anything, from 360 up. That floor is a boundary
        // rather than a convenience — the test below pins what happens under
        // it so nobody has to rediscover it.
        if (available < 360) continue
        for (const hit of collisions(layout)) {
          bad.push(`${available}px · ${seats} seats · ${pots} pots · ${hit}`)
        }
      }
      expect(escaped).toEqual([])
      expect(bad).toEqual([])
    })
  }

  it('names exactly what is still wrong below 360, rather than not looking', () => {
    // Not an aspiration and not a skip. Under 360 the middle and the ring run
    // out of room for each other, and the failure is entirely between *those
    // two* — the seats are on a fixed ring and the centre block grows a row —
    // which is a different repair from anything the bet search can do. A phone
    // reaches this: 320×568 leaves the table 323.
    //
    // Pinned so it can only get better. If a change fixes some of it this test
    // fails and the numbers come down; if a change makes it worse it fails and
    // says by how much.
    //
    // (The timeout below is not a hint that something is slow — it is that this
    // one `it` lays out every width against every sub-360 height against every
    // seat count and walks the collisions, and 5 seconds is a coin flip for it:
    // 2.5s on an idle machine and over 7 with anything else running, which is a
    // test that fails for reasons that have nothing to do with the code.)
    const seen: Record<string, number> = {}
    let deepest = 0
    let fewest = SEATS.length
    for (const width of WIDTHS) {
      for (const { available, seats, layout } of everyShape(
        width,
        ROOM.filter((h) => h < 360),
      )) {
        for (const hit of collisions(layout)) {
          // Named by what touched what, with the seat numbers dropped and the
          // two sides in a fixed order — `collisions` reports whichever it
          // reached first, and this is a claim about the pair.
          const kind = hit.replace(/\d+/g, '').split(' × ').sort().join(' × ')
          seen[kind] = (seen[kind] ?? 0) + 1
          deepest = Math.max(deepest, available)
          fewest = Math.min(fewest, seats)
        }
      }
    }
    expect(seen).toEqual({ 'centre × seat': 144, 'bet × seat': 54 })
    // Nothing under 340px of room, and never on a table small enough to play
    // three-handed on — it takes a crowded ring to run out of felt.
    expect(deepest).toBe(340)
    expect(fewest).toBe(5)
  }, 30_000)

  it('keeps everything on the table it was given', () => {
    // A stack pushed off the felt looking for room is a stack the player cannot
    // see, so nothing but a seat may leave the box at all.
    //
    // A seat may sit proud *sideways*, and only sideways. At the waist of the
    // table the rail is right there and the page has margin beyond it, so a
    // plate overlapping the wood is what a plate does at a real table. Off the
    // top or the bottom is different: that is the header above and the action
    // bar below, and a plate that goes there is a plate somebody cannot read.
    // The bottom seat is *you*, which is why this is asserted separately rather
    // than folded into one allowance.
    const sideways: string[] = []
    const endways: string[] = []
    for (const width of WIDTHS) {
      for (const seats of SEATS) {
        const layout = layoutTable({ width, seats, board: 5, pots: 2, ...ragged(seats) })
        for (const { what, seat, box } of layout.boxes) {
          const name = `${width}px ${what}${seat ?? ''}`
          const x = Math.max(-box.left, box.right - layout.table.w)
          const y = Math.max(-box.top, box.bottom - layout.table.h)
          if (x > (what === 'seat' ? 18 : 0)) sideways.push(`${name} by ${x.toFixed(0)}`)
          if (y > 0) endways.push(`${name} by ${y.toFixed(0)}`)
        }
      }
    }
    expect(sideways).toEqual([])
    expect(endways).toEqual([])
  })

  // The invariant that replaced the height floor.
  //
  // There used to be a *floor*: below some height nine seats started touching,
  // and the answer was "the table keeps its shape and the page scrolls". That
  // answer was wrong on a phone — a player who has to scroll to see the table
  // cannot see the table. Now the table fits whatever height it is handed and
  // everything on it shrinks with it, so the assertion is no longer "it needs
  // this much" but "give it anything and it still fits, and still holds".
  it('fits whatever height it is given, and still holds together', () => {
    const nine = (available: number) =>
      layoutTable({
        width: 375,
        available,
        seats: 9,
        board: 5,
        revealed: true,
        pots: 2,
        bets: allBetting(9),
      })
    // Every height a phone plausibly leaves for the table, from the tightest
    // one supported upward. Below `MIN_TABLE_ROOM` the scale floor starts
    // binding — the pieces stop shrinking so the names stay readable — and nine
    // seats begin to touch. That is a deliberate trade and it is why the number
    // exists: it is the budget the header and your own zone have to leave.
    for (const available of [MIN_TABLE_ROOM, 320, 360, 400, 440, 500, 600]) {
      const layout = nine(available)
      expect(collisions(layout)).toEqual([])
      // The whole point: it never takes more room than it was offered.
      expect(layout.table.h).toBeLessThanOrEqual(available + 0.5)
    }
    // And it does use the room when there is room — a table that stays small on
    // a big screen is the other half of the same bug.
    expect(nine(600).table.w).toBeGreaterThan(nine(MIN_TABLE_ROOM).table.w)
  })

  it('holds when only some players have bet, which is most of a hand', () => {
    for (const width of WIDTHS) {
      for (const seats of SEATS) {
        const bets = Array.from({ length: seats }, (_, i) => (i % 2 === 0 ? 900 : 0))
        expect(
          collisions(layoutTable({ width, seats, board: 5, bets })),
        ).toEqual([])
      }
    }
  })

  it('holds for a five-figure raise, which is a much wider pill', () => {
    // "24,500" is half again the width of a blind, and a chip stepped off a
    // guessed width sits on the seat it was meant to clear.
    for (const width of WIDTHS) {
      const layout = layoutTable({
        width,
        seats: 9,
        board: 5,
        bets: allBetting(9, 24_500)
      })
      expect(collisions(layout)).toEqual([])
    }
  })
})

describe('the ring', () => {
  it('puts you at the bottom, whatever the table size', () => {
    for (const seats of SEATS) {
      const table = { w: 360, h: 528 }
      const you = seatCentre(0, seats, table)
      expect(you.x).toBeCloseTo(table.w / 2)
      expect(you.y).toBeGreaterThan(table.h / 2)
    }
  })

  it("knows which way is a player's own left all the way round", () => {
    // The bottom seat's left is screen-left; the seat opposite them is facing
    // the other way, so their left is screen-right. Collapsing this to a
    // screen direction is what puts one player's chips on the wrong side.
    const table = { w: 360, h: 456 }
    expect(seatAxes(0, 2, table).left.x).toBeCloseTo(-1)
    expect(seatAxes(1, 2, table).left.x).toBeCloseTo(1)
  })
})

describe('the felt', () => {
  it('calls the middle the middle and the rail the rail', () => {
    const table = { w: 360, h: 528 }
    expect(feltRadius({ x: 180, y: 264 }, table)).toBeCloseTo(0)
    expect(feltRadius({ x: 180 + (360 / 2 - LAYOUT.BAIZE_INSET), y: 264 }, table)).toBeCloseTo(1)
  })
})

describe('the cost function', () => {
  const table = { w: 360, h: 528 }
  const middle = { x: 180, y: 264 }

  it('would rather graze the wood than cover something', () => {
    // The whole reason this is a cost and not an if-cascade. Without it, a
    // 375px phone with five cards out drops the flank stacks onto the board.
    const covering = spotCost(boxAt(middle, { w: 20, h: 20 }), [boxAt(middle, { w: 60, h: 60 })], table)
    const grazing = spotCost(boxAt({ x: 180, y: 40 }, { w: 20, h: 20 }), [], table)
    expect(covering).toBeGreaterThan(grazing)
  })

  it('costs nothing to sit in the clear, in the middle of the cloth', () => {
    expect(spotCost(boxAt(middle, { w: 20, h: 20 }), [], table)).toBe(0)
  })

  it('gets worse the further over the rail it goes, rather than snapping', () => {
    const near = spotCost(boxAt({ x: 180, y: 30 }, { w: 20, h: 20 }), [], table)
    const far = spotCost(boxAt({ x: 180, y: -30 }, { w: 20, h: 20 }), [], table)
    expect(far).toBeGreaterThan(near)
  })
})

describe('re-laying out', () => {
  // §1.3 lists board 3→5, seat count and viewport. The one everybody forgets
  // is a seat changing size, and it is the one that actually breaks things:
  // everything placed against a seat box is placed against a box that stops
  // existing the moment a hand is turned over.
  const at = (o: Parameters<typeof layoutTable>[0]) =>
    layoutTable(o).boxes.map((b) => `${b.what}${b.seat ?? ''}:${Math.round(b.box.left)},${Math.round(b.box.top)}`)

  const base = {
    width: 375,
    seats: 9,
    board: 3,
    bets: allBetting(9)
  }

  it('moves things when the board grows', () => {
    expect(at({ ...base, board: 5 })).not.toEqual(at(base))
  })

  it('moves things when the table empties', () => {
    expect(at({ ...base, seats: 6 })).not.toEqual(at({ ...base, seats: 9 }).slice(0, 1))
  })

  it('moves things when the phone does', () => {
    expect(at({ ...base, width: 430 })).not.toEqual(at(base))
  })

  it('moves things when a hand is turned over and a seat grows', () => {
    expect(at({ ...base, revealed: true })).not.toEqual(at(base))
  })
})

describe('the rule: the table is the constant', () => {
  it('reserves your zone the tallest state it ever holds', () => {
    // The peek band and the full action controls, with the gap between them.
    // Anything less and the normal case — a hand being played, on your turn —
    // is a scroller, which is the state this whole reservation exists to stop
    // being paid for out of the table.
    //
    // This is three constants agreeing with each other and it is worth exactly
    // that much: it passed for the whole time the browser was clipping 16.7px
    // off the top of the peek band, because nothing here has ever measured a
    // browser. What the reservation is really checked against is
    // `e2e/your-zone-fits.spec.ts`, which lays the page out at five phone
    // sizes and reads the band's top edge off the DOM. Kept because the two
    // answer different questions — this one says the arithmetic is coherent,
    // that one says the arithmetic is true.
    expect(OWN_ZONE_H).toBeGreaterThanOrEqual(PEEK_BAND_H + OWN_ZONE_GAP + ownActionHeight(1))
  })

  it('keeps the same slack at both ends of the range', () => {
    // The controls have a part that does not scale — borders, 10px type, and
    // 32px of slider track whatever `--zu` says — so a reservation that is one
    // number times the scale is generous where it does not matter and thin
    // where it does. The old one reserved 152 for controls that measure 138.8
    // at full size, and 121.6 for the same controls at 119.3 on the shortest
    // phone: thirteen pixels of room on the phone with room to spare, and 2.3
    // on the one without.
    const need = (u: number) => 41.3 + 97.5 * u // measured; see OWN_ACTION_FIXED
    for (const u of [0.8, 0.9, 1]) {
      const slack = ownActionHeight(u) - need(u)
      expect(slack).toBeGreaterThan(2)
      expect(slack).toBeLessThan(8)
    }
  })

  it('leaves the shortest phone supported a table it can still draw', () => {
    // 568px of viewport, less *everything the room spends first*. This used to
    // subtract a header and the zone and stop there, which credited the table
    // with 29px of padding, gaps and safe area it never receives — a check
    // measuring a room that does not exist. Verified against the live DOM at
    // 320×568, where the felt row comes out at 312 — with the header counted
    // at the 44 it measures rather than the 36 it used to claim.
    expect(tableRoom(568)).toBeGreaterThan(MIN_TABLE_ROOM)
    expect(Math.round(tableRoom(568))).toBe(312)
  })

  it('spends the same chrome at every size, and the table takes the difference', () => {
    // The other half of the constancy rule. Two phones get two tables; one
    // phone gets one table, whatever it is being asked.
    for (const h of [568, 640, 700, 812, 900, 1000]) {
      expect(tableRoom(h)).toBe(h - roomChrome(h) - ownZoneHeight(h))
      expect(tableRoom(h)).toBeGreaterThan(MIN_TABLE_ROOM - 20)
    }
    expect(tableRoom(812)).toBeGreaterThan(tableRoom(568))
  })

  it('draws the controls smaller on a short screen and full size on a tall one', () => {
    // Buttons that big next to a table that small is not a table with controls
    // under it. The floor is a 52px button drawn at 42, which is still a
    // target — below that the table stops being what gives.
    expect(zoneScale(812)).toBe(1)
    expect(zoneScale(568)).toBeLessThan(1)
    expect(zoneScale(568)).toBeGreaterThanOrEqual(0.8)
    expect(ownZoneHeight(568)).toBeLessThan(ownZoneHeight(812))
    // Continuous, not a breakpoint: a phone one pixel taller is not a phone
    // with different buttons.
    expect(zoneScale(700)).toBeGreaterThan(zoneScale(650))
  })

  it('never shrinks the pocket your cards slide out of', () => {
    // The band is 54 for a 48px card with clearance. Scaled to 44 it clips the
    // card at the one frame the whole gesture exists for.
    expect(ownZoneHeight(568) - PEEK_BAND_H).toBeGreaterThan(0)
    expect(ownZoneHeight(400)).toBeGreaterThan(PEEK_BAND_H)
  })
})
