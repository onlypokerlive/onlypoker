import { describe, expect, it } from 'vitest'

import { diffViews, type TableEvent } from '@/lib/table-events'
import type { GameView, PlayerView } from '@/lib/poker-api'

function player(overrides: Partial<PlayerView> = {}): PlayerView {
  return {
    id: 'p1',
    name: 'Marcos',
    seat: 0,
    chips: 1000,
    isHost: false,
    sittingOut: false,
    isYou: false,
    connected: true,
    index: 0,
    inHand: true,
    folded: false,
    bet: 0,
    isActor: false,
    isButton: false,
    isSmallBlind: false,
    isBigBlind: false,
    isStraddle: false,
    cardsCount: 2,
    cards: null,
    timedOut: false,
    shownIndices: [],
    out: false,
    autoSatOut: false,
    canSitOut: true,
    ...overrides,
  }
}

function view(overrides: Partial<GameView> = {}): GameView {
  const you = player({ id: 'me', name: 'You', isYou: true })
  return {
    roomId: 'ABC123',
    roomName: 'Test table',
    phase: 'hand',
    smallBlind: 5,
    bigBlind: 10,
    startingChips: 1000,
    handNumber: 1,
    turnId: 1,
    maxSeats: 9,
    actionSeconds: 20,
    levelMinutes: 10,
    autoDealSeconds: 8,
    paused: false,
    lastHand: false,
    ante: 0,
    bombPot: false,
    players: [you, player()],
    board: [],
    pot: 0,
    street: 'preflop',
    actorId: 'p1',
    isHost: false,
    isYourTurn: false,
    you,
    lastResults: [],
    standings: [],
    wentToShowdown: false,
    sevenDeuceWin: null,
    sevenDeucePending: false,
    level: null,
    actionDeadlineMs: null,
    levelEndsAtMs: null,
    autoDealAtMs: null,
    breakEndsAtMs: null,
    message: null,
    legal: null,
    ...overrides,
  }
}

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
