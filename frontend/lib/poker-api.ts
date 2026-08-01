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
    /** The host stopped automatic dealing. */
    autoDealPaused: boolean
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
  /** Server clock at the moment this view was built, for skew correction. */
  serverTime: number
  you: PlayerView | null
}

export interface Session {
  roomId: string
  playerId: string
  /**
   * Proof that this seat is yours. Every id at the table is public — clients
   * need them to say whose seat is whose — so the id alone authorises nothing.
   * Never leaves this device except as a request header.
   */
  token?: string
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
  autoDealPaused: boolean
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
  /** Both deadlines are rebased onto the browser's clock at fetch time, so a
   *  phone with the wrong time still counts down correctly. */
  actionDeadlineMs: number | null
  levelEndsAtMs: number | null
  autoDealAtMs: number | null
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
    autoDealPaused: v.room.autoDealPaused,
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
    actionDeadlineMs,
    levelEndsAtMs,
    autoDealAtMs,
    message: resultsMessage(v.lastResults, players),
    legal,
  }
}

/** The header the backend reads a player's credential from. */
const TOKEN_HEADER = 'X-Player-Token'

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
    throw new Error(message)
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
}

/** Blind structures, as a choice of how fast the night should go. */
export const BLIND_STRUCTURES = [
  { id: 'turbo', label: 'Turbo', minutes: 5, blurb: 'A short, sharp night' },
  { id: 'normal', label: 'Normal', minutes: 15, blurb: 'The usual' },
  { id: 'slow', label: 'Slow', minutes: 25, blurb: 'Room to actually play' },
] as const

function auth(token?: string): Record<string, string> {
  return token ? { [TOKEN_HEADER]: token } : {}
}

export const pokerApi = {
  createRoom: (input: CreateRoomInput) =>
    req<Session>('/api/rooms', { method: 'POST', body: JSON.stringify(input) }),

  joinRoom: (roomId: string, name: string, password: string) =>
    req<Session>(`/api/rooms/${roomId}/join`, {
      method: 'POST',
      body: JSON.stringify({ name, password }),
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
    // Stamps the decision with the hand it was made for, so a slow or retried
    // request can't be applied to whatever hand is running when it lands.
    handNumber?: number,
    token?: string,
  ) =>
    req<RoomView>(`/api/rooms/${roomId}/action`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ playerId, action, amount, handNumber }),
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
  rabbitHunt: (roomId: string) =>
    req<{ handNumber: number; streets: { street: string; cards: string[] }[] }>(
      `/api/rooms/${roomId}/rabbit`,
    ),

  toggleSitOut: (roomId: string, playerId: string, token?: string) =>
    req<RoomView>(`/api/rooms/${roomId}/sit`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ playerId, action: 'sit' }),
    }),

  setAutoDeal: (roomId: string, playerId: string, paused: boolean, token?: string) =>
    req<RoomView>(`/api/rooms/${roomId}/autodeal`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ playerId, action: paused ? 'pause' : 'resume' }),
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
    return raw ? (JSON.parse(raw) as Session) : null
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
