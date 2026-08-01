import { describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { useDoubleTap, DOUBLE_TAP_MS } from '@/lib/use-double-tap'

/**
 * A pointer event, near enough — the hook reads six fields.
 *
 * `piece` stands for "this touch landed on a piece of furniture rather than on
 * the felt", which is what `closest()` answers in the real thing.
 */
function ev(
  t: number,
  {
    x = 100,
    y = 100,
    id = 1,
    primary = true,
    piece = false,
  }: { x?: number; y?: number; id?: number; primary?: boolean; piece?: boolean } = {},
) {
  return {
    timeStamp: t,
    clientX: x,
    clientY: y,
    pointerId: id,
    isPrimary: primary,
    target: { closest: () => (piece ? {} : null) },
  } as unknown as React.PointerEvent<HTMLElement>
}

function setup(enabled = true) {
  const onDoubleTap = vi.fn()
  const hook = renderHook(({ e }) => useDoubleTap({ onDoubleTap, enabled: e }), {
    initialProps: { e: enabled },
  })
  /** One complete tap: down and up in the same place. */
  const tap = (t: number, o: Parameters<typeof ev>[1] = {}) => {
    act(() => {
      hook.result.current.onPointerDown(ev(t, o))
      hook.result.current.onPointerUp(ev(t + 20, o))
    })
  }
  return { onDoubleTap, hook, tap }
}

describe('double-tapping the felt', () => {
  it('fires on two quick taps in the same place', () => {
    const { onDoubleTap, tap } = setup()
    tap(0)
    tap(150)
    expect(onDoubleTap).toHaveBeenCalledTimes(1)
  })

  it('ignores two taps that are not close together in time', () => {
    const { onDoubleTap, tap } = setup()
    tap(0)
    tap(DOUBLE_TAP_MS + 100)
    expect(onDoubleTap).not.toHaveBeenCalled()
  })

  it('ignores two taps that are not close together on the table', () => {
    const { onDoubleTap, tap } = setup()
    tap(0, { x: 20, y: 20 })
    tap(120, { x: 300, y: 400 })
    expect(onDoubleTap).not.toHaveBeenCalled()
  })

  it('does not fire twice off a third tap', () => {
    const { onDoubleTap, tap } = setup()
    tap(0)
    tap(100)
    tap(200)
    expect(onDoubleTap).toHaveBeenCalledTimes(1)
  })

  it('leaves every piece of the table alone, not just the buttons', () => {
    // Seats, cards, bets, stacks and the pot are all plain divs. Tapping your
    // own cards twice to look at them must never check.
    const { onDoubleTap, tap } = setup()
    tap(0, { piece: true })
    tap(100, { piece: true })
    expect(onDoubleTap).not.toHaveBeenCalled()
  })

  it('does not fire from a press that never lifted', () => {
    // Two `pointerdown`s and no releases is the start of a scroll, or a finger
    // resting on the phone. It used to be enough to check.
    const { onDoubleTap, hook } = setup()
    act(() => {
      hook.result.current.onPointerDown(ev(0))
      hook.result.current.onPointerDown(ev(120))
    })
    expect(onDoubleTap).not.toHaveBeenCalled()
  })

  it('does not fire from a touch that travelled', () => {
    const { onDoubleTap, hook, tap } = setup()
    tap(0)
    act(() => {
      hook.result.current.onPointerDown(ev(120))
      hook.result.current.onPointerMove(ev(140, { x: 100, y: 180 }))
      hook.result.current.onPointerUp(ev(160, { x: 100, y: 180 }))
    })
    expect(onDoubleTap).not.toHaveBeenCalled()
  })

  it('does not fire from a second finger joining in', () => {
    const { onDoubleTap, hook, tap } = setup()
    tap(0)
    act(() => {
      hook.result.current.onPointerDown(ev(120, { id: 2, primary: false }))
      hook.result.current.onPointerUp(ev(140, { id: 2, primary: false }))
    })
    expect(onDoubleTap).not.toHaveBeenCalled()
  })

  it('forgets a half-made gesture when the pointer is taken away', () => {
    const { onDoubleTap, hook, tap } = setup()
    tap(0)
    act(() => {
      hook.result.current.onPointerCancel()
    })
    tap(120)
    expect(onDoubleTap).not.toHaveBeenCalled()
  })

  it('forgets a tap left over from somebody else’s turn', () => {
    // The action came back round. A tap from before must not pair up with the
    // first deliberate tap of the new turn and check on one touch.
    const { onDoubleTap, hook, tap } = setup(true)
    tap(0)
    act(() => hook.rerender({ e: false }))
    act(() => hook.rerender({ e: true }))
    tap(100)
    expect(onDoubleTap).not.toHaveBeenCalled()
  })

  it('says so when it will not do it, rather than doing nothing', () => {
    const { onDoubleTap, hook, tap } = setup(false)
    tap(0)
    tap(100)
    expect(onDoubleTap).not.toHaveBeenCalled()
    expect(hook.result.current.refused).toBe(1)
  })
})
