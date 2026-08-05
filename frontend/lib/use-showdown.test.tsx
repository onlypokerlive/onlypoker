import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HAND_LIT_DELAY_MS, HAND_LIT_STEP_MS, REVEAL_STEP_MS } from '@/lib/showdown'
import { useShowdown } from '@/lib/use-showdown'
import { gameView, player } from '@/lib/test-fixtures'
import type { GameView } from '@/lib/poker-api'

/**
 * The hook, and not only the arithmetic under it.
 *
 * Every beat this thing produces was already covered by pure-function tests
 * that all passed while the hook handed the whole showdown out in its first
 * frame: the reveal is arithmetic, but *when the clock starts* is a question
 * about React, and no test of a pure function can ask it.
 */
const HAND = ['As', 'Ad', 'Ks', 'Kd', 'Qs']
const seats = [player({ id: 'a', name: 'Ana' }), player({ id: 'b', name: 'Beto' })]

/** Two hands still live, one of them the winner. */
function shownDown(overrides: Partial<GameView> = {}): GameView {
  return gameView({
    phase: 'handover',
    handNumber: 4,
    players: seats,
    wentToShowdown: true,
    showOrder: ['a', 'b'],
    lastResults: [
      { playerId: 'a', name: 'Ana', delta: 100, won: 200, handName: 'Two pair', handCards: HAND },
      { playerId: 'b', name: 'Beto', delta: -100, won: 0 },
    ],
    ...overrides,
  })
}

const live = gameView({ phase: 'hand', handNumber: 4, players: seats })

/** The last beat of the showdown above: two hands, then five cards lit. */
const ENDS = REVEAL_STEP_MS + HAND_LIT_DELAY_MS + 4 * HAND_LIT_STEP_MS

/**
 * The clock ticks every 100ms, so a beat at 420 is drawn on the tick at 500.
 * Written out rather than rounded off, because a test that advances to the beat
 * itself and passes is a test that would also pass with no clock at all.
 */
const TICK = 100
const onTick = (beat: number) => Math.ceil(beat / TICK) * TICK

