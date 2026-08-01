import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { RunoutOffer } from '@/components/runout-offer'
import { gameView, session } from '@/lib/test-fixtures'
import { pokerApi } from '@/lib/poker-api'

function show(overrides = {}) {
  render(
    <RunoutOffer
      view={gameView({ phase: 'hand', ...overrides })}
      roomId="ABC123"
      onDone={() => {}}
      session={session}
    />,
  )
}

describe('running it twice', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('says nothing when nobody is being asked', () => {
    show()
    expect(screen.queryByText(/run it twice/i)).toBeNull()
  })

  it('asks the players who are in it', async () => {
    const choose = vi.spyOn(pokerApi, 'chooseRunout').mockResolvedValue({} as never)
    show({ runoutSeats: ['me', 'p1'], askedAboutRunout: true })
    expect(screen.getByText(/has to agree/i)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Twice' }))
    expect(choose).toHaveBeenCalledWith('ABC123', 'me', 'twice', 1, 'secret')
  })

  it('lets one refusal through, because it is unanimous or not at all', async () => {
    const choose = vi.spyOn(pokerApi, 'chooseRunout').mockResolvedValue({} as never)
    show({ runoutSeats: ['me'], askedAboutRunout: true })
    await userEvent.click(screen.getByRole('button', { name: 'Once' }))
    expect(choose).toHaveBeenCalledWith('ABC123', 'me', 'once', 1, 'secret')
  })

  it('tells the rest of the table what the pause is for', () => {
    // Otherwise the wait before the cards come out looks like the app hanging.
    show({ runoutSeats: ['p1'], askedAboutRunout: false })
    expect(screen.getByText(/waiting for marcos/i)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
