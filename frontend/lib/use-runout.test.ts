import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useRunout } from '@/lib/use-runout'
import type { GameView } from '@/lib/poker-api'

const FULL = ['As', 'Kd', '7h', '2c', '9s']

function view(board: string[], handNumber = 1): GameView {
  return {
    board,
    handNumber,
    autoDealSeconds: 8,
    phase: 'hand',
    players: [],
  } as unknown as GameView
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useRunout', () => {
  it('shows a board that was already there when you arrived', () => {
    // Joining a table on the river is not an all-in running out.
    const { result } = renderHook(() => useRunout(view(FULL)))
    expect(result.current.board).toEqual(FULL)
    expect(result.current.revealing).toBe(false)
  })

  it('leaves an ordinary street alone', () => {
    const { result, rerender } = renderHook(({ v }) => useRunout(v), {
      initialProps: { v: view(FULL.slice(0, 3)) },
    })
    rerender({ v: view(FULL.slice(0, 4)) })
    expect(result.current.board).toHaveLength(4)
    expect(result.current.revealing).toBe(false)
  })

  it('deals a whole board out one street at a time', () => {
    const { result, rerender } = renderHook(({ v }) => useRunout(v), {
      initialProps: { v: view([]) },
    })

    // Everyone all-in preflop: the server sends back the finished board.
    rerender({ v: view(FULL) })
    expect(result.current.board).toEqual([])
    expect(result.current.revealing).toBe(true)

    act(() => void vi.advanceTimersByTime(800))
    expect(result.current.board).toHaveLength(3)
    expect(result.current.revealing).toBe(true)

    act(() => void vi.advanceTimersByTime(800))
    expect(result.current.board).toHaveLength(4)

    act(() => void vi.advanceTimersByTime(800))
    expect(result.current.board).toEqual(FULL)
    expect(result.current.revealing).toBe(false)
  })

  it('keeps holding while the table keeps polling', () => {
    const { result, rerender } = renderHook(({ v }) => useRunout(v), {
      initialProps: { v: view([]) },
    })
    rerender({ v: view(FULL) })
    // A second poll arrives with the same board. It must not restart or cancel
    // the reveal already in flight.
    act(() => void vi.advanceTimersByTime(800))
    rerender({ v: view(FULL) })
    expect(result.current.board).toHaveLength(3)
    expect(result.current.revealing).toBe(true)
  })

  it('drops the reveal when the next hand is dealt over it', () => {
    const { result, rerender } = renderHook(({ v }) => useRunout(v), {
      initialProps: { v: view([]) },
    })
    rerender({ v: view(FULL) })
    expect(result.current.revealing).toBe(true)

    // The server's deal clock does not wait for us. If it fires mid-reveal the
    // table has genuinely moved on, and holding the old board would be a lie.
    rerender({ v: view([], 2) })
    expect(result.current.board).toEqual([])
    expect(result.current.revealing).toBe(false)

    act(() => void vi.advanceTimersByTime(3000))
    expect(result.current.board).toEqual([])
  })
})
