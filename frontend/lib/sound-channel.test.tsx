import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useTableEvents } from '@/lib/use-table-events'

/**
 * Who holds the iPhone's audio channel, and for how long.
 *
 * Its own file and not a case in `sound.test.ts`, because the bug was never in
 * `setAudioAudible` — that function was right the day it was written. It was in
 * *who called it and when*: the channel was taken on the first touch of the
 * page, before anything knew whether this table had sound on, and never given
 * back. A test of the module alone passes through all of that, which is exactly
 * what happened.
 *
 * What is at stake is not this app's sound. It is the music the room was
 * listening to: a `playback` session is not mixable, so holding one is holding
 * everyone else's speaker.
 */
const claims = vi.hoisted(() => ({ setAudioAudible: vi.fn() }))

vi.mock('@/lib/sound', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sound')>()),
  setAudioAudible: claims.setAudioAudible,
  // Nothing in this file is about making a noise, and jsdom has no audio.
  unlockAudio: vi.fn(),
  announce: vi.fn(),
  audioIsAwake: () => true,
}))

/** The last thing the hook asked for: [audible, overSilence]. */
const asked = () => claims.setAudioAudible.mock.calls.at(-1)

describe('holding the phone’s audio channel', () => {
  beforeEach(() => {
    claims.setAudioAudible.mockClear()
    localStorage.clear()
  })

  it('takes it while the table is allowed to speak', () => {
    renderHook(() => useTableEvents(null, true))
    expect(asked()).toEqual([true, true])
  })

  it('gives it back on the way out', () => {
    // Leaving the table is leaving the table. A page that keeps an exclusive
    // session after nobody is looking at it is a page that took something and
    // did not say what for.
    const { unmount } = renderHook(() => useTableEvents(null, true))
    claims.setAudioAudible.mockClear()
    unmount()
    expect(asked()?.[0]).toBe(false)
  })

  it('does not take it at all on a table somebody has muted', () => {
    // The one that mattered. Muted, this page has nothing to say — and it was
    // still stopping the music in order to say it.
    localStorage.setItem('holdem:sound', 'off')
    const { rerender } = renderHook(() => useTableEvents(null, true))
    rerender()
    expect(claims.setAudioAudible.mock.calls.every(([audible]) => audible === false)).toBe(true)
  })

  it('asks to mix with the music when the switch is off', () => {
    renderHook(() => useTableEvents(null, false))
    expect(asked()).toEqual([true, false])
  })
})
