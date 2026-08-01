import { describe, expect, it } from 'vitest'

import { closedByABet, diffViews, potGrowth, type TableEvent } from '@/lib/table-events'
import { gameView as view } from '@/lib/test-fixtures'
import type { GameView, PlayerView, TableAction } from '@/lib/poker-api'

/** Same players, with a patch applied to one of them. */
function withPlayer(v: GameView, id: string, patch: Partial<PlayerView>): GameView {
  return { ...v, players: v.players.map((p) => (p.id === id ? { ...p, ...patch } : p)) }
}

function diff(a: GameView | null, b: GameView): TableEvent[] {
  return diffViews(a, b)
}

describe('diffViews', () => {
  it('says nothing about the first view it ever sees', () => {
    // Walking up to a table already mid-hand is not a hand being dealt. Firing
    // on the first view plays every sound the app has, at once, on arrival.
    expect(diff(null, view({ board: ['As', 'Kd', '7h'], pot: 120 }))).toEqual([])
  })

  it('says nothing when a poll changes nothing', () => {
    const v = view()
    expect(diff(v, { ...v })).toEqual([])
  })

  it('reports a new deal', () => {
    expect(diff(view({ handNumber: 1 }), view({ handNumber: 2 }))).toContain('deal')
  })

  it('does not call a new deal a new street', () => {
    // A deal clears the board; the board growing from nothing must not read as
    // a flop on top of the deal.
    const events = diff(
      view({ handNumber: 1, board: ['As', 'Kd', '7h'] }),
      view({ handNumber: 2, board: [] }),
    )
    expect(events).toEqual(['deal'])
  })

  it('reports the flop landing', () => {
    expect(diff(view(), view({ board: ['As', 'Kd', '7h'] }))).toContain('street')
  })

  it('reports your turn arriving, once', () => {
    const before = view({ actorId: 'p1' })
    const mine = view({ actorId: 'me' })
    expect(diff(before, mine)).toContain('yourTurn')
    // The next poll still has you to act; it is the same turn, not a new one.
    expect(diff(mine, view({ actorId: 'me' }))).not.toContain('yourTurn')
  })

  it('reports chips going in', () => {
    const before = view()
    const after = withPlayer(view(), 'p1', { bet: 30 })
    expect(diff(before, after)).toContain('chips')
  })

  it('does not read the next hand’s blinds as a bet on this one', () => {
    const before = withPlayer(view({ handNumber: 1 }), 'p1', { bet: 300 })
    const after = withPlayer(view({ handNumber: 2 }), 'p1', { bet: 10 })
    expect(diff(before, after)).not.toContain('chips')
  })

  it('reports the pot being won', () => {
    expect(diff(view({ phase: 'hand' }), view({ phase: 'handover' }))).toContain('potWon')
  })

  it('reports the blinds going up', () => {
    expect(diff(view({ bigBlind: 10 }), view({ bigBlind: 20 }))).toContain('levelUp')
  })

  it('reports an elimination once, not on every poll after it', () => {
    const before = view()
    const after = withPlayer(view(), 'p1', { out: true, chips: 0 })
    expect(diff(before, after)).toContain('elimination')
    expect(diff(after, { ...after })).not.toContain('elimination')
  })

  it('reports the tournament ending', () => {
    expect(diff(view({ phase: 'handover' }), view({ phase: 'finished' }))).toContain(
      'tournamentEnd',
    )
  })
})

function action(overrides: Partial<TableAction> = {}): TableAction {
  return {
    seq: 1,
    handNumber: 1,
    playerId: 'p1',
    kind: 'check',
    amount: 0,
    to: 0,
    allIn: false,
    street: 'flop',
    auto: false,
    ...overrides,
  }
}

