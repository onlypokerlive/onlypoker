import { describe, expect, it } from 'vitest'

import {
  inBigBlinds,
  potAfterCall,
  presets,
  raiseToForFraction,
  snapToPreset,
  type SizingContext,
} from '@/lib/bet-sizing'

function ctx(overrides: Partial<SizingContext> = {}): SizingContext {
  return {
    bigBlind: 10,
    pot: 0,
    betsOnFelt: 0,
    callAmount: 0,
    myBet: 0,
    minRaise: 20,
    maxRaise: 1000,
    preflopUnopened: false,
    ...overrides,
  }
}

describe('potAfterCall', () => {
  it('adds back the chips still out on the felt', () => {
    // The server's `pot` excludes the current street on purpose, so a naive
    // read makes every postflop preset come out short.
    expect(potAfterCall(ctx({ pot: 60, betsOnFelt: 40, callAmount: 20 }))).toBe(120)
  })
})

describe('raiseToForFraction', () => {
  it('sizes a pot raise the way a poker player means it', () => {
    // 5/10 blinds, button opening: 15 on the felt, 10 to call. A pot-sized open
    // is 35 — the standard 3.5x.
    const c = ctx({ pot: 0, betsOnFelt: 15, callAmount: 10, myBet: 0 })
    expect(raiseToForFraction(c, 1)).toBe(35)
  })

  it('counts what you already have out on this street', () => {
    // Small blind with 5 already in, facing the big blind.
    const c = ctx({ pot: 0, betsOnFelt: 15, callAmount: 5, myBet: 5 })
    expect(raiseToForFraction(c, 1)).toBe(30)
  })

  it('rounds to a whole chip', () => {
    const c = ctx({ pot: 45, betsOnFelt: 0, callAmount: 0, myBet: 0 })
    expect(raiseToForFraction(c, 1 / 3)).toBe(15)
    expect(raiseToForFraction(c, 1 / 2)).toBe(23)
  })
})

describe('presets', () => {
  it('offers big-blind multiples when nobody has opened', () => {
    const c = ctx({ preflopUnopened: true, betsOnFelt: 15, callAmount: 10 })
    expect(presets(c).map((p) => p.label)).toEqual(['2x', '2.5x', '3x', 'All-in'])
    expect(presets(c).map((p) => p.amount)).toEqual([20, 25, 30, 1000])
  })

  it('switches to pot fractions once there is a raise to answer', () => {
    const c = ctx({
      preflopUnopened: false,
      pot: 0,
      betsOnFelt: 45,
      callAmount: 30,
      minRaise: 50,
    })
    expect(presets(c).map((p) => p.label)).toEqual(['⅓', '½', '¾', 'Pot', 'All-in'])
  })

  it('drops a size below the minimum raise instead of showing it dead', () => {
    // Pot of 100: a third of it is 33, which is not a legal raise here. The
    // rest are, so this really does discriminate.
    const c = ctx({ pot: 100, betsOnFelt: 0, callAmount: 0, minRaise: 40 })
    expect(presets(c).map((p) => p.amount)).toEqual([50, 75, 100, 1000])
    expect(presets(c).map((p) => p.label)).toEqual(['½', '¾', 'Pot', 'All-in'])
  })

  it('collapses a size you cannot afford into all-in', () => {
    // Short stack: every preset is above what is left, so only all-in survives.
    const c = ctx({ pot: 600, betsOnFelt: 0, callAmount: 0, minRaise: 20, maxRaise: 120 })
    expect(presets(c)).toEqual([{ label: 'All-in', amount: 120 }])
  })

  it('never offers a preset outside the legal window', () => {
    const c = ctx({ pot: 350, betsOnFelt: 80, callAmount: 40, minRaise: 90, maxRaise: 300 })
    for (const p of presets(c)) {
      expect(p.amount).toBeGreaterThanOrEqual(c.minRaise)
      expect(p.amount).toBeLessThanOrEqual(c.maxRaise)
    }
  })

  it('offers nothing when raising is impossible', () => {
    expect(presets(ctx({ maxRaise: 0 }))).toEqual([])
  })

  it('does not repeat the same amount twice', () => {
    const c = ctx({ pot: 20, betsOnFelt: 0, callAmount: 0, minRaise: 20, maxRaise: 30 })
    const amounts = presets(c).map((p) => p.amount)
    expect(new Set(amounts).size).toBe(amounts.length)
  })
})

describe('snapToPreset', () => {
  const list = [
    { label: '½', amount: 100 },
    { label: 'Pot', amount: 200 },
  ]

  it('pulls a near miss onto the preset', () => {
    expect(snapToPreset(103, list, 1000)).toBe(100)
  })

  it('leaves a deliberate odd number alone', () => {
    expect(snapToPreset(160, list, 1000)).toBe(160)
  })
})

describe('inBigBlinds', () => {
  it('keeps one decimal while the number is small', () => {
    expect(inBigBlinds(25, 10)).toBe('2.5 BB')
  })

  it('drops the decimal once it stops mattering', () => {
    expect(inBigBlinds(1240, 10)).toBe('124 BB')
  })

  it('says nothing without a big blind to divide by', () => {
    expect(inBigBlinds(100, 0)).toBe('')
  })
})
