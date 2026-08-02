import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  failureCategory,
  recordCreateAttempt,
  recordFinishCtaImpression,
  recordGameStarted,
  recordInviteOutcome,
  recordRoomCreated,
  recordRoomJoined,
  recordRoomSessionMissing,
  recordTournamentFinished,
} from './growth'
import { track } from '@vercel/analytics'

vi.mock('@vercel/analytics', () => ({ track: vi.fn() }))

describe('growth measurement', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('marks a player join and attributes their first hosted room within 30 days', () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValue(86_401_000)

    recordRoomJoined('ROOM1', 'player')
    recordRoomCreated({ source: 'finished-table', customized: false })
    recordRoomCreated({ source: 'home', customized: true })

    expect(track).toHaveBeenCalledWith('Room Joined', { role: 'player' })
    expect(track).toHaveBeenCalledWith('Guest Became Host', {
      source: 'finished-table',
      daysSinceJoin: 1,
    })
    expect(vi.mocked(track).mock.calls.filter(([name]) => name === 'Guest Became Host')).toHaveLength(1)
  })

  it('does not treat a spectator as a future invited-player conversion', () => {
    recordRoomJoined('ROOM1', 'spectator')
    recordRoomCreated({ source: 'home', customized: false })

    expect(vi.mocked(track).mock.calls.some(([name]) => name === 'Guest Became Host')).toBe(false)
  })

  it('deduplicates a start within a tournament and records same-room replay', () => {
    recordGameStarted('ABC123', 1, 4)
    recordGameStarted('ABC123', 1, 5)
    recordGameStarted('ABC123', 2, 6)

    expect(track).toHaveBeenCalledTimes(2)
    expect(track).toHaveBeenCalledWith('Game Started', { playerCount: 4 })
    expect(track).toHaveBeenCalledWith('Game Started', { playerCount: 6 })
  })

  it('deduplicates joins and exposes the host segment on a finish', () => {
    recordRoomJoined('ROOM1', 'player')
    recordRoomJoined('ROOM1', 'player')
    recordTournamentFinished('ROOM1', 1, 4, 22, false)
    recordTournamentFinished('ROOM1', 1, 5, 23, true)
    recordTournamentFinished('ROOM1', 2, 5, 23, true)

    expect(vi.mocked(track).mock.calls.filter(([name]) => name === 'Room Joined')).toHaveLength(1)
    expect(track).toHaveBeenCalledWith('Tournament Finished', {
      playerCount: 4,
      handCount: 22,
      isHost: false,
    })
    expect(track).toHaveBeenCalledWith('Tournament Finished', {
      playerCount: 5,
      handCount: 23,
      isHost: true,
    })
    expect(vi.mocked(track).mock.calls.filter(([name]) => name === 'Tournament Finished')).toHaveLength(2)
  })

  it('counts result-action visibility once for each tournament in a room', () => {
    recordFinishCtaImpression('ROOM1', 1, true, false)
    recordFinishCtaImpression('ROOM1', 1, true, true)
    recordFinishCtaImpression('ROOM1', 2, true, true)

    const impressions = vi.mocked(track).mock.calls.filter(
      ([name]) => name === 'Finish CTA Impression',
    )
    expect(impressions).toHaveLength(2)
    expect(impressions[0]?.[1]).toMatchObject({ initiallyVisible: false })
    expect(impressions[1]?.[1]).toMatchObject({ initiallyVisible: true })
  })

  it('records diagnostic attempts with only coarse viewport and control counts', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 667 })

    recordCreateAttempt({ source: 'dead-invite', customized: true, changedControls: 3 })
    recordInviteOutcome({
      outcome: 'cancelled',
      surface: 'table',
      phase: 'hand',
      isHost: false,
    })
    recordRoomSessionMissing()

    expect(track).toHaveBeenCalledWith('Create Attempted', {
      source: 'dead-invite',
      customized: true,
      changedControls: 3,
      viewport: 'compact-phone',
    })
    expect(track).toHaveBeenCalledWith('Invite Outcome', {
      outcome: 'cancelled',
      surface: 'table',
      phase: 'hand',
      isHost: false,
      viewport: 'compact-phone',
    })
    expect(track).toHaveBeenCalledWith('Room Session Missing', {
      viewport: 'compact-phone',
    })
  })

  it('maps errors to privacy-safe categories instead of sending messages', () => {
    expect(failureCategory({ status: 403, message: 'secret room name' })).toBe(
      'authentication',
    )
    expect(failureCategory({ status: 429 })).toBe('rate-limited')
    expect(failureCategory(new TypeError('network detail'))).toBe('network')
  })
})
