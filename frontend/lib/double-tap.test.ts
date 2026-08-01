import { describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { useDoubleTap, DOUBLE_TAP_MS } from '@/lib/use-double-tap'

/** A pointer event, near enough for the hook — it reads four fields. */
function tap(t: number, x = 100, y = 100, target?: Partial<HTMLElement>) {
  return {
    timeStamp: t,
    clientX: x,
    clientY: y,
    target: { closest: () => (target ? {} : null) },
  } as unknown as React.PointerEvent<HTMLElement>
}

function setup(enabled = true) {
  const onDoubleTap = vi.fn()
  const hook = renderHook(() => useDoubleTap({ onDoubleTap, enabled }))
  return { onDoubleTap, hook }
}

describe('double-tapping the felt', () => {
  it('fires on two quick taps in the same place', () => {
    const { onDoubleTap, hook } = setup()
    act(() => {
      hook.result.current.onPointerDown(tap(0))
      hook.result.current.onPointerDown(tap(150))
    })
    expect(onDoubleTap).toHaveBeenCalledTimes(1)
  })

  it('ignores two taps that are not close together in time', () => {
    const { onDoubleTap, hook } = setup()
    act(() => {
      hook.result.current.onPointerDown(tap(0))
      hook.result.current.onPointerDown(tap(DOUBLE_TAP_MS + 50))
    })
    expect(onDoubleTap).not.toHaveBeenCalled()
  })

  it('ignores two taps that are not close together on the table', () => {
    // Reading one seat and then another is two taps and one intention, and it
    // is not "check".
    const { onDoubleTap, hook } = setup()
    act(() => {
      hook.result.current.onPointerDown(tap(0, 20, 20))
      hook.result.current.onPointerDown(tap(120, 300, 400))
    })
    expect(onDoubleTap).not.toHaveBeenCalled()
  })

  it('does not fire twice off a third tap', () => {
    const { onDoubleTap, hook } = setup()
    act(() => {
      hook.result.current.onPointerDown(tap(0))
      hook.result.current.onPointerDown(tap(100))
      hook.result.current.onPointerDown(tap(200))
    })
    expect(onDoubleTap).toHaveBeenCalledTimes(1)
  })

  it('leaves controls alone', () => {
    // A button tapped twice is a button tapped twice.
    const { onDoubleTap, hook } = setup()
    act(() => {
      hook.result.current.onPointerDown(tap(0, 100, 100, {}))
      hook.result.current.onPointerDown(tap(100, 100, 100, {}))
    })
    expect(onDoubleTap).not.toHaveBeenCalled()
  })

  it('says so when it will not do it, rather than doing nothing', () => {
    // Silence is indistinguishable from a gesture the app never received.
    const { onDoubleTap, hook } = setup(false)
    act(() => {
      hook.result.current.onPointerDown(tap(0))
      hook.result.current.onPointerDown(tap(100))
    })
    expect(onDoubleTap).not.toHaveBeenCalled()
    expect(hook.result.current.refused).toBe(1)
  })
})
