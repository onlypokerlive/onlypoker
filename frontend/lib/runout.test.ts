import { describe, expect, it } from 'vitest'

import { runoutDurationMs, runoutStepMs, runoutSteps } from '@/lib/runout'

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
