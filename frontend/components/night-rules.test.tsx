import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NightRules } from './night-rules'
import { gameView, session } from '@/lib/test-fixtures'
import { pokerApi } from '@/lib/poker-api'
import type { GameView } from '@/lib/poker-api'

const mocks = vi.hoisted(() => ({ setRules: vi.fn() }))

vi.mock('@/lib/poker-api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/poker-api')>()
  return { ...original, pokerApi: { ...original.pokerApi, setRules: mocks.setRules } }
})

function lobby(room: Partial<GameView['room']> = {}, isHost = true): GameView {
  const view = gameView({ phase: 'lobby', isHost, room: { phase: 'lobby', ...room } })
  return { ...view, you: { ...view.you!, isHost } }
}

function renderRules(view = lobby()) {
  const onSaved = vi.fn()
  render(
    <NightRules view={view} roomId="ABC123" session={session} onSaved={onSaved} />,
  )
  return onSaved
}

describe('the rules of the night', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.setRules.mockResolvedValue({ room: lobby().room, players: [] })
  })

  it('reads the night back in full, including the rules that are off', async () => {
    // A row that disappears when its rule is off reads as a row that failed to
    // load, and this list is what somebody scans to check they got what they
    // meant.
    renderRules()
    expect(screen.getByText('No extras')).toBeVisible()
    expect(screen.getByText('No ante')).toBeVisible()
    expect(screen.getByText(/1,000 · 100 blinds/)).toBeVisible()
  })

  it('sets the whole night from one tap on a format', async () => {
    renderRules()
    await userEvent.click(screen.getByRole('button', { name: /Chaos/ }))

    await waitFor(() => expect(pokerApi.setRules).toHaveBeenCalled())
    const [, , payload] = vi.mocked(pokerApi.setRules).mock.calls[0]
    expect(payload).toMatchObject({
      sevenDeuce: 5,
      bombPotEvery: 8,
      straddle: true,
      runItTwice: true,
    })
  })

  it('does not rename the table when the format changes', async () => {
    // Somebody who called it "Marta's leaving do" and then taps Chaos should
    // still have Marta's leaving do.
    renderRules(lobby())
    await userEvent.click(screen.getByRole('button', { name: /Fast/ }))
    await waitFor(() => expect(pokerApi.setRules).toHaveBeenCalled())
    const [, , payload] = vi.mocked(pokerApi.setRules).mock.calls[0]
    expect(payload).toMatchObject({ name: 'Test table' })
  })

  it('shows a guest the rules without offering to change them', () => {
    renderRules(lobby({}, false))
    expect(screen.getByText(/The host sets them/)).toBeVisible()
    expect(screen.queryByRole('button', { name: /Chaos/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Adjust the detail' })).toBeNull()
  })
})

describe('the detail sheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.setRules.mockResolvedValue({ room: lobby().room, players: [] })
  })

  it('opens every setting the server accepts, not the three the form used to', async () => {
    renderRules()
    await userEvent.click(screen.getByRole('button', { name: 'Adjust the detail' }))
    const sheet = screen.getByRole('dialog')

    // The nine that were hard-coded, and the two the engine could not do.
    expect(within(sheet).getByText('Clock and time bank')).toBeVisible()
    expect(within(sheet).getByText('House rules')).toBeVisible()
    expect(within(sheet).getByText('Doors and rebuys')).toBeVisible()
    expect(within(sheet).getByText('Pace')).toBeVisible()
  })

  it('asks for the stack in blinds and shows what that comes to in chips', async () => {
    renderRules()
    await userEvent.click(screen.getByRole('button', { name: 'Adjust the detail' }))
    const sheet = screen.getByRole('dialog')

    // "1000" says nothing without the blinds beside it.
    expect(within(sheet).getByText('1,000 chips at 5/10.')).toBeVisible()
    await userEvent.click(within(sheet).getByRole('button', { name: '200 blinds' }))
    expect(within(sheet).getByText('2,000 chips at 5/10.')).toBeVisible()
  })

  it('lets a number out of the choices offered', async () => {
    renderRules()
    await userEvent.click(screen.getByRole('button', { name: 'Adjust the detail' }))
    const sheet = screen.getByRole('dialog')
    const group = within(sheet).getByRole('group', {
      name: 'What everybody starts with',
    })

    await userEvent.click(within(group).getByRole('button', { name: 'Other' }))
    const free = within(sheet).getByLabelText('What everybody starts with, exact value')
    await userEvent.clear(free)
    await userEvent.type(free, '150')
    expect(within(sheet).getByText('1,500 chips at 5/10.')).toBeVisible()
  })

  it('sends nothing until Save, so half-made rules never reach the lobby', async () => {
    renderRules()
    await userEvent.click(screen.getByRole('button', { name: 'Adjust the detail' }))
    const sheet = screen.getByRole('dialog')

    await userEvent.click(within(sheet).getByRole('button', { name: '200 blinds' }))
    expect(pokerApi.setRules).not.toHaveBeenCalled()

    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(pokerApi.setRules).toHaveBeenCalledOnce())
    const [, , payload] = vi.mocked(pokerApi.setRules).mock.calls[0]
    expect(payload).toMatchObject({ startingChips: 2000 })
  })

  it('drops the time bank with the clock it belongs to', async () => {
    // Sixty extra seconds added to a countdown that does not exist.
    renderRules()
    await userEvent.click(screen.getByRole('button', { name: 'Adjust the detail' }))
    const sheet = screen.getByRole('dialog')

    await userEvent.click(within(sheet).getByText('Clock and time bank'))
    const clock = within(sheet).getByRole('group', { name: 'Time to act' })
    await userEvent.click(within(clock).getByRole('button', { name: 'None' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(pokerApi.setRules).toHaveBeenCalled())
    const [, , payload] = vi.mocked(pokerApi.setRules).mock.calls[0]
    expect(payload).toMatchObject({ actionSeconds: 0, timeBankSeconds: 0 })
  })
})
