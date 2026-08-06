import { describe, expect, it } from 'vitest'

import {
  HAND_LIT_DELAY_MS,
  HAND_LIT_STEP_MS,
  REVEAL_STEP_MS,
  boardWinner,
  litBeats,
  revealBeats,
  showdownDurationMs,
} from '@/lib/showdown'

const seat = (id: string) => ({ id })

describe('the order hands turn over in', () => {
  const table = [seat('a'), seat('b'), seat('c'), seat('d')]

  it('is the one the server sent, whatever order the seats are drawn in', () => {
    // The seats are rotated per viewer to put whoever is looking at the bottom.
    // The showdown is not: it is the same event for everybody at the table.
    expect(revealBeats(table, ['c', 'd', 'a', 'b'])).toEqual([
      2 * REVEAL_STEP_MS,
      3 * REVEAL_STEP_MS,
      0,
      REVEAL_STEP_MS,
    ])
  })

  it('gives two viewers of one table the same showdown', () => {
    const mine = [seat('c'), seat('d'), seat('a'), seat('b')]
    const yours = [seat('a'), seat('b'), seat('c'), seat('d')]
    const order = ['b', 'c', 'd', 'a']
    const beatFor = (seats: { id: string }[], id: string) =>
      revealBeats(seats, order)[seats.findIndex((s) => s.id === id)]
    for (const id of order) {
      expect(beatFor(mine, id)).toBe(beatFor(yours, id))
    }
  })

  it('never turns over a hand that is not in the order', () => {
    // The players who folded, and the beaten hands the rule lets muck. Both
    // reach the end holding cards nobody has any right to see.
    const beats = revealBeats([seat('a'), seat('b'), seat('c')], ['a', 'c'])
    expect(beats).toEqual([0, null, REVEAL_STEP_MS])
  })

  it('has nothing to show when nobody had to', () => {
    expect(revealBeats(table, [])).toEqual([null, null, null, null])
  })

  it('ignores somebody in the order who is no longer at the table', () => {
    // Busted and removed between the last bet and the showdown. Their slot in
    // the walk is still theirs — the hands after them do not shuffle up.
    const beats = revealBeats([seat('a'), seat('b')], ['gone', 'a', 'b'])
    expect(beats).toEqual([REVEAL_STEP_MS, 2 * REVEAL_STEP_MS])
  })
})

describe('lighting the winning five', () => {
  it('waits for the last hand to turn over before starting', () => {
    const lit = litBeats(['As', 'Ks', 'Qs', 'Js', 'Ts'], 3 * REVEAL_STEP_MS)
    expect(lit.get('As')).toBe(3 * REVEAL_STEP_MS + HAND_LIT_DELAY_MS)
  })

  it('lights them one at a time', () => {
    const lit = litBeats(['As', 'Ks'], 0)
    expect(lit.get('Ks')! - lit.get('As')!).toBe(HAND_LIT_STEP_MS)
  })

  it('lights nothing when the hand was never named', () => {
    // Two boards, or a pot won by folding: naming one hand would be picking one
    // to be wrong about.
    expect(litBeats(undefined, 0).size).toBe(0)
  })

  it('lights a card shared by two winning hands once', () => {
    // A chop on one board is two made hands built out of mostly the same five
    // cards. Lit twice, the board comes back on under the second hand.
    const lit = litBeats(['As', 'Ks', 'Qs', 'Js', 'Ts', 'As', 'Ks', 'Qs', 'Js', 'Ts'], 0)
    expect(lit.size).toBe(5)
    expect(lit.get('Ts')).toBe(HAND_LIT_DELAY_MS + 4 * HAND_LIT_STEP_MS)
  })
})

describe('the whole thing', () => {
  it('fits inside the pause a showdown gets', () => {
    // Nine seconds from the server, and more when there was an all-in. A
    // showdown still playing when the next hand is dealt is a showdown nobody
    // saw the end of.
    expect(showdownDurationMs(6)).toBeLessThan(9000)
    expect(showdownDurationMs(9)).toBeLessThan(9000)
  })
})

describe('when the hand has finished being told', () => {
  it('is over as soon as it starts when nobody showed down', () => {
    // A pot won by folding is over the moment it is won. There is nothing to
    // wait for, and making the winner wait for a showdown that never happened
    // is a second of the table looking at a pot nobody is taking.
    expect(showdownDurationMs(0)).toBeLessThanOrEqual(showdownDurationMs(2))
  })

  it('takes longer with nine hands than with two', () => {
    // The number the payout waits for. A fixed guess is wrong for one of them,
    // and the one it is wrong for is the full table — where the pot used to
    // cross the felt while four hands were still face down.
    expect(showdownDurationMs(9)).toBeGreaterThan(showdownDurationMs(2))
  })
})

describe('who took which board', () => {
  // The one thing dealing twice puts on the table that the stacks cannot say:
  // winning both and chopping both come out to the same chips.
  const results = [
    { cards: [], winners: ['Blinsky'] },
    { cards: [], winners: ['Andylon', 'Alvariki'] },
  ]

  it('names the winner of each board', () => {
    expect(boardWinner(results, 0)).toBe('Blinsky')
  })

  it('says a chop was a chop rather than listing everybody', () => {
    // Two names do not fit next to five cards on a 320px phone, and the
    // interesting fact about a split board is that it was split.
    expect(boardWinner(results, 1)).toBe('Split')
  })

  it('says nothing at all while the hand is still being played', () => {
    expect(boardWinner([], 0)).toBeNull()
    expect(boardWinner(results, 5)).toBeNull()
  })
})
