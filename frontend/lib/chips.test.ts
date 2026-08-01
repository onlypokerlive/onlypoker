import { describe, expect, it } from 'vitest'

import { chipBreakdown, chipColumn, chipStack, DENOMINATIONS } from '@/lib/chips'

const total = (amount: number, max?: number) =>
  chipBreakdown(amount, max).reduce((sum, g) => sum + g.value * g.count, 0)
const height = (amount: number, max?: number) =>
  chipBreakdown(amount, max).reduce((n, g) => n + g.count, 0)

describe('chipBreakdown', () => {
  it('adds up to what was bet', () => {
    for (const amount of [1, 5, 10, 30, 175, 900, 1000, 3650]) {
      expect(total(amount)).toBe(amount)
    }
  })

  it('never builds a tower of one colour when it does not have to', () => {
    // The thing that makes a drawn stack look wrong before anybody can say
    // why: at a real table the colours are how you read the size.
    const groups = chipBreakdown(630)
    expect(groups.length).toBeGreaterThan(1)
  })

  it('puts the big chips first', () => {
    const values = chipBreakdown(3650).map((g) => g.value)
    expect(values).toEqual([...values].sort((a, b) => b - a))
  })

  it('stays short enough to look at on a phone', () => {
    // 101 white chips is the right answer arithmetically and an unreadable
    // smear at 14 pixels a chip.
    for (const amount of [101, 999, 12_345, 250_000]) {
      expect(height(amount)).toBeLessThanOrEqual(12)
    }
  })

  it('rounds up rather than drawing nothing, once it has flattened', () => {
    // A bet that exists and renders as an empty space is the one error here
    // that reads as a broken app.
    const groups = chipBreakdown(250_000, 4)
    expect(groups.length).toBeGreaterThan(0)
    expect(total(250_000, 4)).toBeGreaterThanOrEqual(250_000)
  })

  it('has nothing to draw for nothing', () => {
    expect(chipBreakdown(0)).toEqual([])
    expect(chipBreakdown(-5)).toEqual([])
    expect(chipBreakdown(Number.NaN)).toEqual([])
  })

  it('only ever uses colours that exist', () => {
    const known = new Set<number>(DENOMINATIONS.map((d) => d.value))
    for (const amount of [7, 88, 4321, 99_999]) {
      for (const group of chipBreakdown(amount)) expect(known.has(group.value)).toBe(true)
    }
  })
})

describe('chipStack', () => {
  it('lays the big ones at the bottom', () => {
    const discs = chipStack(630)
    const values = discs.map((d) => d.value)
    expect(values).toEqual([...values].sort((a, b) => b - a))
  })

  it('gives one entry per disc', () => {
    expect(chipStack(300)).toHaveLength(height(300))
  })
})

describe('chipColumn', () => {
  it('paints a pile in the colours the amount is actually made of', () => {
    // 31,000 is mostly one 25,000 chip, so most of the pile is that colour —
    // by *value*, not by count. Counting discs instead would paint a deep
    // stack in the colour of its loose change.
    const pile = chipColumn(31_000, 10)
    expect(pile).toHaveLength(10)
    const biggest = pile.filter((d) => d.value === 25_000).length
    expect(biggest).toBeGreaterThan(5)
  })

  it('shows every denomination that is really in there, however small its share', () => {
    // The 25,000 chip is a fortieth of this pile by value and rounds to no
    // discs at all — but a stack with one in it should show it.
    const pile = chipColumn(26_000, 8)
    expect(pile.some((d) => d.value === 25_000)).toBe(true)
    expect(pile).toHaveLength(8)
  })

  it('draws exactly as many discs as it was asked for', () => {
    for (const amount of [1, 37, 900, 6_600, 31_000, 250_000]) {
      for (const n of [1, 2, 3, 5, 10, 12]) {
        expect(chipColumn(amount, n)).toHaveLength(n)
      }
    }
  })

  it('draws nothing for nothing', () => {
    expect(chipColumn(0, 6)).toEqual([])
    expect(chipColumn(5_000, 0)).toEqual([])
  })

  it('stacks biggest first, like anybody who has ever stacked chips', () => {
    const pile = chipColumn(6_600, 6)
    for (let i = 1; i < pile.length; i++) {
      expect(pile[i].value).toBeLessThanOrEqual(pile[i - 1].value)
    }
  })
})
