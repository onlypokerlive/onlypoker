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
      expect(
        screen.getByRole('button', { name: `Set raise to ${sizeFor(label)}` }),
      ).toBeInTheDocument()
    }
  })

  it('sends exactly the preset that was tapped', async () => {
    const onAction = vi.fn()
    render(
      <ActionBar view={gameView(YOUR_TURN)} onAction={onAction} busy={false} secondsLeft={null} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Set raise to 30' }))
    await userEvent.click(screen.getByRole('button', { name: 'Raise to 30' }))
    expect(onAction).toHaveBeenCalledWith('raise', 30)
  })

  it('steps by half a big blind and stops at the minimum', async () => {
    const onAction = vi.fn()
    render(
      <ActionBar view={gameView(YOUR_TURN)} onAction={onAction} busy={false} secondsLeft={null} />,
    )
    await userEvent.click(screen.getByText('Fine tune'))
    // Opens at the minimum raise, so lowering is not available yet.
    expect(screen.getByRole('button', { name: 'Lower by 5' })).toBeDisabled()
    // Half a blind at 5/10, on every street: two taps to a whole one. The
    // sizes people actually make are not all whole blinds — two and a half is
    // the standard open — and a stepper that cannot reach one is a stepper you
    // have to drag past.
    await userEvent.click(screen.getByRole('button', { name: 'Raise by 5' }))
    await userEvent.click(screen.getByRole('button', { name: 'Raise to 25' }))
    expect(onAction).toHaveBeenCalledWith('raise', 25)
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
    // Drained with a transform rather than a width — see the comment on the
    // element. Half full is half full either way; this is the same assertion
    // written against the property that now carries it.
    const bar = document.querySelector('[style*="scaleX"]') as HTMLElement
    expect(bar.style.transform).toBe('scaleX(0.5)')
  })
})

describe('the sizing row earns its height', () => {
  /**
   * A short stack whose only affordable raise is all of it.
   *
   * `presets` always ends its list with All-in, so this leaves exactly one
   * button — and the raise button below already says All-in the moment the
   * amount reaches the maximum. A row that repeats the control forty pixels
   * under it costs the table thirty-four pixels to say nothing.
   */
  const ALL_IN_ONLY = {
    isYourTurn: true,
    actorId: 'me',
    legal: {
      canFold: true,
      canCheck: false,
      canRaise: true,
      callAmount: 100,
      minRaise: 900,
      maxRaise: 1000,
    },
  } satisfies Partial<GameView>

  it('is not drawn when its only size is the one the raise button already is', () => {
    render(
      <ActionBar view={gameView(ALL_IN_ONLY)} onAction={vi.fn()} busy={false} secondsLeft={null} />,
    )
    // No sizing row at all — and nothing is lost with it: the slider still
    // reaches the top, and the raise button turns into All-in when it gets
    // there.
    expect(screen.queryByLabelText(/^Set raise to /)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Raise to 900' })).toBeInTheDocument()
    // Nothing is lost with the row: the amount can still be walked all the way
    // to the top, where the raise button becomes All-in.
    expect(screen.getByLabelText('Raise amount')).toBeInTheDocument()
  })

  it('is drawn as soon as there is a real choice to make', () => {
    render(
      <ActionBar view={gameView(YOUR_TURN)} onAction={vi.fn()} busy={false} secondsLeft={null} />,
    )
    expect(screen.getAllByLabelText(/^Set raise to /).length).toBeGreaterThan(1)
  })
})
