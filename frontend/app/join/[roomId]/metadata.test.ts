import { beforeEach, describe, expect, it, vi } from 'vitest'

import { generateMetadata } from './page'
import { getRoomPreview } from '@/lib/room-preview'

vi.mock('@/lib/room-preview', () => ({ getRoomPreview: vi.fn() }))

describe('room invitation metadata', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses the safe room projection in the social title and description', async () => {
    vi.mocked(getRoomPreview).mockResolvedValue({
      roomId: 'ABC123',
      name: 'Thursday Poker',
      phase: 'lobby',
      playerCount: 3,
      maxSeats: 9,
      smallBlind: 5,
      bigBlind: 10,
      handNumber: 0,
    })

    const metadata = await generateMetadata({ params: Promise.resolve({ roomId: 'ABC123' }) })

    expect(metadata.title).toBe('Join Thursday Poker · Felt & Gold')
    expect(metadata.description).toContain('3/9 seats filled')
    expect(metadata.openGraph).toMatchObject({ title: 'You’re invited to Thursday Poker' })
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image' })
  })

  it('falls back to a useful generic invitation if the room cannot be read', async () => {
    vi.mocked(getRoomPreview).mockResolvedValue(null)

    const metadata = await generateMetadata({ params: Promise.resolve({ roomId: 'ABC123' }) })

    expect(metadata.title).toBe('Join Private poker table · Felt & Gold')
    expect(metadata.description).toContain('ABC123')
  })
})
