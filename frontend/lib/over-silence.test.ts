import { describe, expect, it } from 'vitest'

import { DEFAULT_OVER_SILENCE, parseOverSilence } from '@/lib/over-silence'

describe('talking over the phone’s silent switch', () => {
  it('is on to start with', () => {
    // Because the alternative is a poker app that is silent on most phones for
    // a reason nobody can see: on iOS the hardware switch mutes Web Audio and
    // does not mute an `<audio>` tag, and a phone that has been on silent since
    // a meeting last Tuesday is most phones.
    expect(DEFAULT_OVER_SILENCE).toBe(true)
  })

  it('remembers being turned off', () => {
    // The one thing this switch has to do. It costs somebody else's music, so
    // a table that turned it off must not find it back on next hand.
    expect(parseOverSilence('off')).toBe(false)
    expect(parseOverSilence('on')).toBe(true)
  })

  it('has no opinion about anything it never wrote', () => {
    // Nothing saved is not "off" — it is "nobody has said", which is what lets
    // the default above be the default.
    expect(parseOverSilence(null)).toBeNull()
    expect(parseOverSilence('')).toBeNull()
    expect(parseOverSilence('true')).toBeNull()
  })
})
