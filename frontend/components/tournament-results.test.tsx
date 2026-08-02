import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PlayAgain, TournamentResults } from './tournament-results'
import { gameView, player } from '@/lib/test-fixtures'
import {
  recordFinishCta,
  recordFinishCtaImpression,
  recordResultsShareAttempt,
  recordResultsShareOutcome,
  recordResultsShared,
} from '@/lib/growth'
import { shareTournamentPoster } from '@/lib/tournament-poster'

const mocks = vi.hoisted(() => ({ push: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('@/lib/growth', () => ({
  recordFinishCta: vi.fn(),
  recordFinishCtaImpression: vi.fn(),
  recordResultsShareAttempt: vi.fn(),
  recordResultsShareOutcome: vi.fn(),
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
    expect(recordResultsShareAttempt).toHaveBeenCalledWith(false)
    expect(recordResultsShareOutcome).toHaveBeenCalledWith('native', false)
    expect(recordResultsShared).toHaveBeenCalledWith('native', 2, false)
  })

  it('offers a same-table replay and a fresh table', async () => {
    const onPlayAgain = vi.fn()
    render(
      <>
        <TournamentResults view={finished} />
        <PlayAgain onPlayAgain={onPlayAgain} />
      </>,
    )

    expect(recordFinishCtaImpression).not.toHaveBeenCalledTimes(2)

    await userEvent.click(screen.getByRole('button', { name: 'Play again' }))
    expect(onPlayAgain).toHaveBeenCalledOnce()
    expect(recordFinishCta).toHaveBeenCalledWith('rematch', true)

    await userEvent.click(screen.getByRole('button', { name: 'Create your table' }))
    expect(mocks.push).toHaveBeenLastCalledWith('/?source=finished-table#create-table')
    expect(recordFinishCta).toHaveBeenCalledWith('create', false)
  })
})
