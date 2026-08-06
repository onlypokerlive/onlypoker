import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

  describe('and stops when it has said its piece', () => {
    afterEach(() => vi.useRealTimers())

    it('holds the decided hand after two turns round', () => {
      vi.useFakeTimers()
      const { container } = render(<HomeHand />)
      const table = container.querySelector('.home-table')!

      expect(table).not.toHaveAttribute('data-settled')
      act(() => void vi.advanceTimersByTime(13_000 * 2 - 1))
      expect(table, 'settled before the second turn finished').not.toHaveAttribute('data-settled')

      act(() => void vi.advanceTimersByTime(1))
      // Fifty-one infinite animations on the screen somebody types their name
      // into is a phone's battery spent repeating a thirteen-second story.
      expect(table).toHaveAttribute('data-settled')
    })

    it('does not run the clock down while the tab is in the background', () => {
      vi.useFakeTimers()
      const { container } = render(<HomeHand />)
      const table = container.querySelector('.home-table')!

      const hide = (hidden: boolean) => {
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(hidden)
        act(() => void document.dispatchEvent(new Event('visibilitychange')))
      }

      act(() => void vi.advanceTimersByTime(5_000))
      hide(true)
      expect(table).toHaveAttribute('data-paused')

      // Twenty minutes away. Somebody coming back deserves the rest of the
      // hand, not a table that finished without them.
      act(() => void vi.advanceTimersByTime(20 * 60_000))
      expect(table).not.toHaveAttribute('data-settled')

      hide(false)
      expect(table).not.toHaveAttribute('data-paused')
      act(() => void vi.advanceTimersByTime(13_000 * 2 - 5_000))
      expect(table).toHaveAttribute('data-settled')
    })
  })
})
