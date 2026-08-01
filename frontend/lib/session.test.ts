import { describe, expect, it, beforeEach } from 'vitest'

import { ApiError, clearSession, loadSession, saveSession } from './poker-api'

describe('the session kept on this device', () => {
  beforeEach(() => localStorage.clear())

  it('comes back the way it was saved', () => {
    saveSession({ roomId: 'ABC123', playerId: 'p1', token: 'secret', isHost: true })
    expect(loadSession('ABC123')).toEqual({
      roomId: 'ABC123',
      playerId: 'p1',
      token: 'secret',
      isHost: true,
    })
  })

  it('refuses one with no credential', () => {
    // What a deploy over an older bundle leaves behind. It looks like being
    // signed in and is refused by every request it can make, so treating it as
    // a session buys a screen that never loads.
    localStorage.setItem(
      'holdem:session:ABC123',
      JSON.stringify({ roomId: 'ABC123', playerId: 'p1', isHost: false }),
    )
    expect(loadSession('ABC123')).toBeNull()
  })

  it('refuses one that is not a session at all', () => {
    localStorage.setItem('holdem:session:ABC123', 'not json')
    expect(loadSession('ABC123')).toBeNull()
  })

  it('forgets a room on request', () => {
    saveSession({ roomId: 'ABC123', playerId: 'p1', token: 'secret', isHost: false })
    clearSession('ABC123')
    expect(loadSession('ABC123')).toBeNull()
  })
})

describe('a failed request', () => {
  it('keeps the status so a refusal can be told from a hiccup', () => {
    expect(new ApiError('This table is private.', 403).isAuthFailure).toBe(true)
    expect(new ApiError('Room not found.', 404).isAuthFailure).toBe(true)
    expect(new ApiError('Start a new one.', 401).isAuthFailure).toBe(true)
    // A contended room is a retry, not a reason to throw the session away.
    expect(new ApiError('Room busy.', 503).isAuthFailure).toBe(false)
    expect(new ApiError('It is not your turn.', 409).isAuthFailure).toBe(false)
  })

  it('tells being removed from a refusal, because the key must be kept', () => {
    // Every other refusal means this device is holding something the table
    // does not accept, so the answer is to throw it away and go back to the
    // door. Being removed is the opposite: the credential is the only thing
    // that tells this device from a stranger's when it gets there, and the
    // password is no help — everybody at the table has it, including the
    // person who was just asked to leave.
    const removed = new ApiError('The host removed you from this table.', 410)
    expect(removed.isRemoved).toBe(true)
    expect(removed.isAuthFailure).toBe(false)
    expect(new ApiError('This table is private.', 403).isRemoved).toBe(false)
  })

  it('is still an Error, so existing handlers keep working', () => {
    const err = new ApiError('nope', 403)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('nope')
  })
})
