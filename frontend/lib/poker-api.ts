import type { BaizeId, DeckId } from '@/lib/table-style'

// Shared client for the FastAPI poker backend. All requests go to /api/* which
// Vercel routes to the Python service.

export type Phase = 'lobby' | 'hand' | 'handover' | 'finished'

export interface PlayerView {
  id: string
  name: string
  /** Signed photo URL from a signed-in player's profile or a guest selfie. */
  avatarUrl?: string | null
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
  /**
   * Cards you folded and asked to show, before the hand was over.
   *
   * Yours only, and still face down: showing while the hand is being played
   * would hand live players a card to work with. They turn over when the pot
   * is pushed. Until then this is changeable — see `ShowCards`.
   */
  pendingShowIndices?: number[]
  /**
   * Whether the showdown itself turned this hand face up.
   *
   * Not the same as "the hand was shown down". The last aggressor shows first
   * and after that a hand only has to be shown to beat what is already face
   * up, so a player who was beaten and speaks after the winner throws theirs
   * away unseen — and is offered the choice to show it anyway.
   */
  showedDown?: boolean
  /**
   * What you have made against the board as it stands, in words.
   *
   * Yours and nobody else's — the server only fills it in for the player it is
   * answering, because it is the one piece of private information a table would
   * never say out loud. Null before you are dealt in, and for everybody else.
   */
  handName?: string | null
  /** The shot clock played this hand for them at least once. */
  timedOut: boolean
  /** Out of chips — eliminated from the tournament. */
  out: boolean
  /** Sat out by the shot clock rather than by choice. */
  autoSatOut: boolean
  /**
   * Whether benching them would still leave a table that can deal.
   *
   * Always true today, and worth keeping as a field rather than dropping. It
   * used to be false heads-up, because sitting somebody out took them out of
   * the deal and left one player with nothing to play against. An absent
   * player is now dealt in and blinded like everybody else, so the table can
   * always keep going — but "can this player step away" is a question the
   * server answers, and the button asks it rather than assuming.
   */
  canSitOut: boolean
  /** Said goodbye, and goes as soon as this hand is settled. */
  leaving: boolean
  rebuys: number
  addOnTaken: boolean
  /** Extra seconds this player has left for the whole tournament. */
  timeBank: number
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
  avatarUrl?: string | null
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

/**
 * One decision, as the table would call it out.
 *
 * Written down by the server rather than worked out from two polled views,
 * because one of these cannot be worked out at all: a check moves no chips,
 * folds nobody and grows no board, so the picture before it and the picture
 * after it differ only in whose turn it is — which is also what a street
 * closing, a deal and an expired clock look like.
 */
export interface TableAction {
  /**
   * Never restarts, not even on a new deal. It is how a client knows which of
   * these it has already played, which matters because polling means the same
   * action arrives several times and two fast actions arrive together.
   */
  seq: number
  handNumber: number
  playerId: string
  /**
   * Five, where the engine has three. Checking and calling are one move to the
   * engine and opposite moves to everyone watching, and opening a street is
   * not raising somebody.
   */
  kind: 'check' | 'call' | 'bet' | 'raise' | 'fold'
  /** What the decision cost them. */
  amount: number
  /** Where it left their bet for the street — the number a raise is named by. */
  to: number
  /**
   * Their whole stack went in. Deliberately a flag and not a kind: somebody
   * can be all in *and* calling, and collapsing the two loses which it was.
   */
  allIn: boolean
  street: string
  /** Nobody chose it — the clock did, or somebody who had already left. */
  auto: boolean
}

/** One pot, and who is playing for it. */
export interface PotView {
  amount: number
  playerIds: string[]
}

export interface HandResult {
  playerId: string
  name: string
  /**
   * What the hand left them, net. How they *finished*, not what they won.
   *
   * Sort a results list by this. Do not ask it who won: a player who put in
   * 100 and took a side pot of 20 finished at -80 and won a pot, and a chop
   * returns exactly what both players put in and reads as nobody winning
   * anything. Both are ordinary hands, and on both of them this number says no.
   */
  delta: number
  /**
   * What the engine actually pushed to them out of the pots. Zero for
   * everybody who won nothing, and the only honest answer to "did they win".
   */
  won: number
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
    /** Which tournament this room is running. Older stored rooms are the first. */
    tournamentNumber?: number
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
    /** Extra seconds each player gets for the whole tournament. 0 is off. */
    timeBankSeconds: number
    /** Dead money each hand, already scaled to this level. */
    ante: number
    anteMode: 'off' | 'bb' | 'all'
    straddle: boolean
    bombPotEvery: number
    /** The hand on the table right now is a bomb pot. */
    bombPot: boolean
    /** Big blinds each player owes a 7-2 winner. 0 is off. */
    sevenDeuce: number
    /** What the table is made of. Chosen once, by whoever set it up. */
    baize: string
    deck: string
  }
  players: PlayerView[]
  board: string[]
  /** Every board dealt. One entry on every hand that ran once. */
  boards: string[][]
  /** What each board came to, once the hand is over. */
  boardResults: { cards: string[]; winners: string[] }[]
  pot: number
  /**
   * The pot broken out, main first, and who can win each. Sums to `pot`.
   * Empty between hands.
   */
  pots: PotView[]
  street: string
  actorId: string | null
  legal: LegalActions | null
  /** What everybody did this hand, oldest first. */
  actions: TableAction[]
  lastResults: HandResult[]
  standings: Standing[]
  /** The finished hand was actually shown down (not won by everyone folding). */
  wentToShowdown: boolean
  /**
   * The hands that have to be turned over, in the order they turn over.
   *
   * The showdown rule, decided in one place — the server — because it is a
   * rule about the hand and not about the drawing. Empty on every hand that
   * did not reach a showdown.
   */
  showOrder: string[]
  /**
   * What the pot came to, on a hand that is over. Zero while one is running.
   *
   * `pot` is chips that have left the stacks and are not on the felt, so the
   * instant the engine pushes them it is correctly zero — and the table still
   * has two things left to draw with them: the last street being raked in, and
   * the middle sitting there until it is paid out.
   */
  potAtEnd: number
  /** Who collected the 7-2 bonus this hand, and what it came to. */
  sevenDeuceWin: { playerId: string; name: string; amount: number } | null
  /** The bonus is there for the taking, but the cards are still face down. */
  sevenDeucePending: boolean
  /** The decision on the table is being paid for out of the actor's bank. */
  bankRunning: boolean
  /**
   * What *you* have said you will do when your turn arrives, and nobody
   * else's — a table that could see who has already folded in advance would be
   * playing a different game.
   */
  preAction: PreAction | null
  /** Players being asked whether to deal the rest of the board twice. */
  runoutSeats: string[]
  /** When the offer of a second board expires and the hand runs once. */
  runoutDeadline: number | null
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
  /** One-time accountless backup for moving host authority to another device. */
  recoveryCode?: string
}

