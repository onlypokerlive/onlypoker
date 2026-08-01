// Shared client for the FastAPI poker backend. All requests go to /api/* which
// Vercel routes to the Python service.

export type Phase = 'lobby' | 'hand' | 'handover' | 'finished'

export interface PlayerView {
  id: string
  name: string
  seat: number
  chips: number
  isHost: boolean
  sittingOut: boolean
  isYou: boolean
  connected: boolean
  index: number | null
  inHand: boolean
  folded: boolean
  bet: number
  isActor: boolean
  isButton: boolean
  isSmallBlind: boolean
  isBigBlind: boolean
  /** Posted two big blinds under the gun and acts last preflop. */
  isStraddle: boolean
  cardsCount: number
  /**
   * The hand as this viewer is allowed to see it, or null for nothing at all.
   * A null *entry* is a card still face down — that happens when a player
   * turned over one card and kept the other.
   */
  cards: (string | null)[] | null
  /**
   * Cards this player has turned face up by choice. Present on your own seat
   * as well, because you always see your whole hand — the cards alone cannot
   * tell you what everyone else can see.
   */
  shownIndices: number[]
  /** The shot clock played this hand for them at least once. */
  timedOut: boolean
  /** Out of chips — eliminated from the tournament. */
  out: boolean
  /** Sat out by the shot clock rather than by choice. */
  autoSatOut: boolean
  /**
   * Whether benching them would still leave a table that can deal. False
   * heads-up, where sitting out would strand the tournament.
   */
  canSitOut: boolean
  /** Said goodbye, and goes as soon as this hand is settled. */
  leaving: boolean
  rebuys: number
  addOnTaken: boolean
  allIn?: boolean
}

/** A rung on the blind ladder. */
export interface BlindLevel {
  number: number
  smallBlind: number
  bigBlind: number
}

export interface LevelView extends BlindLevel {
  totalLevels: number
  durationSec: number
  /** Seconds until the clock crosses into the next level. */
  secondsLeft: number | null
  /** Set when the clock advanced mid-hand: these blinds apply on the next deal. */
  pending: BlindLevel | null
  next: BlindLevel | null
  isLast: boolean
}

export interface Standing {
  place: number
  playerId: string
  name: string
  chips: number
}

export interface LegalActions {
  canFold: boolean
  canCheckOrCall: boolean
  callAmount: number
  canRaise: boolean
  minRaise: number
  maxRaise: number
}

export interface HandResult {
  playerId: string
  name: string
  delta: number
  /** What they held, e.g. "Two pair, queens and sixes". Showdowns only. */
  handName?: string
  /** The five cards that made it. */
  handCards?: string[]
}

export interface RoomView {
  room: {
    id: string
    name: string
    phase: Phase
    smallBlind: number
    bigBlind: number
    startingChips: number
    handNumber: number
    maxSeats: number
    /** Seconds allowed per decision. 0 means no shot clock. */
    actionSeconds: number
    /** Minutes per blind level. 0 means the blinds never move. */
    levelMinutes: number
    /** Pause between hands before the next is dealt automatically. */
    autoDealSeconds: number
    /** The table is stopped: no deals, and the blind clock is held still. */
    paused: boolean
    /** Stop the table every N blind levels. 0 turns scheduled breaks off. */
    breakEveryLevels: number
    breakMinutes: number
    /** No hand after this one. Everybody is told, not just the host. */
    lastHand: boolean
    /** Whether anybody can take their chips and go home early. */
    allowLeaving: boolean
    /** Whether the door is still open to somebody turning up now. */
    lateEntryOpen: boolean
    /** Whether a busted player can still buy back in. */
    rebuyOpen: boolean
    /** Whether this table offers the one-per-player top-up. */
    addOn: boolean
    /** Dead money each hand, already scaled to this level. */
    ante: number
    anteMode: 'off' | 'bb' | 'all'
    straddle: boolean
    bombPotEvery: number
    /** The hand on the table right now is a bomb pot. */
    bombPot: boolean
    /** Big blinds each player owes a 7-2 winner. 0 is off. */
    sevenDeuce: number
  }
  players: PlayerView[]
  board: string[]
  pot: number
  street: string
  actorId: string | null
  legal: LegalActions | null
  lastResults: HandResult[]
  standings: Standing[]
  /** The finished hand was actually shown down (not won by everyone folding). */
  wentToShowdown: boolean
  /** Who collected the 7-2 bonus this hand, and what it came to. */
  sevenDeuceWin: { playerId: string; name: string; amount: number } | null
  /** The bonus is there for the taking, but the cards are still face down. */
  sevenDeucePending: boolean
  level: LevelView | null
  /** Absolute server time (seconds) when the current decision expires. */
  actionDeadline: number | null
  /** Absolute server time (seconds) when the next hand deals itself. */
  autoDealAt: number | null
  /** When the table starts itself again, or null if it is not on a break. */
  breakUntil: number | null
  /** Server clock at the moment this view was built, for skew correction. */
  serverTime: number
  /**
   * The moment this view describes. Sent back with a decision so the server can
   * refuse an order about a moment that has already passed — a double tap, or a
   * retry that arrives after the action came back round.
   */
  turnId: number
  you: PlayerView | null
}