function watching(first: GameView) {
  return renderHook(({ v }: { v: GameView }) => useShowdown(v, seats), {
    initialProps: { v: first },
  })
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('a showdown this client watched happen', () => {
  it('has told nothing at all on the frame it arrives', () => {
    // The one that mattered. `handover` and the reveal arrive in the same
    // response, and the hook used to start its clock in an effect — so the
    // render before that effect drew every hand face up, every winning card
    // lit and the pot free to leave, and then wound it all back to zero. The
    // whole showdown, told and untold, in the frame before it began.
    const { result, rerender } = watching(live)
    rerender({ v: shownDown() })
    // The first hand is up — it turns over on beat zero, which is the point of
    // it being first. Everything after it is still to come.
    expect(result.current.shown(0)).toBe(true)
    expect(result.current.shown(1)).toBe(false)
    expect(result.current.lit('As')).toBe(false)
    expect(result.current.dimming).toBe(false)
    expect(result.current.done).toBe(false)
  })

  it('turns the hands over in the order the server sent, one at a time', () => {
    const { result, rerender } = watching(live)
    rerender({ v: shownDown() })
    act(() => void vi.advanceTimersByTime(REVEAL_STEP_MS - TICK))
    expect(result.current.shown(0)).toBe(true)
    expect(result.current.shown(1)).toBe(false)
    act(() => void vi.advanceTimersByTime(onTick(REVEAL_STEP_MS) - REVEAL_STEP_MS + TICK))
    expect(result.current.shown(1)).toBe(true)
  })

  it('lights the winning five only once every hand is up', () => {
    const { result, rerender } = watching(live)
    rerender({ v: shownDown() })
    const first = REVEAL_STEP_MS + HAND_LIT_DELAY_MS
    act(() => void vi.advanceTimersByTime(first - TICK))
    expect(result.current.lit('As')).toBe(false)
    act(() => void vi.advanceTimersByTime(onTick(first) - first + TICK))
    expect(result.current.lit('As')).toBe(true)
    expect(result.current.dimming).toBe(true)
  })

  it('is not done until the last card has lit', () => {
    // What the pot waits for. Anything less and the money is the answer to a
    // question the table is still being asked.
    const { result, rerender } = watching(live)
    rerender({ v: shownDown() })
    act(() => void vi.advanceTimersByTime(ENDS - TICK))
    expect(result.current.done).toBe(false)
    act(() => void vi.advanceTimersByTime(onTick(ENDS) - ENDS + TICK))
    expect(result.current.done).toBe(true)
  })

  it('is not restarted by the polls that bring the same hand back', () => {
    // The same handover arrives every 1.2 seconds for as long as the pause
    // lasts. Restarting on each would hold the reveal on its first beat.
    const { result, rerender } = watching(live)
    rerender({ v: shownDown() })
    act(() => void vi.advanceTimersByTime(onTick(REVEAL_STEP_MS)))
    expect(result.current.shown(1)).toBe(true)
    rerender({ v: shownDown() })
    expect(result.current.shown(1)).toBe(true)
    expect(result.current.done).toBe(false)
  })

  it('turns the hands over while the board is still coming, and answers after', () => {
    // An all-in. The hands go face up first — that is what makes the run-out
    // worth watching — and what waits for the last card is the *answer*: the
    // winning five lighting up, and the pot going out.
    //
    // This is the reverse of what it used to do, and the reverse was a
    // defensible reading of the same rule: nothing may name the hand before the
    // board exists. Naming it and turning it over are not the same act.
    const BOARD = 5_000
    const { result, rerender } = renderHook(
      ({ v, b }: { v: GameView; b: number }) => useShowdown(v, seats, b),
      { initialProps: { v: live, b: 0 } },
    )
    rerender({ v: shownDown(), b: BOARD })

    act(() => void vi.advanceTimersByTime(onTick(REVEAL_STEP_MS)))
    expect(result.current.shown(0)).toBe(true)
    expect(result.current.shown(1)).toBe(true)
    // Face up, and nothing decided: the river has not landed.
    expect(result.current.lit('As')).toBe(false)
    expect(result.current.dimming).toBe(false)
    expect(result.current.done).toBe(false)

    const litAt = BOARD + HAND_LIT_DELAY_MS
    act(() => void vi.advanceTimersByTime(onTick(litAt) - onTick(REVEAL_STEP_MS)))
    expect(result.current.lit('As')).toBe(true)
    expect(result.current.done).toBe(false)

    const ends = litAt + 4 * HAND_LIT_STEP_MS
    act(() => void vi.advanceTimersByTime(onTick(ends) - onTick(litAt)))
    expect(result.current.done).toBe(true)
  })

  it('survives learning how long the board takes a render late', () => {
    // `boardCompleteMs` is measured by `use-runout`, which sets it from an
    // effect — so the first render of a handover always says zero and the one
    // after it says five seconds. A clock that counted its own ticks answered
    // that by rescheduling them, which put the showdown back to its first beat
    // halfway through telling it. This one reads elapsed time.
    const BOARD = 5_000
    const { result, rerender } = renderHook(
      ({ v, b }: { v: GameView; b: number }) => useShowdown(v, seats, b),
      { initialProps: { v: live, b: 0 } },
    )
    rerender({ v: shownDown(), b: 0 })
    act(() => void vi.advanceTimersByTime(onTick(REVEAL_STEP_MS)))
    expect(result.current.shown(1)).toBe(true)

    // The board's length arrives. Nothing already told may be untold.
    rerender({ v: shownDown(), b: BOARD })
    expect(result.current.shown(1)).toBe(true)
    expect(result.current.done).toBe(false)

    const ends = BOARD + HAND_LIT_DELAY_MS + 4 * HAND_LIT_STEP_MS
    act(() => void vi.advanceTimersByTime(onTick(ends)))
    expect(result.current.done).toBe(true)
  })
})

describe('a showdown that was already over when the app opened', () => {
  it('is simply where everything ends up', () => {
    // Not an event this client was at. Playing it out would show somebody a
    // showdown of a hand they were not dealt into.
    const { result } = watching(shownDown())
    expect(result.current.shown(0)).toBe(true)
    expect(result.current.shown(1)).toBe(true)
    expect(result.current.lit('As')).toBe(true)
    expect(result.current.done).toBe(true)
  })

  it('still plays the next hand out in full', () => {
    const { result, rerender } = watching(shownDown())
    rerender({ v: gameView({ phase: 'hand', handNumber: 5, players: seats }) })
    rerender({ v: shownDown({ handNumber: 5 }) })
    expect(result.current.shown(1)).toBe(false)
    expect(result.current.done).toBe(false)
  })
})

describe('a pot nobody showed a hand for', () => {
  it('is over the moment it is won', () => {
    // Won by folding. There is nothing to wait for, and making the winner wait
    // is a second of the table looking at a pot nobody is taking.
    const { result, rerender } = watching(live)
    rerender({ v: gameView({ phase: 'handover', handNumber: 4, players: seats }) })
    expect(result.current.done).toBe(true)
    expect(result.current.shown(0)).toBe(false)
    expect(result.current.dimming).toBe(false)
  })
})

describe('a hand nobody had to turn over', () => {
  it('never shows the seats the rule let muck', () => {
    // Beaten, speaking after the winner: the cards go face down and stay
    // there. The order the server sends is the whole of who shows.
    const { result, rerender } = watching(live)
    rerender({ v: shownDown({ showOrder: ['a'] }) })
    act(() => void vi.advanceTimersByTime(onTick(ENDS) * 2))
    expect(result.current.shown(0)).toBe(true)
    expect(result.current.shown(1)).toBe(false)
  })
})

describe('a chop', () => {
  it('lights the winning cards for both halves of it', () => {
    // Two winners, and `delta` is zero for both: each got back exactly what
    // they put in. Asked that way, the hand where two people are staring at
    // the board working out whether they share it lit nothing at all.
    const { result, rerender } = watching(live)
    rerender({
      v: shownDown({
        lastResults: [
          { playerId: 'a', name: 'Ana', delta: 0, won: 100, handName: 'Straight', handCards: HAND },
          { playerId: 'b', name: 'Beto', delta: 0, won: 100, handName: 'Straight', handCards: HAND },
        ],
      }),
    })
    act(() => void vi.advanceTimersByTime(onTick(ENDS)))
    expect(result.current.lit('As')).toBe(true)
    expect(result.current.done).toBe(true)
  })
})
