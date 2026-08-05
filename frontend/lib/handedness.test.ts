import { describe, expect, it } from 'vitest'

import { cardsSide, DEFAULT_HANDED, parseHanded } from '@/lib/handedness'

describe('which side your own cards sit on', () => {
  it('puts them opposite the thumb', () => {
    // The whole feature. The cards live inside the control the thumb presses
    // and drags, so a thumb coming up the right-hand edge lands on top of them.
    expect(cardsSide('right')).toBe('left')
    expect(cardsSide('left')).toBe('right')
  })

  it('defaults to the left, which is where most thumbs are not', () => {
    // They were pinned to the right, which is the wrong side for nine people
    // in ten. That read as a layout choice and it was a legibility bug.
    expect(cardsSide(DEFAULT_HANDED)).toBe('left')
  })
})

describe('what was stored last time', () => {
  it('takes either hand', () => {
    expect(parseHanded('left')).toBe('left')
    expect(parseHanded('right')).toBe('right')
  })

  it('ignores anything this never wrote', () => {
    // Nothing saved, another app's key, a value from a version that did not
    // exist. All of them mean "no preference", not "crash".
    expect(parseHanded(null)).toBeNull()
    expect(parseHanded('')).toBeNull()
    expect(parseHanded('both')).toBeNull()
  })
})
