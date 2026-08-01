import { describe, expect, it } from 'vitest'

import {
  boxAt,
  collisions,
  estimateStackSize,
  feltRadius,
  layoutTable,
  LAYOUT,
  overlaps,
  seatAxes,
  seatCentre,
  spotCost,
  stackOffset,
  type Box,
} from '@/lib/table-layout'

/** The phones this is actually played on. 320 is the floor we support. */
const WIDTHS = [320, 375, 390, 430]
const SEATS = [2, 3, 6, 9]
const BOARDS = [0, 3, 4, 5]

/** Everybody has bet, which is the state that fills the felt. */
const allBetting = (seats: number, amount = 1200) => Array.from({ length: seats }, () => amount)
const allStacked = (seats: number, discs = 8) => Array.from({ length: seats }, () => discs)

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
              bets: allBetting(seats),
              stacks: allStacked(seats),
            })
            expect(collisions(layout)).toEqual([])
          })
        }
      }
    }
  }

  // A table can only be squashed so far before nine seats start touching each
  // other: the ring gets shorter, the circumference goes with it, and the
  // boxes do not. This is the floor, and it is why the table keeps its aspect
  // ratio on a short phone and lets the page scroll instead.
  it('needs the height it asks for, and says so rather than degrading quietly', () => {
    const cramped = layoutTable({
      width: 375,
      height: 380,
      seats: 9,
      board: 5,
      bets: allBetting(9),
      stacks: allStacked(9),
    })
    expect(collisions(cramped).length).toBeGreaterThan(0)

    const enough = layoutTable({
      width: 375,
      height: 460,
      seats: 9,
      board: 5,
      bets: allBetting(9),
      stacks: allStacked(9),
    })
    expect(collisions(enough)).toEqual([])
  })

  it('holds when only some players have bet, which is most of a hand', () => {
    for (const width of WIDTHS) {
      for (const seats of SEATS) {
        const bets = Array.from({ length: seats }, (_, i) => (i % 2 === 0 ? 900 : 0))
        expect(
          collisions(layoutTable({ width, seats, board: 5, bets, stacks: allStacked(seats) })),
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
        bets: allBetting(9, 24_500),
        stacks: allStacked(9),
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
    expect(seatAxes(0, 2).left.x).toBeCloseTo(-1)
    expect(seatAxes(1, 2).left.x).toBeCloseTo(1)
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

describe('a stack of chips', () => {
  const table = { w: 360, h: 528 }
  const seats = 6
  const seatSize = { w: 68, h: 78 }
  const boxes = Array.from({ length: seats }, (_, i) =>
    boxAt(seatCentre(i, seats, table), seatSize),
  )

  it('is never above its own seat, which is where the cards are', () => {
    // The rule that cost three rounds. A stack over the cards covers the one
    // thing a seat exists to show.
    for (let i = 0; i < seats; i++) {
      const size = estimateStackSize(8)
      const at = stackOffset(i, seats, table, boxes, size, [])
      const own = boxes[i]
      const above = at.y + size.h / 2 < own.top
      expect(above).toBe(false)
    }
  })

  it('gets out of the way of a bet rather than sitting on it', () => {
    const size = estimateStackSize(8)
    const bare = stackOffset(0, seats, table, boxes, size, [])
    const inTheWay: Box = boxAt(bare, { w: size.w + 20, h: size.h + 20 })
    const moved = stackOffset(0, seats, table, boxes, size, [inTheWay])
    expect(overlaps(boxAt(moved, size), inTheWay)).toBe(false)
  })

  it('still answers when there is nowhere good left', () => {
    // A table with no clean spot has to degrade, not throw or land at some
    // arbitrary corner. Everything blocked: it still returns a real point.
    const size = estimateStackSize(8)
    const everywhere: Box = { left: -1000, top: -1000, right: 1000, bottom: 1000 }
    const at = stackOffset(0, seats, table, boxes, size, [everywhere])
    expect(Number.isFinite(at.x) && Number.isFinite(at.y)).toBe(true)
  })
})

describe('re-laying out', () => {
  // §1.3 lists board 3→5, seat count and viewport. The one everybody forgets
  // is a seat changing size, and it is the one that actually breaks things:
  // everything placed against a seat box is placed against a box that stops
  // existing the moment a hand is turned over.
  const at = (o: Parameters<typeof layoutTable>[0]) =>
    layoutTable(o).boxes.map((b) => `${b.what}${b.seat ?? ''}:${Math.round(b.box.left)},${Math.round(b.box.top)}`)

  const base = { width: 375, seats: 9, board: 3, bets: allBetting(9), stacks: allStacked(9) }

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