export interface Session {
  roomId: string
  playerId: string
  /**
   * Proof that this seat is yours. Every id at the table is public — clients
   * need them to say whose seat is whose — so the id alone authorises nothing.
   * Never leaves this device except as a request header.
   *
   * Required, not optional: every way of getting a session issues one, and a
   * session without it is refused by every request it could make.
   */
  token: string
  isHost: boolean
  /** Watching rather than playing: no seat, no chips, no cards. */
  spectator?: boolean
}

// --- Flattened view consumed by the UI components -------------------------
// The backend returns a nested RoomView; components use this flattened shape.
export interface GameView {
  roomId: string
  roomName: string
  phase: Phase
  smallBlind: number
  bigBlind: number
  startingChips: number
  handNumber: number
  maxSeats: number
  actionSeconds: number
  levelMinutes: number
  autoDealSeconds: number
  paused: boolean
  lastHand: boolean
  allowLeaving: boolean
  rebuyOpen: boolean
  addOn: boolean
  ante: number
  bombPot: boolean
  players: PlayerView[]
  board: string[]
  pot: number
  street: string
  actorId: string | null
  isHost: boolean
  isYourTurn: boolean
  you: PlayerView | null
  lastResults: HandResult[]
  standings: Standing[]
  wentToShowdown: boolean
  sevenDeuceWin: { playerId: string; name: string; amount: number } | null
  sevenDeucePending: boolean
  level: LevelView | null
  /** The moment this view describes; travels back with every decision. */
  turnId: number
  /** Both deadlines are rebased onto the browser's clock at fetch time, so a
   *  phone with the wrong time still counts down correctly. */
  actionDeadlineMs: number | null
  levelEndsAtMs: number | null
  autoDealAtMs: number | null
  breakEndsAtMs: number | null
  message: string | null
  legal: {
    canFold: boolean
    canCheck: boolean
    canRaise: boolean
    callAmount: number
    minRaise: number | null
    maxRaise: number | null
  } | null
}

function resultsMessage(results: HandResult[], players: PlayerView[]): string | null {
  if (!results.length) return null
  const winners = results.filter((r) => r.delta > 0)
  if (!winners.length) return null
  const names = winners.map((w) => `${w.name} (+${w.delta.toLocaleString()})`)
  return `${names.join(", ")} won the pot`
}

