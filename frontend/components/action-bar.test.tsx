import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ActionBar, waitingMessage } from '@/components/action-bar'
import type { GameView } from '@/lib/poker-api'
import { gameView, player } from '@/lib/test-fixtures'

const YOUR_TURN = {
  isYourTurn: true,
  actorId: 'me',
  legal: {
    canFold: true,
    canCheck: false,
    canRaise: true,
    callAmount: 10,
    minRaise: 20,
    maxRaise: 1000,
  },
} satisfies Partial<GameView>

describe('waitingMessage', () => {
  it('names the player the table is waiting on', () => {
    expect(waitingMessage(gameView())).toBe('Marcos is up')
  })

  it('does not invent a name between streets', () => {
    // actorId is null while the board is being dealt and while a hand settles.
    expect(waitingMessage(gameView({ actorId: null }))).toBe('Dealing…')
  })

  it('says nothing about players outside a hand', () => {
    expect(waitingMessage(gameView({ phase: 'handover' }))).toBe('Hand not in progress')
  })
})

describe('ActionBar while waiting', () => {
  it('shows the name and how long they have left', () => {
    render(<ActionBar view={gameView()} onAction={vi.fn()} busy={false} secondsLeft={7} />)
    expect(screen.getByText(/Marcos is up/)).toBeInTheDocument()
    expect(screen.getByText(/7s/)).toBeInTheDocument()
  })

  it('leaves the countdown off when the table has no shot clock', () => {
    render(
      <ActionBar
        view={gameView({ actionSeconds: 0 })}
        onAction={vi.fn()}
        busy={false}
        secondsLeft={null}
      />,
    )
    expect(screen.getByText('Marcos is up')).toBeInTheDocument()
  })
})

describe('ActionBar bet sizing', () => {
  it('offers big-blind opens preflop', () => {
    render(
      <ActionBar view={gameView(YOUR_TURN)} onAction={vi.fn()} busy={false} secondsLeft={null} />,
    )
    for (const label of ['2x', '2.5x', '3x', 'All-in']) {
      expect(screen.getByRole('button', { name: `Raise to ${sizeFor(label)}` })).toBeInTheDocument()
    }
  })

  it('sends exactly the preset that was tapped', async () => {
    const onAction = vi.fn()
    render(
      <ActionBar view={gameView(YOUR_TURN)} onAction={onAction} busy={false} secondsLeft={null} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Raise to 30' }))
    await userEvent.click(screen.getByRole('button', { name: 'Raise' }))
    expect(onAction).toHaveBeenCalledWith('raise', 30)
  })

  it('steps by one big blind and stops at the minimum', async () => {
    const onAction = vi.fn()
    render(
      <ActionBar view={gameView(YOUR_TURN)} onAction={onAction} busy={false} secondsLeft={null} />,
    )
    await userEvent.click(screen.getByText('Fine tune'))
    // Opens at the minimum raise, so lowering is not available yet.
    expect(screen.getByRole('button', { name: 'Lower by 10' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Raise by 10' }))
    await userEvent.click(screen.getByRole('button', { name: 'Raise' }))
    expect(onAction).toHaveBeenCalledWith('raise', 30)
  })

  it('shows the size in big blinds as well as chips', () => {
    render(
      <ActionBar view={gameView(YOUR_TURN)} onAction={vi.fn()} busy={false} secondsLeft={null} />,
    )
    expect(screen.getByText('2 BB')).toBeInTheDocument()
  })
})

/** The chip amount each preflop preset stands for at 5/10 blinds. */
function sizeFor(label: string): number {
  return { '2x': 20, '2.5x': 25, '3x': 30, 'All-in': 1000 }[label]!
}

describe('the time bank', () => {
  it('names the clock that is running, so restarting is not a glitch', () => {
    const view = gameView({ actorId: 'p1', bankRunning: true })
    expect(waitingMessage(view)).toBe('Marcos is into their time bank')
    expect(waitingMessage(gameView({ actorId: 'p1' }))).toBe('Marcos is up')
  })

  it('measures the bar against the bank rather than the shot clock', () => {
    // A sixty-second bank on a twenty-second clock would otherwise draw a bar
    // three times full, which never moves and tells the player nothing.
    render(
      <ActionBar
        view={gameView({
          ...YOUR_TURN,
          bankRunning: true,
          you: player({ id: 'me', isYou: true, timeBank: 60 }),
        })}
        onAction={() => {}}
        busy={false}
        secondsLeft={30}
      />,
    )
    const bar = document.querySelector('[style*="width"]') as HTMLElement
    expect(bar.style.width).toBe('50%')
  })
})
