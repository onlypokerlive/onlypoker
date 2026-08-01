import { describe, expect, it } from 'vitest'

import {
  BET_MS,
  FLIGHT_MS,
  FLIGHT_STAGGER_MS,
  PAYOUT_MS,
  SWEEP_HOLD_MS,
  calledPart,
  centreOf,
  payoutFromPot,
  sweepLeadIn,
  sweepStart,
  sweepToPot,
} from '@/lib/chip-flight'

const POT = { x: 100, y: 100 }

describe('centreOf', () => {
  it('finds the middle of a measured box', () => {
    expect(centreOf({ left: 10, top: 20, right: 30, bottom: 60 })).toEqual({
      x: 20,
      y: 40,
    })
  })
})

describe('sweeping the bets into the middle', () => {
  const chips = [
    { key: 'far', at: { x: 100, y: 300 }, amount: 50 },
    { key: 'near', at: { x: 100, y: 140 }, amount: 100 },
    { key: 'mid', at: { x: 100, y: 200 }, amount: 75 },
  ]

  it('sends everything to the pot', () => {
    for (const flight of sweepToPot(chips, POT)) {
      expect(flight.to).toEqual(POT)
    }
  })

  it('starts each one where its chips were standing', () => {
    const flights = sweepToPot(chips, POT)
    const from = Object.fromEntries(flights.map((f) => [f.amount, f.from]))
    expect(from[50]).toEqual({ x: 100, y: 300 })
    expect(from[100]).toEqual({ x: 100, y: 140 })
  })

  it('leaves in the order they arrive, nearest first', () => {
    // Staggered by seat number instead, the group trails whoever happens to be
    // sitting furthest away and stops reading as one rake.
    const flights = sweepToPot(chips, POT)
    expect(flights.map((f) => f.amount)).toEqual([100, 75, 50])
    expect(flights.map((f) => f.delay)).toEqual([
      0,
      FLIGHT_STAGGER_MS,
      FLIGHT_STAGGER_MS * 2,
    ])
  })

  it('finishes well inside the shortest pause between hands', () => {
    // Two seconds, which is what a hand nobody showed gets. A sweep still in
    // the air when the next hand is dealt is chips arriving at a pot that has
    // already been won.
    const flights = sweepToPot(chips, POT)
    const last = Math.max(...flights.map((f) => f.delay + f.ms))
    expect(last).toBeLessThan(2000)
  })

  it('has nothing to do with an empty felt', () => {
    expect(sweepToPot([], POT)).toEqual([])
  })

  it('says it is money on its way into the middle', () => {
    // The mound stands down for whatever is still crossing towards it, and
    // this is how it knows. Without it the pot is drawn at its new size while
    // the chips that made it new are halfway there.
    for (const flight of sweepToPot(chips, POT)) expect(flight.toPot).toBe(true)
    expect(payoutFromPot(POT, [{ key: 'w', at: POT, amount: 1 }])[0].toPot).toBeFalsy()
  })

  it('shows chips that were already resting there from the off', () => {
    // A rake leaves in a stagger and the server clears the felt in one go, so
    // the third lot waits 160ms to depart with nothing drawing it: visible only
    // when it moves, the money is nowhere for those 160ms.
    for (const flight of sweepToPot(chips, POT, sweepStart(false))) {
      expect(flight.seenAt).toBe(0)
    }
  })

  it('waits for the closing bet to land before showing its chips', () => {
    // This one really is still in the air — its own flight is drawing it — so
    // showing it early is the same chips on screen twice.
    const [flight] = sweepToPot(
      [{ key: 'p1', at: { x: 100, y: 200 }, amount: 50, since: BET_MS }],
      POT,
      sweepStart(true),
    )
    expect(flight.seenAt).toBe(BET_MS)
    expect(flight.seenAt!).toBeLessThan(flight.delay)
  })

  it('gives each flight a key that changes when the money does', () => {
    // Two streets in a row where the same seat bets the same amount are two
    // different flights; a stable key would have React reuse the element and
    // the second one would never animate.
    const [first] = sweepToPot([{ key: 'a', at: POT, amount: 100 }], POT)
    const [second] = sweepToPot([{ key: 'a', at: POT, amount: 200 }], POT)
    expect(first.key).not.toBe(second.key)
  })
})