export function toGameView(v: RoomView, playerId: string | null): GameView {
  const you = v.you
  const isYourTurn = !!(playerId && v.actorId === playerId && v.legal)
  const legal = v.legal
    ? {
        canFold: v.legal.canFold,
        // The backend exposes a single "check or call". It's a check when the
        // amount owed is zero.
        canCheck: v.legal.canCheckOrCall && v.legal.callAmount === 0,
        canRaise: v.legal.canRaise,
        callAmount: v.legal.callAmount,
        minRaise: v.legal.canRaise ? v.legal.minRaise : null,
        maxRaise: v.legal.canRaise ? v.legal.maxRaise : null,
      }
    : null

  // Derive an all-in flag per player for display.
  const players = v.players.map((p) => ({
    ...p,
    allIn: p.inHand && p.chips === 0,
  })) as PlayerView[]

  // Rebase the server's absolute deadlines onto this browser's clock. The
  // offset also absorbs request latency, which is what we want: it makes the
  // countdown err slightly short rather than long.
  const skewMs = Date.now() - v.serverTime * 1000
  const actionDeadlineMs =
    v.actionDeadline != null ? v.actionDeadline * 1000 + skewMs : null
  const autoDealAtMs = v.autoDealAt != null ? v.autoDealAt * 1000 + skewMs : null
  const breakEndsAtMs = v.breakUntil != null ? v.breakUntil * 1000 + skewMs : null
  const levelEndsAtMs =
    v.level?.secondsLeft != null ? Date.now() + v.level.secondsLeft * 1000 : null

  return {
    roomId: v.room.id,
    roomName: v.room.name,
    phase: v.room.phase,
    smallBlind: v.room.smallBlind,
    bigBlind: v.room.bigBlind,
    startingChips: v.room.startingChips,
    handNumber: v.room.handNumber,
    maxSeats: v.room.maxSeats,
    actionSeconds: v.room.actionSeconds,
    levelMinutes: v.room.levelMinutes,
    autoDealSeconds: v.room.autoDealSeconds,
    paused: v.room.paused,
    lastHand: v.room.lastHand,
    allowLeaving: v.room.allowLeaving,
    rebuyOpen: v.room.rebuyOpen,
    addOn: v.room.addOn,
    ante: v.room.ante,
    bombPot: v.room.bombPot,
    players,
    board: v.board,
    pot: v.pot,
    street: v.street,
    actorId: v.actorId,
    isHost: !!you?.isHost,
    isYourTurn,
    you: players.find((p) => p.isYou) ?? null,
    lastResults: v.lastResults,
    standings: v.standings ?? [],
    wentToShowdown: !!v.wentToShowdown,
    sevenDeuceWin: v.sevenDeuceWin ?? null,
    sevenDeucePending: !!v.sevenDeucePending,
    level: v.level,
    turnId: v.turnId ?? 0,
    actionDeadlineMs,
    levelEndsAtMs,
    autoDealAtMs,
    breakEndsAtMs,
    message: resultsMessage(v.lastResults, players),
    legal,
  }
}

/** The header the backend reads a player's credential from. */
const TOKEN_HEADER = 'X-Player-Token'

/**
 * A failed request, with the status kept.
 *
 * Callers need to tell "this went wrong" from "you are not allowed in here":
 * the second one means the session on this device is no good and the player
 * should be sent back to the door, not left staring at a spinner while the
 * same rejected request repeats every 1.2 seconds. Matching on the message
 * text cannot make that distinction.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** The server refused this caller, rather than failing to serve them. */
  get isAuthFailure() {
    return this.status === 401 || this.status === 403 || this.status === 404
  }
}

async function req<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
  })
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (body?.detail) message = body.detail
    } catch {
      // ignore parse errors
    }
    throw new ApiError(message, res.status)
  }
  return res.json() as Promise<T>
}

export interface CreateRoomInput {
  name: string
  hostName: string
  startingChips: number
  smallBlind: number
  bigBlind: number
  password: string
  /** Minutes per blind level; 0 keeps the blinds fixed. */
  levelMinutes: number
  /** Seconds per decision; 0 removes the shot clock. */
  actionSeconds: number
  /** Dead money each hand: none, the big blind posts for everyone, or all do. */
  anteMode: 'off' | 'bb' | 'all'
  /** Under the gun posts two big blinds and acts last preflop. */
  straddle: boolean
  /** Blow the hand up every N deals. 0 turns it off. */
  bombPotEvery: number
  /** Big blinds each player owes whoever wins with 7-2 offsuit. 0 is off. */
  sevenDeuce: number
  /** Stop the table every N blind levels. 0 turns scheduled breaks off. */
  breakEveryLevels: number
  breakMinutes: number
  /** Join a running tournament while the blinds are on this level or below. */
  lateEntryLevels: number
  /** What a latecomer sits down behind. */
  lateEntryChips: 'start' | 'average'
  /** Whether anybody can take their chips and go home early. */
  allowLeaving: boolean
  /** Buy back in while the blinds are on this level or below. 0 is off. */
  rebuyLevels: number
  rebuysPerPlayer: number
  /** One extra top-up per player, inside the same window. */
  addOn: boolean
}

