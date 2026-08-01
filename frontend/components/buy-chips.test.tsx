import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { BuyChips } from '@/components/buy-chips'
import { gameView, player, session, spectatorView } from '@/lib/test-fixtures'
import { pokerApi } from '@/lib/poker-api'

const BETWEEN_HANDS = { phase: 'handover' as const }

function show(overrides = {}) {
  const view = gameView({ ...BETWEEN_HANDS, ...overrides })
  render(
    <BuyChips view={view} roomId="ABC123" onDone={() => {}} session={session} />,
  )
  return view
}

describe('coming back and going home', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('offers a way out, because leaving early is normal', () => {
    show()
    expect(screen.getByRole('button', { name: /leave the table/i })).toBeTruthy()
  })

  it('asks before letting anybody go', async () => {
    const leave = vi.spyOn(pokerApi, 'leaveTable').mockResolvedValue({} as never)
    show()
    await userEvent.click(screen.getByRole('button', { name: /leave the table/i }))
    expect(leave).not.toHaveBeenCalled()
    // The stack goes home with them and the tournament carries on without it.
    // There is no undo, so the confirmation is the whole control.
    await userEvent.click(screen.getByRole('button', { name: /cash out/i }))
    expect(leave).toHaveBeenCalledWith('ABC123', 'me', 1, 'secret')
  })

  it('shows nothing at all to somebody who is only watching', () => {
    // `!you?.leaving` is *true* for a spectator, which is how a table ends up
    // offering a chair to somebody who does not have one.
    render(
      <BuyChips
        view={spectatorView({ ...BETWEEN_HANDS, rebuyOpen: true, addOn: true })}
        roomId="ABC123"
        onDone={() => {}}
        session={session}
      />,
    )
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('offers the buy-back only to somebody with nothing left', () => {
    show({ rebuyOpen: true, you: player({ id: 'me', isYou: true, chips: 0 }) })
    expect(screen.getByRole('button', { name: /buy back in/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Add /i })).toBeNull()
  })

  it('offers the add-on only to somebody still holding chips', () => {
    show({ rebuyOpen: true, addOn: true })
    expect(screen.getByRole('button', { name: /^Add /i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /buy back in/i })).toBeNull()
  })

  it('offers the add-on once', () => {
    show({
      rebuyOpen: true,
      addOn: true,
      you: player({ id: 'me', isYou: true, addOnTaken: true }),
    })
    expect(screen.queryByRole('button', { name: /^Add /i })).toBeNull()
  })

  it('says nothing about buying when the window is shut', () => {
    show({ rebuyOpen: false, you: player({ id: 'me', isYou: true, chips: 0 }) })
    expect(screen.queryByRole('button', { name: /buy back in/i })).toBeNull()
  })

  it('says so once you have already asked to leave', () => {
    show({ you: player({ id: 'me', isYou: true, leaving: true }) })
    expect(screen.getByText(/leaving after this hand/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /leave the table/i })).toBeNull()
  })

  it('has no way out on a table the host said is played to the end', () => {
    show({ allowLeaving: false })
    expect(screen.queryByRole('button', { name: /leave the table/i })).toBeNull()
  })
})