describe('the part of a bet that was actually called', () => {
  const felt = [
    { key: 'opener', amount: 200 },
    { key: 'shove', amount: 132 },
  ]

  it('gives the uncalled part back to whoever bet it', () => {
    // 200 out, called for 132, so 68 comes back before the street is
    // collected: the felt held 332 and the middle grew by 264.
    expect(calledPart(felt, 264)).toEqual([
      { key: 'opener', amount: 132 },
      { key: 'shove', amount: 132 },
    ])
  })

  it('leaves a fully called street alone', () => {
    expect(calledPart(felt, 332)).toBe(felt)
  })

  it('never takes it out of somebody who was called', () => {
    // Only the biggest bet can have an uncalled part — everybody else's was
    // called by definition, or it would not be everybody else's.
    const trimmed = calledPart(felt, 264)
    expect(trimmed.find((c) => c.key === 'shove')!.amount).toBe(132)
  })

  it('drops a bet that was not called at all', () => {
    // Everybody folded to an opener whose chips go straight back. Raked, they
    // were chips arriving at a pot that never grew.
    expect(calledPart([{ key: 'lonely', amount: 300 }], 0)).toEqual([])
  })

  it('has nothing to say about an empty felt', () => {
    expect(calledPart([], 0)).toEqual([])
  })
})

describe('paying the pot out', () => {
  it('sends it from the middle to the winner', () => {
    const seat = { x: 40, y: 300 }
    const [flight] = payoutFromPot(POT, [{ key: 'w', at: seat, amount: 900 }])
    expect(flight.from).toEqual(POT)
    expect(flight.to).toEqual(seat)
    expect(flight.ms).toBe(PAYOUT_MS)
  })

  it('pays a split pot at the same moment, not one after the other', () => {
    // A stagger makes the second winner look like an afterthought, and a chop
    // is one payment made twice.
    const flights = payoutFromPot(POT, [
      { key: 'a', at: { x: 0, y: 0 }, amount: 450 },
      { key: 'b', at: { x: 200, y: 0 }, amount: 450 },
    ])
    expect(flights.map((f) => f.delay)).toEqual([0, 0])
  })

  it('arches higher than a rake, because it is a push and not a sweep', () => {
    const [pay] = payoutFromPot(POT, [{ key: 'w', at: POT, amount: 1 }])
    const [rake] = sweepToPot([{ key: 'w', at: POT, amount: 1 }], POT)
    expect(pay.arc).toBeGreaterThan(rake.arc)
    expect(pay.ms).toBeGreaterThan(FLIGHT_MS)
  })
})

describe('the last bet of a street', () => {
  it('holds the rake back until the chips it is raking have landed', () => {
    // The street closes on the last player to act, so the server sweeps their
    // call in the same response that reports it. Raked without a pause, the
    // bet is pushed out and pulled in on the same frame — the one moment of a
    // betting round nobody can read.
    const started = sweepToPot(
      [{ key: 'p1', at: { x: 100, y: 200 }, amount: 50 }],
      POT,
      sweepStart(true),
    )
    expect(started[0].delay).toBe(BET_MS + SWEEP_HOLD_MS)
  })

  it('rakes at once when nothing had to land first', () => {
    expect(sweepToPot([{ key: 'p1', at: POT, amount: 50 }], POT, sweepStart(false))[0].delay)
      .toBe(0)
  })

  it('deals the next card into the rake rather than after it', () => {
    // A dealer's hands overlap. Waiting for the felt to be clear puts a dead
    // second in the middle of the street.
    expect(sweepLeadIn(true)).toBeGreaterThan(sweepStart(true))
    expect(sweepLeadIn(true)).toBeLessThan(sweepStart(true) + FLIGHT_MS)
    expect(sweepLeadIn(false)).toBeLessThan(FLIGHT_MS)
  })
})