describe('what the server wrote down', () => {
  it('reports a check, which no diff of two views could ever find', () => {
    // The whole reason the log exists. Identical tables either side of it.
    const before = view()
    const after = view({ actions: [action({ seq: 4, kind: 'check' })] })
    expect(diff(before, after)).toContain('check')
  })

  it('does not report the same action twice however often it is polled', () => {
    const first = view({ actions: [action({ seq: 4, kind: 'check' })] })
    const again = view({ actions: [action({ seq: 4, kind: 'check' })] })
    expect(diff(first, again)).not.toContain('check')
  })

  it('reports both of two decisions taken between two polls', () => {
    // At 1.2 seconds a round of pre-actions resolves several before anybody
    // asks again. Counting on "one new action per poll" drops all but the last.
    const before = view({ actions: [action({ seq: 4, kind: 'check' })] })
    const after = view({
      actions: [
        action({ seq: 4, kind: 'check' }),
        action({ seq: 5, kind: 'check', playerId: 'p2' }),
        action({ seq: 6, kind: 'fold', playerId: 'p3' }),
      ],
    })
    expect(diff(before, after)).toEqual(expect.arrayContaining(['check', 'fold']))
  })

  it('keeps counting across a deal, which clears the list but not the count', () => {
    const before = view({ handNumber: 1, actions: [action({ seq: 9 })] })
    const after = view({
      handNumber: 2,
      actions: [action({ seq: 10, handNumber: 2, kind: 'check' })],
    })
    expect(diff(before, after)).toContain('check')
  })

  it('tells a raise from a call', () => {
    const before = view()
    expect(
      diff(before, view({ actions: [action({ seq: 2, kind: 'raise', to: 900 })] })),
    ).toContain('raise')
    expect(
      diff(before, view({ actions: [action({ seq: 2, kind: 'call', to: 300 })] })),
    ).toContain('chips')
  })

  it('calls an all-in an all-in whichever decision got there', () => {
    const before = view()
    const after = view({ actions: [action({ seq: 2, kind: 'call', allIn: true })] })
    expect(diff(before, after)).toContain('allIn')
    expect(diff(before, after)).not.toContain('chips')
  })

  it('does not also fire the old guess when the server has spoken', () => {
    // Both paths running would play a call twice: once off the log and once
    // off the chips appearing on the felt.
    const before = view()
    const after = withPlayer(
      view({ actions: [action({ seq: 2, kind: 'call', to: 30 })] }),
      'p1',
      { bet: 30 },
    )
    expect(diff(before, after).filter((e) => e === 'chips')).toHaveLength(1)
  })

  it('does not replay decisions when a slow poll puts an older table back', () => {
    // Two requests in flight, the older one answering last. Measuring "already
    // seen" against whatever view happens to be on screen replays everything
    // in between — every check and every raise, a second time.
    const stale = view({ actions: [action({ seq: 4 })] })
    const fresh = view({
      actions: [action({ seq: 4 }), action({ seq: 5, kind: 'raise', to: 300 })],
    })
    expect(diffViews(stale, fresh)).toContain('raise')
    // Same pair again, now that the client has said it got as far as seq 5.
    expect(diffViews(stale, fresh, 5)).not.toContain('raise')
  })

  it('still reports anything past the high-water mark', () => {
    const stale = view({ actions: [action({ seq: 4 })] })
    const fresh = view({
      actions: [action({ seq: 5, kind: 'raise' }), action({ seq: 6, kind: 'fold' })],
    })
    expect(diffViews(stale, fresh, 5)).toEqual(expect.arrayContaining(['fold']))
    expect(diffViews(stale, fresh, 5)).not.toContain('raise')
  })

  it('reports the street being swept up, and does not mistake a deal for it', () => {
    const betting = withPlayer(view({ pot: 0 }), 'p1', { bet: 30 })
    const swept = view({ pot: 60, board: ['As', 'Kd', '7h'] })
    expect(diff(betting, swept)).toContain('potCollect')
    // A deal also clears the felt, and is not a street closing.
    expect(diff(betting, view({ handNumber: 2, pot: 15 }))).not.toContain('potCollect')
  })

  it('reports it even when the next street is already being bet into', () => {
    // The case that made this almost never fire. Two polls are 1.2 seconds
    // apart and the table does not wait: by the response that carries the new
    // board, somebody has usually already led out. Requiring the felt to be
    // *empty* meant waiting for a snapshot of the table standing still, which
    // on a live table almost never arrives — so the street closed in silence
    // and the chips never went anywhere.
    const betting = withPlayer(view({ pot: 0 }), 'p1', { bet: 30 })
    const nextStreet = withPlayer(view({ pot: 60, board: ['As', 'Kd', '7h'] }), 'p2', {
      bet: 50,
    })
    expect(diff(betting, nextStreet)).toContain('potCollect')
  })

  it('does not mistake somebody folding for the street closing', () => {
    // Folding takes a player out and leaves the pot exactly where it was.
    const before = withPlayer(view({ pot: 60 }), 'p1', { bet: 30 })
    const after = withPlayer(view({ pot: 60 }), 'p1', { bet: 30, folded: true })
    expect(diff(before, after)).not.toContain('potCollect')
  })

  it('reports the last street of the hand, which the pot cannot report itself', () => {
    // Settling sweeps the bets in and pushes them to the winner in the same
    // breath, so `pot` comes back as zero rather than as anything — and every
    // hand ever played ended with its final bets simply ceasing to exist.
    const river = withPlayer(view({ pot: 100 }), 'p1', { bet: 40 })
    const settled = view({ phase: 'handover', pot: 0, potAtEnd: 180 })
    expect(diff(river, settled)).toContain('potCollect')
  })

  it('says nothing about a last street that was checked through', () => {
    // Nothing went in, so nothing is raked. The middle is the same middle it
    // was a moment ago and a sound there is a sound about no event.
    const river = view({ pot: 180 })
    const settled = view({ phase: 'handover', pot: 0, potAtEnd: 180 })
    expect(diff(river, settled)).not.toContain('potCollect')
  })

  it('reports it on the hand that ends the tournament too', () => {
    // The last hand of the night goes straight from `hand` to `finished`, and
    // it is the most-watched hand there is.
    const river = withPlayer(view({ pot: 100 }), 'p1', { bet: 40 })
    const done = view({ phase: 'finished', pot: 0, potAtEnd: 180 })
    expect(diff(river, done)).toContain('potCollect')
  })
})

