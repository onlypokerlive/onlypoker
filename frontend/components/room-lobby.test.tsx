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
