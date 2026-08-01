'use client'

import { track } from '@vercel/analytics'

const GUEST_ORIGIN_KEY = 'holdem:growth:guest-origin'
const SEEN_PREFIX = 'holdem:growth:seen:'
const CONVERSION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

export type CreationSource = 'home' | 'finished-table' | 'rematch'
export type ShareMethod = 'native' | 'clipboard' | 'download'
export type ShareSurface = 'lobby' | 'table' | 'results'

type GuestOrigin = {
  joinedAt: number
  convertedAt?: number
}

function emit(name: string, properties: Record<string, string | number | boolean>) {
  try {
    track(name, properties)
  } catch {
    // Measurement is never allowed to interrupt a poker night. The analytics
    // script may be blocked, still loading, or unavailable in local work.
  }
}

function readGuestOrigin(): GuestOrigin | null {
  try {
    const raw = localStorage.getItem(GUEST_ORIGIN_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as GuestOrigin
    return Number.isFinite(value.joinedAt) ? value : null
  } catch {
    return null
  }
}

function writeGuestOrigin(value: GuestOrigin) {
  try {
    localStorage.setItem(GUEST_ORIGIN_KEY, JSON.stringify(value))
  } catch {
    // Storage is an attribution convenience, not a product dependency.
  }
}

function once(key: string, callback: () => void) {
  try {
    const storageKey = `${SEEN_PREFIX}${key}`
    if (localStorage.getItem(storageKey)) return
    localStorage.setItem(storageKey, '1')
  } catch {
    // If storage is unavailable, emit rather than silently losing the event.
  }
  callback()
}

export function recordRoomCreated({
  source,
  customized,
}: {
  source: CreationSource
  customized: boolean
}) {
  emit('Room Created', { source, customized })

  const origin = readGuestOrigin()
  if (!origin || origin.convertedAt) return
  const elapsed = Date.now() - origin.joinedAt
  if (elapsed < 0 || elapsed > CONVERSION_WINDOW_MS) return

  emit('Guest Became Host', {
    source,
    daysSinceJoin: Math.floor(elapsed / (24 * 60 * 60 * 1000)),
  })
  writeGuestOrigin({ ...origin, convertedAt: Date.now() })
}

export function recordRoomJoined(roomId: string, role: 'player' | 'spectator') {
  once(`join:${roomId}:${role}`, () => {
    emit('Room Joined', { role })
    if (role === 'player') writeGuestOrigin({ joinedAt: Date.now() })
  })
}

export function recordInviteShared({
  method,
  surface,
  phase,
  isHost,
  playerCount,
}: {
  method: Exclude<ShareMethod, 'download'>
  surface: Exclude<ShareSurface, 'results'>
  phase: 'lobby' | 'hand' | 'handover'
  isHost: boolean
  playerCount: number
}) {
  emit('Invite Shared', { method, surface, phase, isHost, playerCount })
}

export function recordGameStarted(roomId: string, playerCount: number) {
  once(`start:${roomId}`, () => emit('Game Started', { playerCount }))
}

export function recordTournamentFinished(
  roomId: string,
  playerCount: number,
  handCount: number,
  isHost: boolean,
) {
  once(`finish:${roomId}`, () =>
    emit('Tournament Finished', { playerCount, handCount, isHost }),
  )
}

export function recordResultsShared(
  method: ShareMethod,
  playerCount: number,
  isHost: boolean,
) {
  emit('Results Shared', { method, playerCount, isHost })
}

export function recordFinishCta(action: 'create' | 'rematch', isHost: boolean) {
  emit('Finish CTA', { action, isHost })
}
