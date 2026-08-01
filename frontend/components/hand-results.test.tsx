import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { HandResults } from '@/components/hand-results'
import { gameView } from '@/lib/test-fixtures'
import { resultsMessage } from '@/lib/poker-api'

const WON = [
  { playerId: 'me', name: 'Ana', delta: 2000, won: 3000 },
  { playerId: 'p1', name: 'Marcos', delta: -1000, won: 0 },
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

describe('the line above the pot', () => {
  it('names the winner and what the hand left them', () => {
    expect(resultsMessage(WON)).toBe('Ana (+2,000) won the pot')
  })

  it('says a chop was a chop instead of saying nothing', () => {
    // Both players get back exactly what they put in, so `delta` is zero for
    // each of them — and asked that way this line found no winner and stayed
    // silent, on the one hand where the whole table is waiting to be told.
    expect(
      resultsMessage([
        { playerId: 'a', name: 'Ana', delta: 0, won: 150 },
        { playerId: 'b', name: 'Beto', delta: 0, won: 150 },
      ]),
    ).toBe('Ana and Beto split the pot')
  })

  it('names somebody who won a side pot and still finished down', () => {
    // 100 in, 20 back out of a pot only they could win. They won something.
    expect(
      resultsMessage([
        { playerId: 'a', name: 'Ana', delta: -80, won: 20 },
        { playerId: 'b', name: 'Beto', delta: 80, won: 180 },
      ]),
    ).toContain('Beto')
  })

  it('says nothing about a hand nobody has finished', () => {
    expect(resultsMessage([])).toBeNull()
  })
})
