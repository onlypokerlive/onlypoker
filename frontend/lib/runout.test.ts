import { describe, expect, it } from 'vitest'

import {
  runoutDurationMs,
  runoutPauseSeconds,
  runoutStepMs,
  runoutSteps,
} from '@/lib/runout'

describe('runoutSteps', () => {
  it('does not animate an ordinary street', () => {
    // These arrive one at a time as players act. Pausing on them would put a
    // delay into every hand of the night.
    expect(runoutSteps(0, 3)).toEqual([])
    expect(runoutSteps(3, 4)).toEqual([])
    expect(runoutSteps(4, 5)).toEqual([])
  })

  it('does not animate a poll that changed nothing', () => {
    expect(runoutSteps(3, 3)).toEqual([])
    expect(runoutSteps(5, 5)).toEqual([])
  })

  it('walks a turn and river that arrived together', () => {
    expect(runoutSteps(3, 5)).toEqual([4, 5])
  })

  it('walks a whole board dealt in one go', () => {
    // Everyone all-in preflop: flop, turn and river land in a single update.
    expect(runoutSteps(0, 5)).toEqual([3, 4, 5])
  })

  it('walks a flop and turn that arrived together', () => {
    expect(runoutSteps(0, 4)).toEqual([3, 4])
  })

  it('ignores a board going backwards, which is the next hand starting', () => {
    expect(runoutSteps(5, 0)).toEqual([])
  })
})

describe('runoutStepMs', () => {
  it('holds each card long enough to register', () => {
    expect(runoutStepMs(3, 8)).toBe(800)
  })

  it('speeds up rather than getting dealt over', () => {
    // The server keeps counting down to the next hand while this plays, and it
    // has no idea we are mid-reveal.
    const fast = runoutStepMs(3, 2)
    expect(fast).toBeLessThan(800)
    expect(runoutDurationMs(3, 2)).toBeLessThan(2000)
  })

  it('always finishes before the next hand is dealt', () => {
    for (const autoDeal of [1, 2, 3, 5, 8, 12, 20]) {
      for (const steps of [2, 3]) {
        expect(runoutDurationMs(steps, autoDeal)).toBeLessThan(autoDeal * 1000)
      }
    }
  })

  it('stays watchable even on an absurdly short pause', () => {
    expect(runoutStepMs(3, 1)).toBeGreaterThanOrEqual(120)
  })
})

describe('runoutPauseSeconds', () => {
  it('paces off the deadline, not the setting', () => {
    // The server grants an all-in a longer pause than an ordinary hand, and
    // that allowance exists for this reveal. Reading the room's setting would
    // spend twelve seconds as if they were eight.
    expect(runoutPauseSeconds(1_000_000 + 12_000, 8, 1_000_000)).toBe(12)
  })

  it('falls back to the setting before a deadline has arrived', () => {
    expect(runoutPauseSeconds(null, 5)).toBe(5)
  })

  it('runs the reveal at its fastest when the deal is already due', () => {
    // Zero is a real answer, not a missing one: the next hand is on its way.
    // Falling back to the default here would deal the board over the reveal.
    expect(runoutPauseSeconds(1_000_000, 8, 1_005_000)).toBe(0)
    expect(runoutStepMs(3, 0)).toBe(120)
  })

  it('takes its time when the host is dealing by hand', () => {
    // Auto-deal off. Nothing is coming, so nothing is racing.
    expect(runoutPauseSeconds(null, 0)).toBe(Infinity)
    expect(runoutStepMs(3, Infinity)).toBe(800)
  })
})
