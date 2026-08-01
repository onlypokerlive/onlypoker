import { describe, expect, it } from 'vitest'

import { diffViews, type TableEvent } from '@/lib/table-events'
import type { GameView, PlayerView, TableAction } from '@/lib/poker-api'

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
    leaving: false,
    rebuys: 0,
    addOnTaken: false,
    timeBank: 0,
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
    allowLeaving: true,
    rebuyOpen: false,
    addOn: false,
    bankRunning: false,
    preAction: null,
    ante: 0,
    bombPot: false,
    baize: 'emerald',
    deck: 'claret',
    players: [you, player()],
    board: [],
    boards: [[]],
    boardResults: [],
    runoutSeats: [],
    askedAboutRunout: false,
    pot: 0,
    pots: [],
    actions: [],
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
    runoutEndsAtMs: null,
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
})
