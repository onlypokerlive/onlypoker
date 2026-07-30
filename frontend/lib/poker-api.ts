// Shared client for the FastAPI poker backend. All requests go to /api/* which
// Vercel routes to the Python service.

export type Phase = 'lobby' | 'hand' | 'handover'

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
  cardsCount: number
  cards: string[] | null
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
  }
  players: PlayerView[]
  board: string[]
  pot: number
  street: string
  actorId: string | null
  legal: LegalActions | null
  lastResults: HandResult[]
  you: PlayerView | null
}

export interface Session {
  roomId: string
  playerId: string
  isHost: boolean
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
}

export const pokerApi = {
  createRoom: (input: CreateRoomInput) =>
    req<Session>('/api/rooms', { method: 'POST', body: JSON.stringify(input) }),

  joinRoom: (roomId: string, name: string, password: string) =>
    req<Session>(`/api/rooms/${roomId}/join`, {
      method: 'POST',
      body: JSON.stringify({ name, password }),
    }),

  getState: (roomId: string, playerId?: string) =>
    req<RoomView>(
      `/api/rooms/${roomId}/state${playerId ? `?playerId=${encodeURIComponent(playerId)}` : ''}`,
    ),

  startHand: (roomId: string, playerId: string) =>
    req<RoomView>(`/api/rooms/${roomId}/start`, {
      method: 'POST',
      body: JSON.stringify({ playerId, action: 'start' }),
    }),

  action: (
    roomId: string,
    playerId: string,
    action: string,
    amount?: number,
  ) =>
    req<RoomView>(`/api/rooms/${roomId}/action`, {
      method: 'POST',
      body: JSON.stringify({ playerId, action, amount }),
    }),

  toggleSitOut: (roomId: string, playerId: string) =>
    req<RoomView>(`/api/rooms/${roomId}/sit`, {
      method: 'POST',
      body: JSON.stringify({ playerId, action: 'sit' }),
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
