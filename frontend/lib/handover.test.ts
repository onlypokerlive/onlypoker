import { describe, expect, it } from 'vitest'

import { handoverState } from '@/lib/handover'

describe('handover state', () => {
  it('never offers another deal after the actual final hand', () => {
    expect(
      handoverState({ lastHand: true, isHost: true, paused: false, autoDealIn: 7 }),
    ).toEqual({ kind: 'finishing', label: 'Finishing the night…' })
    expect(
      handoverState({ lastHand: true, isHost: false, paused: false, autoDealIn: 7 }),
    ).toEqual({ kind: 'finishing', label: 'Finishing the night…' })
  })

  it('keeps normal between-hand controls and waiting copy', () => {
    expect(
      handoverState({ lastHand: false, isHost: true, paused: false, autoDealIn: 7.2 }),
    ).toEqual({ kind: 'host', label: 'Deal now · 8s' })
    expect(
      handoverState({ lastHand: false, isHost: false, paused: true, autoDealIn: null }),
    ).toEqual({ kind: 'guest', label: 'The host stopped the table…' })
  })
})
