import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { HostPanel } from '@/components/host-panel'
import { pokerApi, saveSession, type Session } from '@/lib/poker-api'
import { gameView, player } from '@/lib/test-fixtures'

vi.mock('@/lib/poker-api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/poker-api')>()
  return {
    ...original,
    pokerApi: {
      ...original.pokerApi,
      createHostBackup: vi.fn(),
      transferHost: vi.fn(),
    },
    saveSession: vi.fn(),
  }
})

const host = player({ id: 'me', name: 'Alex', isYou: true, isHost: true })
const guest = player({ id: 'guest', name: 'Sam', seat: 2 })
const view = gameView({
  phase: 'lobby',
  handNumber: 0,
  isHost: true,
  you: host,
  players: [host, guest],
})
const session: Session = {
  roomId: 'ABC123',
  playerId: 'me',
  token: 'host-token',
  isHost: true,
}

describe('accountless host continuity', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates and saves a one-time backup code', async () => {
    vi.mocked(pokerApi.createHostBackup).mockResolvedValue({
      ...session,
      recoveryCode: 'new-backup-code',
    })
    render(
      <HostPanel view={view} roomId="ABC123" onDone={vi.fn()} session={session} />,
    )

    await userEvent.click(screen.getByText('Host controls'))
    await userEvent.click(screen.getByRole('button', { name: 'Create backup code' }))

    expect(pokerApi.createHostBackup).toHaveBeenCalledWith('ABC123', 'me', 'host-token')
    expect(saveSession).toHaveBeenCalledWith({ ...session, recoveryCode: 'new-backup-code' })
    expect(screen.getByText('new-backup-code')).toBeVisible()
  })

  it('requires confirmation before transferring the table to a seated player', async () => {
    vi.mocked(pokerApi.transferHost).mockResolvedValue({} as never)
    const onDone = vi.fn()
    render(
      <HostPanel
        view={view}
        roomId="ABC123"
        onDone={onDone}
        session={{ ...session, recoveryCode: 'saved-backup' }}
      />,
    )

    await userEvent.click(screen.getByText('Host controls'))
    await userEvent.click(screen.getByRole('button', { name: 'Make Sam the host' }))
    expect(pokerApi.transferHost).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Make host' }))

    expect(pokerApi.transferHost).toHaveBeenCalledWith(
      'ABC123',
      'me',
      'guest',
      'host-token',
    )
    expect(onDone).toHaveBeenCalledOnce()
  })
})
