import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useBoardEntrance, useBoardsEntrance, DEAL_STEP_MS } from '@/lib/board-entrance'

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

  it('holds the new card back while the chips are being raked in', () => {
    // The response that carries the turn usually also carries the end of the
    // street it closed. Landing the card first draws it onto a felt still
    // covered in bets.
    const { result, rerender } = renderHook(
      ({ b, lead }) => useBoardEntrance(b, lead),
      { initialProps: { b: FLOP, lead: 0 } },
    )
    rerender({ b: TURN, lead: 900 })
    expect(result.current).toEqual([null, null, null, 900])
  })

  it('keeps the lead-in the cards arrived on, whatever renders later', () => {
    const { result, rerender } = renderHook(
      ({ b, lead }) => useBoardEntrance(b, lead),
      { initialProps: { b: FLOP, lead: 0 } },
    )
    rerender({ b: TURN, lead: 900 })
    // A re-render for something else entirely — a resize, a measurement — must
    // not restart a card that is already on its way in.
    rerender({ b: TURN, lead: 0 })
    expect(result.current).toEqual([null, null, null, 900])
  })

  it('treats a cleared board as a new hand, not as cards arriving', () => {
    const { result, rerender } = renderHook(({ b }) => useBoardEntrance(b), {
      initialProps: { b: TURN },
    })
    rerender({ b: [] })
    expect(result.current).toEqual([])
  })
})

describe('asking for the lead-in rather than being handed it', () => {
  it('reads it at the moment the cards arrive', () => {
    // The value is decided by the effect that starts the chips moving, which
    // runs on the same view — so the caller has no number to pass at render
    // time, only somewhere to look it up.
    let lead = 0
    const { result, rerender } = renderHook(({ b }) => useBoardEntrance(b, () => lead), {
      initialProps: { b: [] as string[] },
    })
    lead = 900
    rerender({ b: FLOP })
    expect(result.current).toEqual([900, 900 + DEAL_STEP_MS, 900 + DEAL_STEP_MS * 2])
  })
})

describe('a hand run twice', () => {
  const OTHER_FLOP = ['Qs', 'Jd', '3h']

  it('lands both boards on the same beats', () => {
    // Two flops arriving three cards apart is two events. Arriving together it
    // is one flop, twice — which is the thing being watched.
    const { result, rerender } = renderHook(({ b }) => useBoardsEntrance(b), {
      initialProps: { b: [[], []] as string[][] },
    })
    rerender({ b: [FLOP, OTHER_FLOP] })
    expect(result.current[0]).toEqual([0, DEAL_STEP_MS, DEAL_STEP_MS * 2])
    expect(result.current[1]).toEqual(result.current[0])
  })

  it('does not deal boards that were already on the table', () => {
    const { result } = renderHook(() => useBoardsEntrance([FLOP, OTHER_FLOP]))
    expect(result.current).toEqual([
      [null, null, null],
      [null, null, null],
    ])
  })

  it('is the ordinary board, unchanged, when there is only one', () => {
    const { result, rerender } = renderHook(({ b }) => useBoardsEntrance(b), {
      initialProps: { b: [[]] as string[][] },
    })
    rerender({ b: [FLOP] })
    expect(result.current).toEqual([[0, DEAL_STEP_MS, DEAL_STEP_MS * 2]])
  })
})
