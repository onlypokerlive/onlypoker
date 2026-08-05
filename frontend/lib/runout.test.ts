import { describe, expect, it } from 'vitest'

import {
  RUNOUT_LEAD_IN_MS,
  RUNOUT_RIVER_EXTRA_MS,
  RUNOUT_STREET_MS,
  runoutBeats,
  runoutDurationMs,
  runoutPauseSeconds,
  runoutSteps,
} from '@/lib/runout'

/** The gaps between one card landing and the next, which is the pacing. */
const gaps = (beats: { at: number }[]) =>
  beats.slice(1).map((beat, i) => beat.at - beats[i].at)

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

describe('runoutBeats', () => {
  it('waits for the hands to be face up before the first card', () => {
    // The whole reason the run-out is worth watching: a board dealt out over
    // hole cards nobody has seen is three cards and no stakes.
    const handsUpMs = 840
    const beats = runoutBeats(0, 5, { pauseSeconds: 17, handsUpMs })
    expect(beats.map((b) => b.size)).toEqual([3, 4, 5])
    expect(beats[0].at).toBe(handsUpMs + RUNOUT_LEAD_IN_MS)
  })

  it('holds the card that decides it longest', () => {
    // Flop, then a beat, then the turn, then a longer beat, then the river.
    const beats = runoutBeats(0, 5, { pauseSeconds: 17 })
    expect(gaps(beats)).toEqual([RUNOUT_STREET_MS, RUNOUT_STREET_MS + RUNOUT_RIVER_EXTRA_MS])
  })

  it('is unhurried compared with an ordinary street', () => {
    // An ordinary street arrives while somebody is still deciding what to do
    // about it. This one arrives with every decision already made.
    expect(RUNOUT_STREET_MS).toBeGreaterThan(800)
  })

  it('speeds up rather than getting dealt over', () => {
    // The server keeps counting down to the next hand while this plays, and it
    // has no idea we are mid-reveal.
    const rushed = runoutBeats(0, 5, { pauseSeconds: 3 })
    expect(gaps(rushed)[0]).toBeLessThan(RUNOUT_STREET_MS)
    expect(runoutDurationMs(rushed)).toBeLessThan(3000)
  })

  it('always finishes before the next hand is dealt', () => {
    for (const autoDeal of [1, 2, 3, 5, 8, 12, 20]) {
      for (const [from, to] of [
        [0, 5],
        [0, 4],
        [3, 5],
      ] as const) {
        // Six hands turning over is the longest the board can be kept waiting,
        // and it still has to land before the deal does.
        for (const handsUpMs of [0, 2100]) {
          const beats = runoutBeats(from, to, { pauseSeconds: autoDeal, handsUpMs })
          expect(runoutDurationMs(beats)).toBeLessThan(
            Math.max(autoDeal * 1000, handsUpMs + 1000),
          )
        }
      }
    }
  })

  it('stays watchable even on an absurdly short pause', () => {
    const beats = runoutBeats(0, 5, { pauseSeconds: 0 })
    expect(beats[0].at).toBeGreaterThan(0)
    for (const gap of gaps(beats)) expect(gap).toBeGreaterThanOrEqual(120)
  })

  it('has nothing to say about an ordinary street', () => {
    expect(runoutBeats(0, 3, { pauseSeconds: 8 })).toEqual([])
    expect(runoutDurationMs([])).toBe(0)
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
  })

  it('is not racing a clock that has been stopped', () => {
    // A stopped table has no deadline *and* a non-zero setting, so reading the
    // setting as a floor said "eight seconds" about a table where the next hand
    // is not coming until somebody presses a button.
    expect(runoutPauseSeconds(null, 8, 1_000_000, true)).toBe(Infinity)
    expect(gaps(runoutBeats(0, 5, { pauseSeconds: runoutPauseSeconds(null, 8, 0, true) }))).toEqual(
      [RUNOUT_STREET_MS, RUNOUT_STREET_MS + RUNOUT_RIVER_EXTRA_MS],
    )
  })

  it('takes its time when the host is dealing by hand', () => {
    // Auto-deal off. Nothing is coming, so nothing is racing.
    expect(runoutPauseSeconds(null, 0)).toBe(Infinity)
    expect(gaps(runoutBeats(0, 5, { pauseSeconds: Infinity }))).toEqual([
      RUNOUT_STREET_MS,
      RUNOUT_STREET_MS + RUNOUT_RIVER_EXTRA_MS,
    ])
  })
})
