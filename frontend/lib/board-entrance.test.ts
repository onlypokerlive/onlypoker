import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useBoardEntrance, DEAL_STEP_MS } from '@/lib/board-entrance'

const FLOP = ['As', 'Kd', '7h']
const TURN = [...FLOP, '2c']

describe('cards landing one at a time', () => {
  it('does not deal a board that was already on the table', () => {
    // Opening the app mid-hand is looking at a flop, not watching one. Same
    // rule the sounds follow on their first poll.
    const { result } = renderHook(() => useBoardEntrance(FLOP))
    expect(result.current).toEqual([null, null, null])
  })

  it('lands a flop on three beats', () => {
    const { result, rerender } = renderHook(({ b }) => useBoardEntrance(b), {
      initialProps: { b: [] as string[] },
    })
    rerender({ b: FLOP })
    expect(result.current).toEqual([0, DEAL_STEP_MS, DEAL_STEP_MS * 2])
  })

  it('only animates the card that just arrived', () => {
    const { result, rerender } = renderHook(({ b }) => useBoardEntrance(b), {
      initialProps: { b: FLOP },
    })
    rerender({ b: TURN })
    expect(result.current).toEqual([null, null, null, 0])
  })

  it('treats a cleared board as a new hand, not as cards arriving', () => {
    const { result, rerender } = renderHook(({ b }) => useBoardEntrance(b), {
      initialProps: { b: TURN },
    })
    rerender({ b: [] })
    expect(result.current).toEqual([])
  })
})
