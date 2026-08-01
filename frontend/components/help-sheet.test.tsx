import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { HelpSheet } from '@/components/help-sheet'

describe('HelpSheet', () => {
  it('stays out of the way until asked for', () => {
    render(<HelpSheet />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens on the question mark and closes again', async () => {
    render(<HelpSheet />)
    await userEvent.click(screen.getByRole('button', { name: 'How to play' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('dialog').parentElement).toBe(document.body)
    expect(screen.getByText('Peek or tap to see your cards')).toBeInTheDocument()
    expect(screen.getByText('The pot')).toBeInTheDocument()
    expect(screen.getByText(/60-second personal time bank/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes on escape', async () => {
    // Reaching for the back gesture instead is how you leave the table by
    // accident on a phone.
    render(<HelpSheet />)
    await userEvent.click(screen.getByRole('button', { name: 'How to play' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not close when the sheet itself is tapped', async () => {
    render(<HelpSheet />)
    await userEvent.click(screen.getByRole('button', { name: 'How to play' }))
    await userEvent.click(screen.getByText('Peek or tap to see your cards'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('moves focus into the sheet and restores it to the trigger', async () => {
    render(<HelpSheet />)
    const trigger = screen.getByRole('button', { name: 'How to play' })

    await userEvent.click(trigger)
    expect(await screen.findByRole('button', { name: 'Close' })).toHaveFocus()

    await userEvent.keyboard('{Escape}')
    expect(trigger).toHaveFocus()
  })
})
