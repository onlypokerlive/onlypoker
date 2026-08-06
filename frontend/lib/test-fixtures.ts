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

/**
 * The room block, rebuilt from the view a test actually asked for.
 *
 * `GameView` keeps the hot fields flat and the settings under `room`, so the
 * same number lives in two places. Deriving one from the other here is what
 * stops a test from setting `bigBlind: 50` and being handed a `room` that
 * still says 10 — a fixture that disagrees with itself is worse than no
 * fixture, because the assertion still passes.
 */
function roomFrom(view: Omit<GameView, 'room'>): GameView['room'] {
  return {
    id: view.roomId,
    name: view.roomName,
    phase: view.phase,
    smallBlind: view.smallBlind,
    bigBlind: view.bigBlind,
    startingChips: view.startingChips,
    handNumber: view.handNumber,
    tournamentNumber: view.tournamentNumber,
    maxSeats: view.maxSeats,
    actionSeconds: view.actionSeconds,
    levelMinutes: view.levelMinutes,
    blindLadder: 'standard',
    autoDealSeconds: view.autoDealSeconds,
    paused: view.paused,
    breakEveryLevels: 0,
    breakMinutes: 5,
    lastHand: view.lastHand,
    allowLeaving: view.allowLeaving,
    lateEntryOpen: true,
    lateEntryLevels: 4,
    lateEntryChips: 'start',
    rebuyOpen: view.rebuyOpen,
    rebuyLevels: 4,
    rebuysPerPlayer: 2,
    rebuyChips: 'start',
    rebuyChipsFixed: 0,
    addOn: view.addOn,
    timeBankSeconds: 60,
    ante: view.ante,
    anteMode: 'off',
    straddle: false,
    bombPotEvery: 0,
    bombPot: view.bombPot,
    sevenDeuce: 0,
    runItTwice: false,
    baize: view.baize,
    deck: view.deck,
  }
}

export function gameView(
  overrides: Partial<Omit<GameView, 'room'>> & {
    /** Merged over the derived block, so a test names only what it cares about. */
    room?: Partial<GameView['room']>
  } = {},
): GameView {
  const you = player({ id: 'me', name: 'You', isYou: true })
  const { room, ...rest } = overrides
  const flat: Omit<GameView, 'room'> = {
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
    ...rest,
  }
  return { ...flat, room: { ...roomFrom(flat), ...room } }
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
