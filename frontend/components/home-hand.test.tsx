import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { HomeHand } from '@/components/home-hand'

/**
 * The cast, not the choreography.
 *
 * jsdom does no layout and runs no animation, so everything about *when* this
 * scene shows what is in `e2e/home-hand.spec.ts`. What is worth pinning here is
 * that the hand itself is the hand — quads for the seven-deuce — because that
 * is the whole joke and it is spelled out across eleven separate elements that
 * nothing else compares to each other.
 */
describe('HomeHand', () => {
  it('deals the seven-deuce that beats two big pairs', () => {
    const { container } = render(<HomeHand />)

    const cards = [...container.querySelectorAll('.home-card')].map(
      (c) => c.querySelector('.home-rank')!.textContent! + c.querySelector('.home-pip')!.textContent,
    )
    expect(cards).toEqual([
      'A♠', 'A♣', // Andylon
      'K♠', 'K♦', // Alvariki
      'A♦', 'K♥', '7♠', '7♥', '7♣', // the board
      '7♦', '2♣', // Blinsky, who is about to be insufferable
    ])

    // The five that make the hand: four sevens and the ace. Marked in the
    // markup rather than worked out at render, but they still have to be the
    // five that actually win.
    const lit = [...container.querySelectorAll('.home-card[data-win]')].map(
      (c) => c.querySelector('.home-rank')!.textContent! + c.querySelector('.home-pip')!.textContent,
    )
    expect(lit.sort()).toEqual(['7♠', '7♥', '7♣', '7♦', 'A♦'].sort())
  })

  it('is one image to a screen reader, not a pile of furniture', () => {
    render(<HomeHand />)
    expect(
      screen.getByRole('img', { name: /goes all in with seven-deuce/i }),
    ).toBeInTheDocument()
    // Three faces, and none of them announces itself separately.
    expect(screen.queryAllByRole('img', { name: /photo/i })).toHaveLength(0)
  })
})
