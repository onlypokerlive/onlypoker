import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildInviteUrl, shareInvite } from './sharing'
import { APP_NAME } from './app-name'

describe('invitation sharing', () => {
  afterEach(() => vi.restoreAllMocks())

  it('builds a stable room link', () => {
    expect(buildInviteUrl('https://poker.test/', 'AB C')).toBe(
      'https://poker.test/join/AB%20C',
    )
  })

  it('uses native share when the browser supports it', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { configurable: true, value: share })

    await expect(
      shareInvite({ roomId: 'ABC123', roomName: 'Thursday Poker' }),
    ).resolves.toBe('native')
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({
        title: `Thursday Poker · ${APP_NAME}`,
        url: `${window.location.origin}/join/ABC123`,
      }),
    )
  })

  it('falls back to copying the link when native sharing fails', async () => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: vi.fn().mockRejectedValue(new Error('not available')),
    })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    await expect(
      shareInvite({ roomId: 'ABC123', roomName: 'Thursday Poker' }),
    ).resolves.toBe('clipboard')
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/join/ABC123`)
  })
})
