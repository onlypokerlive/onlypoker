import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  failureCategory,
  recordCreateAttempt,
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

  it('deduplicates a game start for one room', () => {
    recordGameStarted('ABC123', 4)
    recordGameStarted('ABC123', 5)

    expect(track).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith('Game Started', { playerCount: 4 })
  })

  it('deduplicates joins and exposes the host segment on a finish', () => {
    recordRoomJoined('ROOM1', 'player')
    recordRoomJoined('ROOM1', 'player')
    recordTournamentFinished('ROOM1', 4, 22, false)
    recordTournamentFinished('ROOM1', 5, 23, true)

    expect(vi.mocked(track).mock.calls.filter(([name]) => name === 'Room Joined')).toHaveLength(1)
    expect(track).toHaveBeenCalledWith('Tournament Finished', {
      playerCount: 4,
      handCount: 22,
      isHost: false,
    })
    expect(vi.mocked(track).mock.calls.filter(([name]) => name === 'Tournament Finished')).toHaveLength(1)
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
