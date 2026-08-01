import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { JoinRoomForm } from '@/components/join-room-form'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

describe('JoinRoomForm', () => {
  it('keeps the private room password concealed', () => {
    render(<JoinRoomForm roomId="ABC123" />)

    expect(screen.getByLabelText('Room password')).toHaveAttribute('type', 'password')
  })
})
