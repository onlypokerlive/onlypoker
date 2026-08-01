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
    expect(screen.getByText('Hold to see your cards')).toBeInTheDocument()

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
    await userEvent.click(screen.getByText('Hold to see your cards'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
