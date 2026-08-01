import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { HandResults } from '@/components/hand-results'
import { gameView } from '@/lib/test-fixtures'

const WON = [
  { playerId: 'me', name: 'Ana', delta: 2000 },
  { playerId: 'p1', name: 'Marcos', delta: -1000 },
]

describe('the hand results panel', () => {
  it('says a pot was won without showing when it was', () => {
    // Everybody folded: the winner never had to reveal anything, and an empty
    // space where the hand name goes reads like something failed to load.
    render(
      <HandResults
        view={gameView({ phase: 'handover', lastResults: WON, wentToShowdown: false })}
      />,
    )
    expect(screen.getByText(/won without showing/i)).toBeTruthy()
  })

  it('does not say it about a hand that was shown down', () => {
    // This came apart when a pot run twice stopped naming hands — the same
    // player usually has two different ones — and every all-in showdown
    // started claiming it had been won without showing.
    render(
      <HandResults
        view={gameView({
          phase: 'handover',
          lastResults: WON,
          wentToShowdown: true,
          boardResults: [
            { cards: ['9s', '3d', '8d', '7h', 'Ad'], winners: ['Ana'] },
            { cards: ['2c', '2d', 'Tc', 'Th', 'Jh'], winners: ['Marcos'] },
          ],
        })}
      />,
    )
    expect(screen.queryByText(/won without showing/i)).toBeNull()
  })

  it('shows both boards and who took each', () => {
    render(
      <HandResults
        view={gameView({
          phase: 'handover',
          lastResults: WON,
          wentToShowdown: true,
          boardResults: [
            { cards: ['9s', '3d', '8d', '7h', 'Ad'], winners: ['Ana'] },
            { cards: ['2c', '2d', 'Tc', 'Th', 'Jh'], winners: ['Marcos'] },
          ],
        })}
      />,
    )
    // Named once per board, on top of once per player in the list below.
    expect(screen.getAllByText('Ana').length).toBeGreaterThan(1)
    expect(screen.getAllByText('Marcos').length).toBeGreaterThan(1)
  })

  it('shows no board list at all when it ran once', () => {
    render(
      <HandResults
        view={gameView({
          phase: 'handover',
          lastResults: WON,
          wentToShowdown: true,
          boardResults: [{ cards: ['9s', '3d', '8d', '7h', 'Ad'], winners: ['Ana'] }],
        })}
      />,
    )
    expect(screen.getAllByText('Ana').length).toBe(1)
  })
})
