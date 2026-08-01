import { describe, expect, it } from 'vitest'

import { actionLine, latestLine } from '@/lib/action-line'
import type { TableAction } from '@/lib/poker-api'

const PLAYERS = [
  { id: 'me', name: 'You', isYou: true },
  { id: 'santi', name: 'Santi', isYou: false },
]

function action(overrides: Partial<TableAction> = {}): TableAction {
  return {
    seq: 1,
    handNumber: 1,
    playerId: 'santi',
    kind: 'check',
    amount: 0,
    to: 0,
    allIn: false,
    street: 'flop',
    auto: false,
    ...overrides,
  }
}

const line = (o: Partial<TableAction> = {}) => actionLine(action(o), PLAYERS)

describe('actionLine', () => {
  it('says the thing a polled table otherwise cannot say at all', () => {
    expect(line({ kind: 'check' })).toBe('Santi checks')
  })

  it('names a raise by the level it raises to, not by what it cost', () => {
    // "Raises 600" and "raises to 900" are different tables. The number
    // players answer is the one they have to match.
    expect(line({ kind: 'raise', amount: 600, to: 900 })).toBe('Santi raises to 900')
  })

  it('calls an opening bet a bet', () => {
    expect(line({ kind: 'bet', amount: 60, to: 60 })).toBe('Santi bets 60')
  })

  it('says all-in without losing whether it was a call or a raise', () => {
    expect(line({ kind: 'call', to: 900, allIn: true })).toBe('Santi calls 900 — all-in')
    expect(line({ kind: 'raise', to: 2400, allIn: true })).toBe(
      'Santi is all-in for 2,400',
    )
  })

  it('marks a decision nobody made', () => {
    // A fold that ran out of time and a fold somebody chose are the same chips
    // and a completely different moment — and it explains the pause.
    expect(line({ kind: 'fold', auto: true })).toBe('Santi folds (time)')
  })

  it('speaks to you in the second person', () => {
    expect(line({ playerId: 'me', kind: 'check' })).toBe('You check')
    expect(line({ playerId: 'me', kind: 'raise', to: 900 })).toBe('You raise to 900')
    expect(line({ playerId: 'me', kind: 'raise', to: 900, allIn: true })).toBe(
      'You are all-in for 900',
    )
  })

  it('names somebody it has never heard of rather than saying nothing', () => {
    // A player who left mid-hand is gone from `players` while their fold is
    // still the last thing that happened.
    expect(line({ playerId: 'ghost', kind: 'fold' })).toBe('Someone folds')
  })

  it('writes amounts the way they are said, not the way they are drawn', () => {
    // The pill on the felt shortens to "24.5k" because it is read at a glance
    // in a lane a few pixels wide. This is read once.
    expect(line({ kind: 'raise', to: 24_500 })).toBe('Santi raises to 24,500')
  })
})

describe('latestLine', () => {
  it('has nothing to say before anybody has done anything', () => {
    expect(latestLine([], PLAYERS)).toBeNull()
  })

  it('says only the last thing, not a feed', () => {
    const said = latestLine(
      [action({ seq: 1, kind: 'check' }), action({ seq: 2, kind: 'raise', to: 300 })],
      PLAYERS,
    )
    expect(said).toBe('Santi raises to 300')
  })
})