/** What the host can do to the table itself, as opposed to to a hand. */
export type TableControl = 'pause' | 'resume' | 'last-hand' | 'keep-playing'

/** Blind structures, as a choice of how fast the night should go. */
export const BLIND_STRUCTURES = [
  { id: 'turbo', label: 'Turbo', minutes: 5, blurb: 'A short, sharp night' },
  { id: 'normal', label: 'Normal', minutes: 15, blurb: 'The usual' },
  { id: 'slow', label: 'Slow', minutes: 25, blurb: 'Room to actually play' },
] as const

function auth(token?: string): Record<string, string> {
  return token ? { [TOKEN_HEADER]: token } : {}
}

/**
 * A name for one attempt at doing something, so a retry is recognised as one.
 *
 * The server answers a name it has already seen instead of doing the thing
 * twice — which matters most where doing it twice is silent: two seats for one
 * person, a sit-out toggled back in, a rebuy charged again.
 *
 * These names are **derived from the intent, not generated per call**, which is
 * the only version that works. A fresh random id on every send is a different
 * name for the same decision, so the retry it was meant to catch sails
 * straight past it. `turnId` makes that easy: it already identifies the exact
 * moment a decision was made, so "fold, at this turn, in this hand" names
 * itself and stays the same however many times it is sent.
 */
export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * The id for *this device's* attempt to join *this room*, kept until it works.
 *
 * Held in storage rather than in a component so that a reload halfway through
 * — the phone locking, the tab being restored — is still the same attempt. The
 * case being closed is a join whose response never arrives: without a stable
 * name the retry takes a second seat, and the first one is unrecoverable,
 * because the only proof it belonged to anybody went missing with the response.
 */
export function joinAttemptId(roomId: string): string {
  const key = `holdem:join:${roomId}`
  try {
    const existing = localStorage.getItem(key)
    if (existing) return existing
    const fresh = newRequestId()
    localStorage.setItem(key, fresh)
    return fresh
  } catch {
    return newRequestId()
  }
}

export function clearJoinAttempt(roomId: string) {
  try {
    localStorage.removeItem(`holdem:join:${roomId}`)
  } catch {
    // ignore
  }
}

