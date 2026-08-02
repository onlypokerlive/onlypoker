import type { GameView, PlayerView, Session } from '@/lib/poker-api'

/**
 * A player and a table, with everything filled in.
 *
 * Shared rather than copied into each test file for one reason that keeps
 * proving itself: every field the server adds has to appear here once, and a
 * test that forgets one is a test asserting on a shape the app never sees.
 */
export function player(overrides: Partial<PlayerView> = {}): PlayerView {
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
    pendingShowIndices: [],
    showedDown: false,
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

export function gameView(overrides: Partial<GameView> = {}): GameView {
  const you = player({ id: 'me', name: 'You', isYou: true })
  return {
    roomId: 'ABC123',
    roomName: 'Test table',
    phase: 'hand',
    smallBlind: 5,
    bigBlind: 10,
    startingChips: 1000,
    handNumber: 1,
    tournamentNumber: 1,
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
    deck: 'clasica',
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
    showOrder: [],
    potAtEnd: 0,
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

export const session: Session = {
  roomId: 'ABC123',
  playerId: 'me',
  token: 'secret',
  isHost: false,
}

/** Watching rather than playing: no seat, no chips, no cards, no `you`. */
export function spectatorView(overrides: Partial<GameView> = {}): GameView {
  return gameView({ you: null, isHost: false, isYourTurn: false, ...overrides })
}
