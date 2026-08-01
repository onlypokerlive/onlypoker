'use client'

import { track } from '@vercel/analytics'

const GUEST_ORIGIN_KEY = 'holdem:growth:guest-origin'
const SEEN_PREFIX = 'holdem:growth:seen:'
const CONVERSION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

export type CreationSource = 'home' | 'finished-table' | 'rematch' | 'dead-invite'
export type ShareMethod = 'native' | 'clipboard' | 'download'
export type ShareSurface = 'lobby' | 'table' | 'results'
export type PreviewStatus = 'available' | 'missing' | 'unavailable'
export type FailureCategory =
  | 'validation'
  | 'authentication'
  | 'not-found'
  | 'rate-limited'
  | 'conflict'
  | 'network'
  | 'other'

export type ViewportBand = 'compact-phone' | 'phone' | 'tablet' | 'desktop'

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

export function viewportBand(): ViewportBand {
  if (typeof window === 'undefined') return 'desktop'
  if (window.innerWidth < 640 && window.innerHeight <= 700) return 'compact-phone'
  if (window.innerWidth < 640) return 'phone'
  if (window.innerWidth < 1024) return 'tablet'
  return 'desktop'
}

export function failureCategory(error: unknown): FailureCategory {
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : 0
  if (status === 400 || status === 422) return 'validation'
  if (status === 401 || status === 403 || status === 410) return 'authentication'
  if (status === 404) return 'not-found'
  if (status === 409) return 'conflict'
  if (status === 429) return 'rate-limited'
  if (!status && error instanceof TypeError) return 'network'
  return 'other'
}

export function recordCreateViewed(ctaInitiallyVisible: boolean) {
  emit('Create Viewed', { viewport: viewportBand(), ctaInitiallyVisible })
}

export function recordCreateAttempt({
  source,
  customized,
  changedControls,
}: {
  source: CreationSource
  customized: boolean
  changedControls: number
}) {
  emit('Create Attempted', {
    source,
    customized,
    changedControls,
    viewport: viewportBand(),
  })
}

export function recordCreateFailed({
  source,
  stage,
  field,
  category,
}: {
  source: CreationSource
  stage: 'validation' | 'api'
  field: string
  category: FailureCategory
}) {
  emit('Create Failed', { source, stage, field, category, viewport: viewportBand() })
}

export function recordCustomizeOpened() {
  emit('Customize Opened', { viewport: viewportBand() })
}

export function recordInvitationViewed(status: PreviewStatus) {
  emit('Invitation Viewed', { status, viewport: viewportBand() })
}

export function recordJoinAttempt(
  role: 'player' | 'spectator',
  previewStatus: Exclude<PreviewStatus, 'missing'>,
) {
  emit('Join Attempted', { role, previewStatus, viewport: viewportBand() })
}

export function recordJoinFailed(
  role: 'player' | 'spectator',
  category: FailureCategory,
) {
  emit('Join Failed', { role, category, viewport: viewportBand() })
}

export function recordInviteAttempt({
  surface,
  phase,
  isHost,
}: {
  surface: Exclude<ShareSurface, 'results'>
  phase: 'lobby' | 'hand' | 'handover'
  isHost: boolean
}) {
  emit('Invite Attempted', { surface, phase, isHost, viewport: viewportBand() })
}

export function recordInviteOutcome({
  outcome,
  surface,
  phase,
  isHost,
}: {
  outcome: 'native' | 'clipboard' | 'cancelled' | 'error'
  surface: Exclude<ShareSurface, 'results'>
  phase: 'lobby' | 'hand' | 'handover'
  isHost: boolean
}) {
  emit('Invite Outcome', { outcome, surface, phase, isHost, viewport: viewportBand() })
}

export function recordGameStartAttempt(playerCount: number) {
  emit('Game Start Attempted', { playerCount, viewport: viewportBand() })
}

export function recordGameStartFailed(category: FailureCategory) {
  emit('Game Start Failed', { category, viewport: viewportBand() })
}

export function recordActionRejected(
  action: 'fold' | 'check' | 'call' | 'raise',
  category: FailureCategory,
) {
  emit('Action Rejected', { action, category, viewport: viewportBand() })
}

export function recordFinishCtaImpression(
  roomId: string,
  isHost: boolean,
  initiallyVisible: boolean,
) {
  once(`finish-cta:${roomId}`, () =>
    emit('Finish CTA Impression', {
      isHost,
      initiallyVisible,
      viewport: viewportBand(),
    }),
  )
}

export function recordResultsShareAttempt(isHost: boolean) {
  emit('Results Share Attempted', { isHost, viewport: viewportBand() })
}

export function recordResultsShareOutcome(
  outcome: ShareMethod | 'cancelled' | 'error',
  isHost: boolean,
) {
  emit('Results Share Outcome', { outcome, isHost, viewport: viewportBand() })
}

export function recordHostContinuity(
  action: 'backup' | 'recover' | 'transfer',
  outcome: 'attempted' | 'succeeded' | 'failed',
  category?: FailureCategory,
) {
  const properties: Record<string, string | number | boolean> = {
    action,
    outcome,
    viewport: viewportBand(),
  }
  if (category) properties.category = category
  emit('Host Continuity', properties)
}

export function recordRoomSessionMissing() {
  emit('Room Session Missing', { viewport: viewportBand() })
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
