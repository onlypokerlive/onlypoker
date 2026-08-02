import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { JoinRoomForm } from '@/components/join-room-form'
import { pokerApi, saveSession } from '@/lib/poker-api'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  joinRoom: vi.fn(),
  watchRoom: vi.fn(),
  recoverHost: vi.fn(),
  saveSession: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('@/lib/poker-api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/poker-api')>()
  return {
    ...original,
    pokerApi: {
      ...original.pokerApi,
      joinRoom: mocks.joinRoom,
      watchRoom: mocks.watchRoom,
      recoverHost: mocks.recoverHost,
    },
    saveSession: mocks.saveSession,
  }
})

describe('JoinRoomForm', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps the private room password concealed and explains that watchers need no name', () => {
    render(<JoinRoomForm roomId="ABC123" />)

    expect(screen.getByLabelText('Room password')).toHaveAttribute('type', 'password')
    expect(screen.getByText('Only needed when you take a seat.')).toBeVisible()
  })

  it('associates a missing player name and focuses it', async () => {
    render(<JoinRoomForm roomId="ABC123" />)
    const name = screen.getByLabelText('Your name (for a seat)')

    await userEvent.click(screen.getByRole('button', { name: 'Take a seat' }))

    await waitFor(() => expect(name).toHaveFocus())
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Enter a display name.')).toHaveAttribute('id', 'name-error')
  })

  it('lets a spectator enter without a display name', async () => {
    const session = {
      roomId: 'ABC123',
      playerId: 'watch-1',
      token: 'watch-token',
      isHost: false,
      spectator: true,
    }
    vi.mocked(pokerApi.watchRoom).mockResolvedValue(session)
    render(<JoinRoomForm roomId="ABC123" />)

    await userEvent.type(screen.getByLabelText('Room password'), 'secret')
    await userEvent.click(screen.getByRole('button', { name: 'Just watch' }))

    expect(pokerApi.watchRoom).toHaveBeenCalledWith('ABC123', 'secret')
    expect(saveSession).toHaveBeenCalledWith(session)
  })

  it('recovers host access with the separate one-time backup', async () => {
    const recovered = {
      roomId: 'ABC123',
      playerId: 'host',
      token: 'new-token',
      isHost: true,
      recoveryCode: 'next-backup-code',
    }
    vi.mocked(pokerApi.recoverHost).mockResolvedValue(recovered)
    render(<JoinRoomForm roomId="ABC123" />)

    await userEvent.type(screen.getByLabelText('Room password'), 'secret')
    await userEvent.click(screen.getByText('Host on a new device?'))
    await userEvent.type(screen.getByLabelText('Host backup code'), 'old-backup-code')
    await userEvent.click(screen.getByRole('button', { name: 'Recover host access' }))

    expect(pokerApi.recoverHost).toHaveBeenCalledWith(
      'ABC123',
      'secret',
      'old-backup-code',
    )
    expect(saveSession).toHaveBeenCalledWith(recovered)
    expect(mocks.push).toHaveBeenCalledWith('/room/ABC123')
  })

  it('keeps a refused recovery neutral and focuses the shared error', async () => {
    vi.mocked(pokerApi.recoverHost).mockRejectedValue(
      new Error('The password or host backup code is incorrect.'),
    )
    render(<JoinRoomForm roomId="ABC123" />)

    await userEvent.type(screen.getByLabelText('Room password'), 'secret')
    await userEvent.click(screen.getByText('Host on a new device?'))
    await userEvent.type(screen.getByLabelText('Host backup code'), 'wrong-backup-code')
    await userEvent.click(screen.getByRole('button', { name: 'Recover host access' }))

    const alert = await screen.findByRole('alert')
    await waitFor(() => expect(alert).toHaveFocus())
    expect(alert).toHaveTextContent('password or host backup code')
    expect(screen.getByLabelText('Room password')).toHaveAttribute('aria-invalid', 'false')
    expect(screen.getByLabelText('Host backup code')).toHaveAttribute('aria-invalid', 'false')
  })
})
