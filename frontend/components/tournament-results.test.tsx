import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TournamentResults, rematchHref } from './tournament-results'
import { gameView, player } from '@/lib/test-fixtures'
import { recordFinishCta, recordResultsShared } from '@/lib/growth'
import { shareTournamentPoster } from '@/lib/tournament-poster'

const mocks = vi.hoisted(() => ({ push: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('@/lib/growth', () => ({
  recordFinishCta: vi.fn(),
  recordResultsShared: vi.fn(),
}))
vi.mock('@/lib/tournament-poster', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tournament-poster')>()),
  shareTournamentPoster: vi.fn().mockResolvedValue('native'),
}))

const finished = gameView({
  phase: 'finished',
  isHost: false,
  handNumber: 18,
  players: [
    player({ id: 'winner', name: 'Nico', isHost: true }),
    player({ id: 'runner', name: 'Sol' }),
  ],
  standings: [
    { place: 1, playerId: 'winner', name: 'Nico', chips: 2000 },
    { place: 2, playerId: 'runner', name: 'Sol', chips: 0 },
  ],
})

describe('the tournament conversion loop', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shares the generated final-table poster', async () => {
    render(<TournamentResults view={finished} />)

    await userEvent.click(screen.getByRole('button', { name: 'Share the night' }))

    expect(shareTournamentPoster).toHaveBeenCalledWith(finished)
    expect(recordResultsShared).toHaveBeenCalledWith('native', 2, false)
  })

  it('offers a settings-preserving rematch and a fresh table', async () => {
    render(<TournamentResults view={finished} />)

    await userEvent.click(screen.getByRole('button', { name: 'Play again' }))
    expect(mocks.push).toHaveBeenLastCalledWith(rematchHref(finished))
    expect(recordFinishCta).toHaveBeenCalledWith('rematch', false)

    await userEvent.click(screen.getByRole('button', { name: 'Create your table' }))
    expect(mocks.push).toHaveBeenLastCalledWith('/?source=finished-table#create-table')
    expect(recordFinishCta).toHaveBeenCalledWith('create', false)
  })
})
