import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CreateRoomForm } from './create-room-form'
import { pokerApi, saveSession } from '@/lib/poker-api'
import { recordRoomCreated } from '@/lib/growth'

const mocks = vi.hoisted(() => ({ push: vi.fn(), createRoom: vi.fn(), saveSession: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('@/lib/poker-api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/poker-api')>()
  return {
    ...original,
    pokerApi: { ...original.pokerApi, createRoom: mocks.createRoom },
    saveSession: mocks.saveSession,
  }
})
vi.mock('@/lib/growth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/growth')>()),
  recordRoomCreated: vi.fn(),
}))

describe('quick table creation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps advanced rules collapsed until the host asks for them', async () => {
    render(<CreateRoomForm />)

    expect(screen.getByRole('button', { name: 'Create table' })).toBeVisible()
    expect(screen.getByLabelText('Chips per player')).not.toBeVisible()
    expect(screen.getByLabelText('Table setup')).toBeVisible()
    expect(screen.getByText(/5\/10 blinds · 1,000 chips/)).toBeVisible()

    await userEvent.click(screen.getByText('Customize the night'))
    expect(screen.getByText('Starting stack and opening blinds')).toBeVisible()
    expect(screen.getByLabelText('Chips per player')).not.toBeVisible()
    await userEvent.click(screen.getByText('Stakes'))
    expect(screen.getByLabelText('Chips per player')).toBeVisible()
  })

  it('creates with defaults and records the originating conversion path', async () => {
    const session = { roomId: 'ABC123', playerId: 'host', token: 'token', isHost: true }
    vi.mocked(pokerApi.createRoom).mockResolvedValue(session)
    render(<CreateRoomForm source="finished-table" />)

    await userEvent.type(screen.getByLabelText('Your name'), 'Alex')
    await userEvent.type(screen.getByLabelText('Room password'), 'secret')
    await userEvent.click(screen.getByRole('button', { name: 'Create table' }))

    expect(pokerApi.createRoom).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Friday Night Poker',
        hostName: 'Alex',
        password: 'secret',
        smallBlind: 5,
        bigBlind: 10,
        startingChips: 1000,
      }),
    )
    expect(saveSession).toHaveBeenCalledWith(session)
    expect(recordRoomCreated).toHaveBeenCalledWith({
      source: 'finished-table',
      customized: false,
    })
    expect(mocks.push).toHaveBeenCalledWith('/room/ABC123')
  })

  it('associates validation with the field and moves focus to the correction', async () => {
    render(<CreateRoomForm />)

    const hostName = screen.getByLabelText('Your name')
    await userEvent.click(screen.getByRole('button', { name: 'Create table' }))

    await waitFor(() => expect(hostName).toHaveFocus())
    expect(hostName).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Enter your display name.')).toHaveAttribute('id', 'hostName-error')
  })

  it('keeps the primary create action before progressive customization in tab order', () => {
    render(<CreateRoomForm />)
    const create = screen.getByRole('button', { name: 'Create table' })
    const customize = screen.getByText('Customize the night').closest('summary')!

    expect(create.compareDocumentPosition(customize) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText(/60 sec time bank/)).toBeVisible()
  })
})
