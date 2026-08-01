import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { PreActions } from '@/components/pre-actions'
import { gameView, player, session, spectatorView } from '@/lib/test-fixtures'
import { pokerApi } from '@/lib/poker-api'

function show(overrides = {}) {
  // Somebody else is up: the only time planning ahead means anything.
  const view = gameView({ phase: 'hand', actorId: 'p1', ...overrides })
  render(
    <PreActions view={view} roomId="ABC123" onDone={() => {}} session={session} />,
  )
  return view
}

describe('deciding before your turn', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('offers exactly the three that cannot go stale', () => {
    show()
    // No option names an amount. "Call 100" would have to be taken back the
    // moment somebody raises to 300, and getting that wrong costs the player
    // chips they never agreed to lose.
    const labels = screen.getAllByRole('button').map((b) => b.textContent)
    expect(labels).toEqual(['Check', 'Check / fold', 'Call any'])
  })

  it('sends the choice stamped with the hand it was made for', async () => {
    const set = vi.spyOn(pokerApi, 'setPreAction').mockResolvedValue({} as never)
    show()
    await userEvent.click(screen.getByRole('button', { name: 'Call any' }))
    expect(set).toHaveBeenCalledWith('ABC123', 'me', 'call-any', 1, 'secret')
  })

  it('takes it back when the same choice is tapped again', async () => {
    const set = vi.spyOn(pokerApi, 'setPreAction').mockResolvedValue({} as never)
    show({ preAction: 'call-any' })
    await userEvent.click(screen.getByRole('button', { name: 'Call any' }))
    expect(set).toHaveBeenCalledWith('ABC123', 'me', 'clear', 1, 'secret')
  })

  it('shows which one is armed, and says what it will do', () => {
    show({ preAction: 'check-fold' })
    expect(
      screen.getByRole('button', { name: 'Check / fold' }).getAttribute('aria-pressed'),
    ).toBe('true')
    expect(screen.getByText(/otherwise I am out/i)).toBeTruthy()
  })

  it('disappears on your own turn', () => {
    // Planning your own turn is not planning — it is acting by a second route,
    // racing the decision you are about to make with the buttons below.
    show({ actorId: 'me', isYourTurn: true })
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows nothing to somebody who is only watching', () => {
    render(
      <PreActions
        view={spectatorView({ phase: 'hand', actorId: 'p1' })}
        roomId="ABC123"
        onDone={() => {}}
        session={session}
      />,
    )
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows nothing to somebody who has already folded', () => {
    show({ you: player({ id: 'me', isYou: true, folded: true }) })
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows nothing between hands', () => {
    show({ phase: 'handover', actorId: null })
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('when there is no turn coming', () => {
  it('says nothing while everybody is all-in', () => {
    // Found by watching a real all-in: the row sat there offering to pre-fold
    // a hand that was already dealing itself out.
    show({
      actorId: null,
      runoutSeats: ['me', 'p1'],
      you: player({ id: 'me', isYou: true, chips: 0 }),
    })
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('says nothing between streets, when nobody is on the spot', () => {
    show({ actorId: null })
    expect(screen.queryByRole('button')).toBeNull()
  })
})
