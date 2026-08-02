import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { InviteShareButton } from './invite-share-button'
import { recordInviteAttempt, recordInviteOutcome, recordInviteShared } from '@/lib/growth'
import { shareInvite } from '@/lib/sharing'

vi.mock('@/lib/growth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/growth')>()),
  recordInviteAttempt: vi.fn(),
  recordInviteOutcome: vi.fn(),
  recordInviteShared: vi.fn(),
}))
vi.mock('@/lib/sharing', () => ({ shareInvite: vi.fn() }))

describe('invite share button', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses the shared platform helper and records a successful lobby invite', async () => {
    vi.mocked(shareInvite).mockResolvedValue('native')
    render(
      <InviteShareButton
        roomId="ABC123"
        roomName="Thursday Poker"
        phase="lobby"
        isHost
        playerCount={3}
        surface="lobby"
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Invite players' }))

    expect(shareInvite).toHaveBeenCalledWith({
      roomId: 'ABC123',
      roomName: 'Thursday Poker',
    })
    expect(recordInviteAttempt).toHaveBeenCalledWith({
      surface: 'lobby',
      phase: 'lobby',
      isHost: true,
    })
    expect(recordInviteOutcome).toHaveBeenCalledWith({
      outcome: 'native',
      surface: 'lobby',
      phase: 'lobby',
      isHost: true,
    })
    expect(recordInviteShared).toHaveBeenCalledWith({
      method: 'native',
      surface: 'lobby',
      phase: 'lobby',
      isHost: true,
      playerCount: 3,
    })
  })

  it('does not record a cancelled share sheet', async () => {
    vi.mocked(shareInvite).mockResolvedValue('cancelled')
    render(
      <InviteShareButton
        roomId="ABC123"
        roomName="Thursday Poker"
        phase="hand"
        isHost={false}
        playerCount={4}
        surface="table"
        compact
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Invite players' }))
    expect(recordInviteOutcome).toHaveBeenCalledWith({
      outcome: 'cancelled',
      surface: 'table',
      phase: 'hand',
      isHost: false,
    })
    expect(recordInviteShared).not.toHaveBeenCalled()
  })
})
