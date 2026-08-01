import { describe, expect, it } from 'vitest'

import { DEAL_CARD_MS, dealBeats, dealDurationMs } from '@/lib/deal'

describe('dealing round the table', () => {
  it('gives the first card to the seat after the button', () => {
    // The small blind, which is where a deal starts everywhere.
    const beats = dealBeats(6, 2)
    expect(beats[3][0]).toBe(0)
  })

  it('goes twice round, one card each time', () => {
    // Two at a time is what a card-room calls a misdeal.
    const beats = dealBeats(4, 0)
    expect(beats.map((b) => b.length)).toEqual([2, 2, 2, 2])
    expect(beats[1]).toEqual([0, 4 * DEAL_CARD_MS])
  })

  it('walks the ring in order, wrapping past the button', () => {
    const beats = dealBeats(4, 2)
    const firstPass = beats.map((b) => b[0] / DEAL_CARD_MS)
    // Button at 2, so: 3, 0, 1, 2.
    expect(firstPass).toEqual([1, 2, 3, 0])
  })

  it('pitches nothing at an empty chair', () => {
    const beats = dealBeats(4, 0, { dealtTo: (i) => i !== 2 })
    expect(beats[2]).toEqual([])
    // And the seats that are in the hand still get consecutive beats — a gap
    // where the missing player was would read as a dealer hesitating.
    const dealt = beats.flat().sort((a, b) => a - b)
    expect(dealt).toEqual([0, 1, 2, 3, 4, 5].map((n) => n * DEAL_CARD_MS))
  })

  it('deals nobody in at an empty table', () => {
    expect(dealBeats(0, 0)).toEqual([])
    expect(dealBeats(3, 0, { dealtTo: () => false })).toEqual([[], [], []])
  })

  it('finishes inside the shortest pause between hands', () => {
    // Two seconds, which is what a hand nobody showed gets. A deal still
    // arriving when the first player is already being asked to act is a table
    // asking for a decision about cards that have not landed.
    expect(dealDurationMs(9)).toBeLessThan(2000)
  })
})
