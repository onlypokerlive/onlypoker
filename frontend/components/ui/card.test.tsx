import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CardTitle } from '@/components/ui/card'

describe('CardTitle', () => {
  it('provides a real section heading', () => {
    render(<CardTitle>Create a table</CardTitle>)
    expect(screen.getByRole('heading', { level: 2, name: 'Create a table' })).toBeVisible()
  })

  it('can provide the page heading when a card is the whole page', () => {
    render(<CardTitle as="h1">Join the table</CardTitle>)
    expect(screen.getByRole('heading', { level: 1, name: 'Join the table' })).toBeVisible()
  })
})
