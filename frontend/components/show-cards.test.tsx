import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ShowCards } from '@/components/show-cards'
import { gameView, player, session } from '@/lib/test-fixtures'
import { pokerApi, type GameView, type PlayerView } from '@/lib/poker-api'

vi.mock('@/lib/poker-api', async () => {
  const real = await vi.importActual<typeof import('@/lib/poker-api')>('@/lib/poker-api')
  return { ...real, pokerApi: { ...real.pokerApi, showCards: vi.fn().mockResolvedValue({}) } }
})

const showCards = vi.mocked(pokerApi.showCards)

/** You, with a hand worth arguing about. */
function withHand(
  overrides: Partial<GameView> = {},
  yours: Partial<PlayerView> = {},
): GameView {
  const you = player({ id: 'me', name: 'You', isYou: true, cards: ['As', '7d'], ...yours })
  return gameView({ ...overrides, you, players: [you, player()] })
}

function draw(view: GameView) {
  render(
    <ShowCards view={view} roomId="ABC123" onShown={vi.fn()} session={session} />,
  )
}

beforeEach(() => showCards.mockClear())

describe('picking what to show', () => {
  it('offers the cards themselves rather than "1st" and "2nd"', async () => {
    draw(withHand({ phase: 'handover' }))
    // Nobody holds a hand as a numbered list: the choice is between the ace
    // and the seven, so what you tap is the ace or the seven.
    expect(screen.getByRole('button', { name: 'Show As' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show 7d' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '1st' })).toBeNull()
  })

  it('sends only the cards that were picked', async () => {
    draw(withHand({ phase: 'handover' }))
    await userEvent.click(screen.getByRole('button', { name: 'Show 7d' }))
    await userEvent.click(screen.getByRole('button', { name: 'Show it' }))
    expect(showCards).toHaveBeenCalledWith('ABC123', 'me', [1], 1, 'secret')
  })

  it('will not send an empty hand', () => {
    draw(withHand({ phase: 'handover' }))
    expect(screen.getByRole('button', { name: 'Show' })).toBeDisabled()
  })

  it('locks a card that is already public', () => {
    draw(withHand({ phase: 'handover' }, { shownIndices: [0] }))
    expect(screen.getByRole('button', { name: 'Already showing As' })).toBeDisabled()
  })

  it('says nothing when your own cards were turned over at the showdown', () => {
    const { container } = render(
      <ShowCards
        view={withHand({ phase: 'handover', wentToShowdown: true }, { showedDown: true })}
        roomId="ABC123"
        onShown={vi.fn()}
        session={session}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('still asks the player who folded a hand two others showed down', () => {
    // A showdown reveals the players who were in it. Somebody who folded
    // earlier is the one player at the table with a bluff left to prove, and
    // reading the showdown flag alone was the one case that never asked them.
    draw(withHand({ phase: 'handover', wentToShowdown: true }, { folded: true }))
    expect(screen.getByRole('button', { name: 'Show As' })).toBeInTheDocument()
  })

  it('asks the player who reached the showdown and never had to show', () => {
    // Beaten, and speaking after the winner. The rule says the hand goes in
    // the muck unseen; the app must not turn it over for them, and must still
    // let them turn it over themselves.
    draw(withHand({ phase: 'handover', wentToShowdown: true }, { showedDown: false }))
    expect(screen.getByRole('button', { name: 'Show As' })).toBeInTheDocument()
  })
})

describe('deciding on the fold, mid-hand', () => {
  it('asks a player who has folded, while the hand is still running', () => {
    draw(withHand({}, { folded: true }))
    expect(screen.getByText('Show at the end?')).toBeInTheDocument()
  })

  it('never asks somebody still in the hand', () => {
    // A live player showing a card is passing information to the people
    // deciding what to do about it.
    const { container } = render(
      <ShowCards view={withHand()} roomId="ABC123" onShown={vi.fn()} session={session} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('saves the pick as it is made, and takes it back the same way', async () => {
    draw(withHand({}, { folded: true }))
    await userEvent.click(screen.getByRole('button', { name: 'Show As' }))
    expect(showCards).toHaveBeenLastCalledWith('ABC123', 'me', [0], 1, 'secret')
    // Nothing has happened yet, so tapping it again is a real undo.
    await userEvent.click(screen.getByRole('button', { name: 'Showing As' }))
    expect(showCards).toHaveBeenLastCalledWith('ABC123', 'me', [], 1, 'secret')
  })

  it('shows the plan the server already has', () => {
    draw(withHand({}, { folded: true, pendingShowIndices: [1] }))
    expect(screen.getByRole('button', { name: 'Showing 7d' })).toBeInTheDocument()
    expect(screen.getByText('One card, when the hand ends')).toBeInTheDocument()
  })
})
