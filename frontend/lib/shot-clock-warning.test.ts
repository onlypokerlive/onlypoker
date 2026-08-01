import { describe, expect, it } from 'vitest'

import { warningStep, WARN_AT } from '@/lib/use-shot-clock-warning'

describe('the warning that is not allowed to fail', () => {
  it('says nothing while there is still time', () => {
    expect(warningStep(20)).toBeNull()
    expect(warningStep(WARN_AT + 0.1)).toBeNull()
  })

  it('ticks once a second at first', () => {
    // Same step across a whole second means one tick, not five.
    expect(warningStep(4.9)).toBe(warningStep(4.1))
    expect(warningStep(4.9)).not.toBe(warningStep(3.9))
  })

  it('doubles the rate at the end, because a steady beat stops being heard', () => {
    // Two distinct steps inside the last second, where there was one before.
    const inside = new Set([warningStep(1.9), warningStep(1.4), warningStep(0.9), warningStep(0.4)])
    expect(inside.size).toBe(4)
  })

  it('stops when the time is gone', () => {
    expect(warningStep(0)).toBeNull()
    expect(warningStep(-1)).toBeNull()
  })
})