export const pokerApi = {
  createRoom: (input: CreateRoomInput) =>
    req<Session>('/api/rooms', { method: 'POST', body: JSON.stringify(input) }),

  joinRoom: (roomId: string, name: string, password: string, token?: string) =>
    req<Session>(`/api/rooms/${roomId}/join`, {
      method: 'POST',
      // The credential, when this device already has one, says "the person who
      // sat here is back" rather than "somebody new called the same thing".
      headers: auth(token),
      body: JSON.stringify({ name, password, requestId: joinAttemptId(roomId) }),
    }),

  /** Watch without taking a seat. Still needs the password. */
  watchRoom: (roomId: string, password: string) =>
    req<Session>(`/api/rooms/${roomId}/watch`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  getState: (roomId: string, playerId?: string, token?: string) =>
    req<RoomView>(
      `/api/rooms/${roomId}/state${playerId ? `?playerId=${encodeURIComponent(playerId)}` : ''}`,
      { headers: auth(token) },
    ),

  startHand: (roomId: string, playerId: string, token?: string) =>
    req<RoomView>(`/api/rooms/${roomId}/start`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ playerId, action: 'start' }),
    }),

  action: (
    roomId: string,
    playerId: string,
    action: string,
    amount?: number,
    // Stamps the decision with the hand *and the moment* it was made for, so a
    // slow or retried request can't be applied to whatever is on the table when
    // it lands — not even later in the same hand, once the action comes back
    // round to the same player.
    handNumber?: number,
    turnId?: number,
    token?: string,
  ) =>
    req<RoomView>(`/api/rooms/${roomId}/action`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({
        playerId,
        action,
        amount,
        handNumber,
        turnId,
        requestId: `a:${handNumber}:${turnId}:${action}:${amount ?? ''}`,
      }),
    }),

  /**
   * Go home, taking your chips with you. During a hand it is a goodbye: the
   * seat stays until the pot is settled, and the remaining decisions are
   * played out so nobody is kept waiting.
   */
  leaveTable: (roomId: string, playerId: string, handNumber: number, token?: string) =>
    req<RoomView>(`/api/rooms/${roomId}/leave`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({
        playerId,
        action: 'leave',
        requestId: `l:${playerId}:${handNumber}`,
      }),
    }),

  /** Buy back in after busting, or take the one add-on. */
  buyChips: (
    roomId: string,
    playerId: string,
    what: 'rebuy' | 'add-on',
    handNumber: number,
    token?: string,
  ) =>
    req<RoomView>(`/api/rooms/${roomId}/rebuy`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({
        playerId,
        action: what,
        // Named after the purchase and the hand it was made at: tapping twice
        // because nothing seemed to happen must not buy two.
        requestId: `b:${playerId}:${handNumber}:${what}`,
      }),
    }),

  /** Host only: show a player the door. Between hands. */
  kickPlayer: (roomId: string, playerId: string, targetId: string, token?: string) =>
    req<RoomView>(`/api/rooms/${roomId}/kick`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ playerId, targetId }),
    }),

  /** Turn your own cards face up after the hand. There is no way back. */
  showCards: (
    roomId: string,
    playerId: string,
    indices: number[],
    handNumber: number,
    token?: string,
  ) =>
    req<RoomView>(`/api/rooms/${roomId}/show`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ playerId, indices, handNumber }),
    }),

  /** The board that would have come, once the hand is safely over. */
  rabbitHunt: (roomId: string, token?: string) =>
    req<{ handNumber: number; streets: { street: string; cards: string[] }[] }>(
      `/api/rooms/${roomId}/rabbit`,
      { headers: auth(token) },
    ),

  /**
   * Sit out, or come back. `sittingOut` is the state being asked for, not the
   * one in effect — a toggle is the one shape where a retry undoes itself, so
   * the request is named after where the player wants to end up. Asking twice
   * for the same thing is answered once; genuinely changing their mind later
   * is a different name and goes through.
   */
  toggleSitOut: (
    roomId: string,
    playerId: string,
    sittingOut: boolean,
    handNumber: number,
    token?: string,
  ) =>
    req<RoomView>(`/api/rooms/${roomId}/sit`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({
        playerId,
        action: 'sit',
        requestId: `s:${playerId}:${handNumber}:${sittingOut ? 'out' : 'in'}`,
      }),
    }),

  /**
   * Host only: stop the table, start it again, or call the last hand.
   *
   * Named after the state being asked for and the hand it was asked during, so
   * a tap repeated because nothing seemed to happen does not undo itself.
   */
  controlTable: (
    roomId: string,
    playerId: string,
    action: TableControl,
    handNumber: number,
    token?: string,
  ) =>
    req<RoomView>(`/api/rooms/${roomId}/table`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({
        playerId,
        action,
        requestId: `t:${handNumber}:${action}`,
      }),
    }),
}

// --- Local session persistence (per room) ---------------------------------
const sessionKey = (roomId: string) => `holdem:session:${roomId}`

export function saveSession(session: Session) {
  try {
    localStorage.setItem(sessionKey(session.roomId), JSON.stringify(session))
  } catch {
    // ignore
  }
}

export function loadSession(roomId: string): Session | null {
  try {
    const raw = localStorage.getItem(sessionKey(roomId))
    if (!raw) return null
    const session = JSON.parse(raw) as Session
    // A session without a credential is a session from before the server
    // started asking for one. It will be refused by every request it makes, so
    // treating it as "signed in" only buys a screen that never loads. Sending
    // them to the door instead costs one re-join and works.
    if (!session?.playerId || !session?.token) return null
    return session
  } catch {
    return null
  }
}

export function clearSession(roomId: string) {
  try {
    localStorage.removeItem(sessionKey(roomId))
  } catch {
    // ignore
  }
}
