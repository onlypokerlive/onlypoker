import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { RoomLobby } from '@/components/room-lobby'
import { gameView, player } from '@/lib/test-fixtures'

const host = player({
  id: 'host',
  name: 'Alex',
  seat: 0,
  isHost: true,
  isYou: true,
})

function lobby(players = [host]) {
  return gameView({
    phase: 'lobby',
    handNumber: 0,
    roomName: 'Friday Night Poker',
    players,
    you: host,
    isHost: true,
  })
}

describe('RoomLobby', () => {
  it('makes inviting the next action while the table is one player short', () => {
    render(<RoomLobby
        view={lobby()}
        roomId="ABC123"
        session={null}
        onStart={vi.fn()}
        onRulesSaved={vi.fn()}
        busy={false}
      />)

    expect(screen.getByRole('img', { name: '1 of 9 seats filled' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Invite players' })).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent('One more player is needed to deal in')
    expect(screen.queryByRole('button', { name: 'Start game' })).not.toBeInTheDocument()
    // Both questions somebody has while staring at eight empty seats.
    expect(screen.getByText(/You start it\. Two is enough to deal\./)).toBeInTheDocument()
  })

  it('lets the ring be the roster, and does not draw it twice', () => {
    const guest = player({ id: 'guest', name: 'Sam', seat: 4, isYou: false })
    const { container } = render(<RoomLobby
        view={lobby([host, guest])}
        roomId="ABC123"
        session={null}
        onStart={vi.fn()}
        onRulesSaved={vi.fn()}
        busy={false}
      />)

    // One seat per chair, and nothing drawn beside it. The visible list said
    // the same nine names the ring already shows, and the two hundred pixels it
    // cost were what pushed the button that deals the cards off the phone.
    expect(container.querySelectorAll('.lobby-seat-rail [title^="Seat "]')).toHaveLength(9)
    expect(container.querySelector('ul:not(.sr-only ul)')).toBeNull()

    // But the roster is still *said*, at no cost in height. A drawing announces
    // itself as "2 of 9 seats filled" and stops, and that is less than this
    // screen knew before the list was taken out of it.
    const roster = screen.getByRole('list')
    expect(roster.closest('.sr-only')).not.toBeNull()
    expect(roster).toHaveTextContent('Seat 1: Alex, host, you')
    expect(roster).toHaveTextContent('Seat 5: Sam')
    expect(screen.getByText('7 seats still open.')).toBeInTheDocument()

    // The host wears a crown, which is the whole of how you know whose table
    // it is: no room taken, nothing moved, nothing to read.
    expect(screen.getByText('♛')).toBeInTheDocument()
  })

  it('unlocks the host start action once another chair is occupied', async () => {
    const onStart = vi.fn()
    const guest = player({ id: 'guest', name: 'Sam', seat: 4, isYou: false })
    render(<RoomLobby
        view={lobby([host, guest])}
        roomId="ABC123"
        session={null}
        onStart={onStart}
        onRulesSaved={vi.fn()}
        busy={false}
      />)

    expect(screen.getByRole('img', { name: '2 of 9 seats filled' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Start game' }))
    expect(onStart).toHaveBeenCalledOnce()
  })
})