describe('how much went into the middle', () => {
  // The same question `potCollect` asks, answered with a number rather than a
  // yes — because the chips crossing the felt have to add up to it. Drawn from
  // the bets alone they did not: an uncalled bet is still on the felt and is
  // never going in.
  it('is what the pot grew by', () => {
    expect(potGrowth(view({ pot: 100 }), view({ pot: 340 }))).toBe(240)
  })

  it('is what the middle came to, on the street that settles the hand', () => {
    const river = withPlayer(view({ pot: 100 }), 'p1', { bet: 40 })
    expect(potGrowth(river, view({ phase: 'handover', pot: 0, potAtEnd: 180 }))).toBe(80)
  })

  it('is nothing across a deal, and nothing on the first view', () => {
    expect(potGrowth(view({ handNumber: 1, pot: 300 }), view({ handNumber: 2, pot: 15 }))).toBe(0)
    expect(potGrowth(null, view({ pot: 300 }))).toBe(0)
  })

  it('never goes backwards', () => {
    // A slow poll landing after a fast one puts an older table on screen. A
    // negative rake is chips leaving the middle for the felt.
    expect(potGrowth(view({ pot: 340 }), view({ pot: 100 }))).toBe(0)
  })
})

describe('a street that closed on the last player calling', () => {
  const betting = withPlayer(view({ pot: 0 }), 'p1', { bet: 30 })

  it('spots the bet that was raked in the same breath as it was made', () => {
    // The one decision in every betting round that ends it was also the one
    // that never showed any chips moving: the server sweeps it before the
    // client hears about it, so the felt the view describes is already empty.
    const closed = view({
      pot: 90,
      board: ['As', 'Kd', '7h'],
      actions: [action({ seq: 2, playerId: 'p2', kind: 'call', amount: 30, to: 30 })],
    })
    expect(closedByABet(betting, closed)).toBe(true)
  })

  it('says no when the bet is still standing on the felt', () => {
    // Drawn a poll ago and resting where it landed. There is a rake left to
    // do and nothing to wait for.
    const closed = withPlayer(
      view({ pot: 90, board: ['As', 'Kd', '7h'] }),
      'p2',
      { bet: 30 },
    )
    expect(
      closedByABet(betting, {
        ...closed,
        actions: [action({ seq: 2, playerId: 'p2', kind: 'call', amount: 30, to: 30 })],
      }),
    ).toBe(true)
    // …and with the action already known, there is nothing new to wait for.
    expect(closedByABet({ ...betting, actions: closed.actions }, closed)).toBe(false)
  })

  it('says no when the street closed on a check', () => {
    const checked = view({
      pot: 60,
      board: ['As', 'Kd', '7h'],
      actions: [action({ seq: 2, playerId: 'p2', kind: 'check' })],
    })
    expect(closedByABet(betting, checked)).toBe(false)
  })

  it('says no when no street closed at all', () => {
    const called = withPlayer(
      view({
        pot: 0,
        actions: [action({ seq: 2, playerId: 'p2', kind: 'call', amount: 30, to: 30 })],
      }),
      'p2',
      { bet: 30 },
    )
    expect(closedByABet(betting, called)).toBe(false)
  })
})
