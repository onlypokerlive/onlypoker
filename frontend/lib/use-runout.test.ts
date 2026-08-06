import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RUNOUT_SECOND_BOARD_MS, runoutBeats, runoutDurationMs } from '@/lib/runout'
import { REVEAL_STEP_MS } from '@/lib/showdown'
import { useRunout } from '@/lib/use-runout'
import type { GameView } from '@/lib/poker-api'

const FULL = ['As', 'Kd', '7h', '2c', '9s']

function view(board: string[], handNumber = 1, showOrder: string[] = []): GameView {
  return {
    board,
    handNumber,
    showOrder,
    autoDealSeconds: 8,
    phase: 'hand',
    players: [],
  } as unknown as GameView
}

/**
 * The schedule the hook is running, asked of the same function it asks.
 *
 * The alternative is three magic milliseconds in a test file, which is the
 * shape of every layout bug in this repo: a constant that nothing computes,
 * drifting away from the thing it describes.
 */
const schedule = (handsUpMs = 0) =>
  runoutBeats(0, 5, { pauseSeconds: 8, handsUpMs }).map((b) => b.at)

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
    const [flop, turn, river] = schedule()
    const { result, rerender } = renderHook(({ v }) => useRunout(v), {
      initialProps: { v: view([]) },
    })

    // Everyone all-in preflop: the server sends back the finished board.
    rerender({ v: view(FULL) })
    expect(result.current.board).toEqual([])
    expect(result.current.revealing).toBe(true)
    expect(result.current.boardCompleteMs).toBe(river)

    act(() => void vi.advanceTimersByTime(flop))
    expect(result.current.board).toHaveLength(3)
    expect(result.current.revealing).toBe(true)

    act(() => void vi.advanceTimersByTime(turn - flop))
    expect(result.current.board).toHaveLength(4)

    act(() => void vi.advanceTimersByTime(river - turn))
    expect(result.current.board).toEqual(FULL)
    expect(result.current.revealing).toBe(false)
    // Still says how long the board took, with the board already on the table.
    // It is a fact about the hand that ended, not a countdown: the showdown is
    // measured from it, and everything after the river — the winning five
    // lighting up, the pot going out — is still to come. Dropped to zero here,
    // all of that moved into a past the clock had gone by and fired at once.
    expect(result.current.boardCompleteMs).toBe(river)
  })

  it('waits for the hands to turn over before the first card', () => {
    // Two hands to show, so one step of the reveal, and the board may not
    // arrive under it. This is the whole point of an all-in: you watch the
    // board knowing what each of them needs.
    const order = ['a', 'b']
    const handsUpMs = REVEAL_STEP_MS * (order.length - 1)
    const [flop] = schedule(handsUpMs)
    expect(flop).toBeGreaterThan(handsUpMs)

    const { result, rerender } = renderHook(({ v }) => useRunout(v), {
      initialProps: { v: view([], 1, order) },
    })
    rerender({ v: view(FULL, 1, order) })

    act(() => void vi.advanceTimersByTime(handsUpMs))
    expect(result.current.board).toEqual([])

    act(() => void vi.advanceTimersByTime(flop - handsUpMs))
    expect(result.current.board).toHaveLength(3)
  })

  it('keeps holding while the table keeps polling', () => {
    const [flop] = schedule()
    const { result, rerender } = renderHook(({ v }) => useRunout(v), {
      initialProps: { v: view([]) },
    })
    rerender({ v: view(FULL) })
    // A second poll arrives with the same board. It must not restart or cancel
    // the reveal already in flight.
    act(() => void vi.advanceTimersByTime(flop))
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

describe('a hand run twice', () => {
  const OTHER = ['Qs', 'Jd', '3h', '4c', 'Td']

  function twoBoards(board: string[], boards: string[][]): GameView {
    return { ...view(board), boards } as GameView
  }

  it('runs the first board out, then the second', () => {
    // The order a card room deals them in. Side by side they are one event
    // that happens to have ten cards in it; in sequence they are two answers
    // to the same question, and the second is read against one everybody
    // already has.
    const { result, rerender } = renderHook(({ v }) => useRunout(v), {
      initialProps: { v: twoBoards([], [[], []]) },
    })
    rerender({ v: twoBoards(FULL, [FULL, OTHER]) })

    const at = runoutBeats(0, 5, { pauseSeconds: 8, boards: 2 }).map((b) => b.at)
    expect(at).toHaveLength(6)
    const sizes = () => result.current.boards.map((b) => b.length)
    // Stepped to absolute moments, not by adding up gaps: the beats are floats
    // and a sum of differences lands a fraction short of the last one, which
    // leaves its timer unfired and reads as a board that never finished.
    let now = 0
    const beat = (i: number) => {
      const to = Math.ceil(at[i])
      act(() => vi.advanceTimersByTime(to - now))
      now = to
    }

    expect(sizes()).toEqual([0, 0])
    // The first board, alone. The second is empty and not absent — its room
    // was reserved the moment it came into existence.
    beat(0)
    expect(sizes()).toEqual([3, 0])
    beat(1)
    expect(sizes()).toEqual([4, 0])
    beat(2)
    expect(sizes()).toEqual([5, 0])

    // And only then the second, over a first board that stays finished.
    beat(3)
    expect(sizes()).toEqual([5, 3])
    beat(4)
    expect(sizes()).toEqual([5, 4])
    beat(5)
    expect(result.current.boards).toEqual([FULL, OTHER])
  })

  it('holds the finished board before starting the next one', () => {
    // Long enough for somebody to say "well, that half is yours".
    const at = runoutBeats(0, 5, { pauseSeconds: Infinity, boards: 2 })
    const firstRiver = at[2]
    const secondFlop = at[3]
    expect(secondFlop.board).toBe(1)
    expect(secondFlop.at - firstRiver.at).toBe(RUNOUT_SECOND_BOARD_MS)
  })

  it('takes twice as long, and says so, so the rest of the ending waits', () => {
    // `boardCompleteMs` is what `use-showdown` waits on before lighting the
    // winning cards and paying the pot. Told the one-board figure it would put
    // the answer on screen while the second board was still being dealt.
    const one = runoutDurationMs(runoutBeats(0, 5, { pauseSeconds: Infinity }))
    const two = runoutDurationMs(runoutBeats(0, 5, { pauseSeconds: Infinity, boards: 2 }))
    expect(two).toBeGreaterThan(one * 1.8)
  })

  it('still answers with one board on every ordinary hand', () => {
    const { result } = renderHook(() => useRunout(view(FULL)))
    expect(result.current.boards).toEqual([FULL])
    expect(result.current.board).toEqual(FULL)
  })
})