/** One retained line of room chat, already projected for this viewer. */
export interface ChatMessage {
  /** Stable, server-generated identity used for polling and unread state. */
  id: string
  /** Snapshot of the capability-authenticated seat name at send time. */
  authorName: string
  text: string
  /** Server epoch timestamp in milliseconds. */
  createdAt: number
  /** Viewer-relative; the API deliberately does not expose an author player id. */
  isMine: boolean
}

export interface ChatView {
  messages: ChatMessage[]
  /** True only when the supplied capability currently resolves to a seat. */
  canSend: boolean
  /** Server epoch timestamp in milliseconds for diagnostics/skew-aware clients. */
  serverTime: number
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
  tournamentNumber: number
  maxSeats: number
  actionSeconds: number
  levelMinutes: number
  autoDealSeconds: number
  paused: boolean
  lastHand: boolean
  allowLeaving: boolean
  rebuyOpen: boolean
  addOn: boolean
  /** The countdown on screen is the actor's time bank, not the shot clock. */
  bankRunning: boolean
  /** What you have already said you will do when your turn comes. */
  preAction: PreAction | null
  ante: number
  bombPot: boolean
  /** What the table is made of — see `lib/table-style.ts`. */
  baize: string
  deck: string
  players: PlayerView[]
  board: string[]
  boards: string[][]
  boardResults: { cards: string[]; winners: string[] }[]
  /** Players being asked whether to deal the rest of the board twice. */
  runoutSeats: string[]
  /** You are one of them. */
  askedAboutRunout: boolean
  pot: number
  /** The pot broken out, main first. One entry is the ordinary case. */
  pots: PotView[]
  /** What everybody did this hand, oldest first. */
  actions: TableAction[]
  street: string
  actorId: string | null
  isHost: boolean
  isYourTurn: boolean
  you: PlayerView | null
  lastResults: HandResult[]
  standings: Standing[]
  wentToShowdown: boolean
  /** Who has to turn their hand over, in the order they do it. See `RoomView`. */
  showOrder: string[]
  /** What the pot came to on a hand that is over. See `RoomView`. */
  potAtEnd: number
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
  runoutEndsAtMs: number | null
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

/**
 * What the table says a hand did, in the line above the pot.
 *
 * Exported because it is the app's voice at the one moment everybody is
 * looking at the same thing, and a voice is worth testing.
 */
export function resultsMessage(results: HandResult[]): string | null {
  if (!results.length) return null
  // Who took chips out of the middle. Asked as `delta > 0` this line went
  // silent on the two hands most worth a line: a chop, where both players get
  // back exactly what they put in, and a side pot won by somebody who still
  // finished the hand down. The table said nothing at all about either.
  const winners = results.filter((r) => r.won > 0)
  if (!winners.length) return null
  // A chop is not two people each winning something, and printing "(+0)" twice
  // says it is. What everybody wants to know there is that it was shared.
  const chopped = winners.length > 1 && winners.every((w) => w.delta <= 0)
  if (chopped) {
    return `${winners.map((w) => w.name).join(" and ")} split the pot`
  }
  const names = winners.map((w) => `${w.name} (+${w.delta.toLocaleString()})`)
  // Who and how much, and nothing else. What the hand was *won with* used to
  // be spelled out here too, and it was said twice: the winner's own plate
  // names it at the moment their five cards light up, an inch from the cards
  // themselves. This line is over the pot, so it says what the pot did.
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
  const runoutEndsAtMs =
    v.runoutDeadline != null ? v.runoutDeadline * 1000 + skewMs : null
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
    tournamentNumber: v.room.tournamentNumber ?? 1,
    maxSeats: v.room.maxSeats,
    actionSeconds: v.room.actionSeconds,
    levelMinutes: v.room.levelMinutes,
    autoDealSeconds: v.room.autoDealSeconds,
    paused: v.room.paused,
    lastHand: v.room.lastHand,
    allowLeaving: v.room.allowLeaving,
    rebuyOpen: v.room.rebuyOpen,
    addOn: v.room.addOn,
    bankRunning: !!v.bankRunning,
    preAction: v.preAction ?? null,
    boards: v.boards?.length ? v.boards : [v.board],
    boardResults: v.boardResults ?? [],
    runoutSeats: v.runoutSeats ?? [],
    askedAboutRunout: !!playerId && (v.runoutSeats ?? []).includes(playerId),
    ante: v.room.ante,
    bombPot: v.room.bombPot,
    baize: v.room.baize,
    deck: v.room.deck,
    players,
    board: v.board,
    pot: v.pot,
    // A table that runs no all-ins never sees more than one, so the fallback
    // is the whole pot as a single unnamed one rather than an empty list —
    // otherwise every renderer has to special-case an older server.
    pots: v.pots?.length ? v.pots : v.pot > 0 ? [{ amount: v.pot, playerIds: [] }] : [],
    actions: v.actions ?? [],
    street: v.street,
    actorId: v.actorId,
    isHost: !!you?.isHost,
    isYourTurn,
    you: players.find((p) => p.isYou) ?? null,
    lastResults: v.lastResults,
    standings: v.standings ?? [],
    wentToShowdown: !!v.wentToShowdown,
    showOrder: v.showOrder ?? [],
    potAtEnd: v.potAtEnd ?? 0,
    sevenDeuceWin: v.sevenDeuceWin ?? null,
    sevenDeucePending: !!v.sevenDeucePending,
    level: v.level,
    turnId: v.turnId ?? 0,
    actionDeadlineMs,
    levelEndsAtMs,
    autoDealAtMs,
    breakEndsAtMs,
    runoutEndsAtMs,
    message: resultsMessage(v.lastResults),
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

  /**
   * The seat was removed by the host, and is not coming back.
   *
   * Deliberately apart from `isAuthFailure`, because the credential must be
   * *kept*. It is the only thing that tells this device from a stranger's at
   * the front door, and the password is no help — everybody at the table has
   * it, including the person who was just asked to leave. Forget the
   * credential and being removed lasts exactly as long as it takes to tap
   * join again.
   */
  get isRemoved() {
    return this.status === 410
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
  /** Signed photo URL for the host, from their profile or a guest selfie. */
  hostAvatarUrl?: string | null
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
  /** What the table is made of. Cosmetic, shared, and chosen once. */
  baize: BaizeId
  deck: DeckId
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
  /** Extra seconds each player gets for the whole tournament. 0 is off. */
  timeBankSeconds: number
  /** Offer the all-in players a second board. Everybody left in has to agree. */
  runItTwice: boolean
}

/**
 * What you can decide before your turn arrives.
 *
 * None of them names an amount, deliberately: "call 100" would have to be
 * invalidated the moment somebody raises to 300, and getting that wrong pays a
 * price the player never accepted. All three are defined against whatever the
 * situation turns out to be.
 */
export type PreAction = 'check' | 'check-fold' | 'call-any'

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
 * One fresh name, for a caller that is going to hold on to it.
 *
 * This is the raw generator and not the pattern. The server answers a name it
 * has already seen instead of doing the thing twice, which only works if the
 * name **survives the retry** — so every id that guards something has to be
 * derived from the decision rather than made up when the request goes out.
 * That is what the call sites do: `a:player:hand:turn` for an action,
 * `b:player:hand:kind:ordinal` for a purchase. A name generated per send is a
 * different name for the same decision and catches nothing.
 *
 * The one case with nothing to derive from is joining a room, where there is
 * no player id yet and no turn to point at. That is what this is for: called
 * once, kept in storage, and sent again unchanged on every attempt — the
 * randomness is stored, not repeated.
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

  joinRoom: (
    roomId: string,
    name: string,
    password: string,
    token?: string,
    avatarUrl?: string | null,
  ) =>
    req<Session>(`/api/rooms/${roomId}/join`, {
      method: 'POST',
      // The credential, when this device already has one, says "the person who
      // sat here is back" rather than "somebody new called the same thing".
      headers: auth(token),
      body: JSON.stringify({
        name,
        password,
        requestId: joinAttemptId(roomId),
        avatarUrl: avatarUrl ?? null,
      }),
    }),

  /** Watch without taking a seat. Still needs the password. */
  watchRoom: (roomId: string, password: string) =>
    req<Session>(`/api/rooms/${roomId}/watch`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  /** Recover the current host seat on a replacement device. Rotates both secrets. */
  recoverHost: (roomId: string, password: string, recoveryCode: string) =>
    req<Session>(`/api/rooms/${roomId}/host/recover`, {
      method: 'POST',
      body: JSON.stringify({ password, recoveryCode }),
    }),

  /** Authenticated host: replace the one-time backup code. */
  createHostBackup: (roomId: string, playerId: string, token?: string) =>
    req<Session>(`/api/rooms/${roomId}/host/backup`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ playerId }),
    }),

  /** Authenticated host: hand authority to another occupied seat. */
  transferHost: (
    roomId: string,
    playerId: string,
    targetId: string,
    token?: string,
  ) =>
    req<RoomView>(`/api/rooms/${roomId}/host/transfer`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ playerId, targetId }),
    }),

  getState: (roomId: string, playerId?: string, token?: string) =>
    req<RoomView>(
      `/api/rooms/${roomId}/state${playerId ? `?playerId=${encodeURIComponent(playerId)}` : ''}`,
      { headers: auth(token) },
    ),

  /** Read bounded room chat as either a seated player or authenticated spectator. */
  getChat: (roomId: string, token?: string) =>
    req<ChatView>(`/api/rooms/${roomId}/chat`, {
      headers: auth(token),
      cache: 'no-store',
    }),

  /**
   * Send as the seat proven by `token`. No author name or player id is accepted
   * by this contract; `requestId` only makes a lost-response retry idempotent.
   */
  sendChat: (roomId: string, token: string, text: string, requestId: string) =>
    req<ChatView>(`/api/rooms/${roomId}/chat`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ text, requestId }),
    }),

  startHand: (roomId: string, playerId: string, token?: string) =>
    req<RoomView>(`/api/rooms/${roomId}/start`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ playerId, action: 'start' }),
    }),

  /**
   * Another tournament, same table, same people, same rules.
   *
   * Named after the tournament it is ending rather than after the tap, so the
   * second tap on a button that already worked is recognised as the same
   * decision — and it has to be, because by then the room is a lobby and there
   * is no finished tournament left to refuse.
   */
  playAgain: (roomId: string, playerId: string, endedAt: number, tournamentNumber: number, token?: string) =>
    req<RoomView>(`/api/rooms/${roomId}/again`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({
        playerId,
        action: 'again',
        // Include tournamentNumber so that two tournaments ending on the same
        // hand number produce distinct requestIds and don't hit the receipt
        // cache from the previous play-again.
        requestId: `again:${roomId}:t${tournamentNumber}:${endedAt}`,
      }),
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
    /**
     * How many of this kind have already been bought — the purchase's ordinal.
     *
     * Without it the name was the player, the hand and the kind, and two
     * *different* rebuys can share all three: bust, buy back in, and lose the
     * new stack before the next deal — the 7-2 bonus is settled after the pot
     * and takes it in one go — and the second purchase asks under the first
     * one's name. The server finds the receipt, answers 200, and hands over no
     * chips. A retry keeps the old count and is still caught; a real second
     * purchase has a different ordinal and gets through.
     */
    taken: number,
    token?: string,
  ) =>
    req<RoomView>(`/api/rooms/${roomId}/rebuy`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({
        playerId,
        action: what,
        // Named after the purchase, the hand it was made at and which one it
        // is: tapping twice because nothing seemed to happen must not buy two,
        // and buying twice must not be mistaken for tapping twice.
        requestId: `b:${playerId}:${handNumber}:${what}:${taken}`,
      }),
    }),

  /**
   * Say now what you want to do when your turn arrives, or `clear` to take it
   * back. Fires once and is then gone.
   *
   * Unnamed, unlike most of the list below: this writes down where the player
   * wants to end up rather than recording that something happened, so sending
   * it twice asks for the same thing. Naming it would be the bug — a plan set,
   * fired on the flop, and set again on the turn is the same name twice, and
   * the second one would be answered without being carried out.
   */
  setPreAction: (
    roomId: string,
    playerId: string,
    action: PreAction | 'clear',
    handNumber: number,
    token?: string,
  ) =>
    req<RoomView>(`/api/rooms/${roomId}/preaction`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ playerId, action, handNumber }),
    }),

  /** Say whether you want the rest of the board dealt once or twice. */
  chooseRunout: (
    roomId: string,
    playerId: string,
    answer: 'once' | 'twice',
    handNumber: number,
    token?: string,
  ) =>
    req<RoomView>(`/api/rooms/${roomId}/runout`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({
        playerId,
        action: answer,
        handNumber,
        requestId: `r:${playerId}:${handNumber}:${answer}`,
      }),
    }),

  /** Host only: show a player the door. Between hands. */
  kickPlayer: (roomId: string, playerId: string, targetId: string, token?: string) =>
    req<RoomView>(`/api/rooms/${roomId}/kick`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ playerId, targetId }),
    }),

  /**
   * Turn your own cards face up after the hand. There is no way back.
   *
   * Sent during the hand by a player who has folded it is a plan instead:
   * nothing appears until the pot is pushed, the set replaces whatever was
   * planned before, and an empty list cancels.
   */
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
   * Sit out, or come back. `sittingOut` is the state being asked for, not a
   * flip of the one in effect — a flip is the one shape where a retry undoes
   * itself, so the player ends up sitting in when they asked to sit out with
   * nothing on screen explaining why. Asking for a side of the table is safe
   * to repeat on its own, so this needs no name.
   */
  toggleSitOut: (
    roomId: string,
    playerId: string,
    sittingOut: boolean,
    token?: string,
  ) =>
    req<RoomView>(`/api/rooms/${roomId}/sit`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ playerId, action: sittingOut ? 'out' : 'in' }),
    }),

  /**
   * Host only: stop the table, start it again, or call the last hand.
   *
   * All four are settings rather than events, and the server writes each one
   * to be safe against arriving twice. Naming them would stop the host pausing
   * a second time during the same hand — the name would already have been
   * seen, and the answer would be a 200 and a table that never stopped.
   */
  controlTable: (
    roomId: string,
    playerId: string,
    action: TableControl,
    token?: string,
  ) =>
    req<RoomView>(`/api/rooms/${roomId}/table`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({ playerId, action }),
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
