import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CreateRoomForm } from './create-room-form'
import { pokerApi, saveSession } from '@/lib/poker-api'
import { recordRoomCreated } from '@/lib/growth'

const mocks = vi.hoisted(() => ({ push: vi.fn(), createRoom: vi.fn(), saveSession: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }))
// Signed out. `IdentityPhoto` inside this form reads the session, and rendered
// without the provider that `layout.tsx` wraps the whole app in, `useAuth`
// throws — so what is stood in for here is the provider, not the auth.
vi.mock('@/components/auth-provider', () => ({
  useAuth: () => ({
    user: null,
    profile: null,
    loading: false,
    signInWithGoogle: vi.fn(),
    signOut: vi.fn(),
    refreshProfile: vi.fn(),
  }),
}))
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
  beforeEach(() => {
    vi.clearAllMocks()
    // A host who has created a table before gets their name back — the guest
    // identity is remembered on the device, which is the whole of what "no
    // accounts" means here. It also leaks from one test into the next: the
    // creation test types "Alex", and the validation test below then has a
    // name already filled in and nothing to complain about.
    localStorage.clear()
  })

  it('asks four things, and none of them is a rule of the game', async () => {
    render(<CreateRoomForm />)

    expect(screen.getByLabelText(/Your profile/)).toBeVisible()
    expect(screen.getByLabelText('Table name')).toBeVisible()
    expect(screen.getByLabelText('Password')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Create table' })).toBeVisible()

    // The night itself is agreed in the lobby, with the people it applies to.
    // Every one of these lived on this screen and pushed the button that does
    // the thing below the fold on every phone.
    expect(screen.queryByText(/Customize the night/)).toBeNull()
    expect(screen.queryByLabelText(/blind/i)).toBeNull()
    expect(screen.queryByText(/bomb pot/i)).toBeNull()
  })

  it('creates with the standard table and records the originating path', async () => {
    const session = { roomId: 'ABC123', playerId: 'host', token: 'token', isHost: true }
    vi.mocked(pokerApi.createRoom).mockResolvedValue(session)
    render(<CreateRoomForm source="finished-table" />)

    await userEvent.type(screen.getByLabelText(/Your profile/), 'Alex')
    await userEvent.type(screen.getByLabelText('Password'), 'secret')
    await userEvent.click(screen.getByRole('button', { name: 'Create table' }))

    expect(pokerApi.createRoom).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Poker Night',
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

  it('carries the stakes of the night a rematch is repeating', async () => {
    // "Same again" is the whole of what that button means, and sending the
    // host to the lobby to rebuild the table by hand is the opposite of it.
    const session = { roomId: 'ABC123', playerId: 'host', token: 'token', isHost: true }
    vi.mocked(pokerApi.createRoom).mockResolvedValue(session)
    render(
      <CreateRoomForm
        source="rematch"
        preset={{ smallBlind: 25, bigBlind: 50, startingChips: 10_000, levelMinutes: 20 }}
      />,
    )

    await userEvent.type(screen.getByLabelText(/Your profile/), 'Alex')
    await userEvent.type(screen.getByLabelText('Password'), 'secret')
    await userEvent.click(screen.getByRole('button', { name: 'Create rematch' }))

    expect(pokerApi.createRoom).toHaveBeenCalledWith(
      expect.objectContaining({
        smallBlind: 25,
        bigBlind: 50,
        startingChips: 10_000,
        levelMinutes: 20,
      }),
    )
  })

  it('associates validation with the field and moves focus to the correction', async () => {
    render(<CreateRoomForm />)

    const hostName = screen.getByLabelText(/Your profile/)
    await userEvent.click(screen.getByRole('button', { name: 'Create table' }))

    await waitFor(() => expect(hostName).toHaveFocus())
    expect(hostName).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Enter your display name.')).toHaveAttribute('id', 'hostName-error')
  })

  it('says "table" everywhere, because that is what the button makes', () => {
    // "Room password" used to sit two lines above "Create table". One screen,
    // two words for the same thing.
    render(<CreateRoomForm />)
    expect(screen.queryByText(/room/i)).toBeNull()
  })
})
