import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { HoleCards } from '@/components/hole-cards'

/**
 * The drag lives in one component and decides one irreversible thing, so it is
 * tested at the level a thumb works at: a pointer goes down somewhere, travels,
 * and comes up.
 *
 * jsdom issues no real pointerIds, so `setPointerCapture` throws on every one
 * of these — which is the point of the try/catch around it, and why these tests
 * would have caught that trap rather than paying for it twice.
 */
function hand(overrides: Partial<React.ComponentProps<typeof HoleCards>> = {}) {
  const onMuck = vi.fn()
  const onRevealChange = vi.fn()
  const props = {
    cards: ['As', 'Kd'],
    revealed: false,
    onRevealChange,
    canMuck: true,
    onMuck,
    ...overrides,
  }
  const utils = render(<HoleCards {...props} />)
  const rail = screen.getByRole('button')
  return { ...utils, rail, onMuck, onRevealChange }
}

const down = (el: Element, y = 400) =>
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 180, clientY: y })
const moveTo = (el: Element, y: number) =>
  fireEvent.pointerMove(el, { pointerId: 1, clientX: 180, clientY: y })
/**
 * Coming off the glass *somewhere*, because where is the whole decision.
 *
 * Defaults to the press origin, so a tap or a hold that never moved releases
 * with nothing travelled. A pointerup fired without a position is a pointerup
 * at y=0, which from a press at 400 is a 400px pull — every one of these tests
 * would have folded the hand and passed anyway.
 */
const up = (el: Element, y = 400) =>
  fireEvent.pointerUp(el, { pointerId: 1, clientX: 180, clientY: y })

describe('pulling the cards out', () => {
  it('shows them while the thumb is down', () => {
    const { rail, onRevealChange } = hand()
    down(rail)
    expect(onRevealChange).toHaveBeenCalledWith(true)
  })

  it('puts a quick tap away on its own, without a thumb on it', () => {
    // A tap is how anybody checks their hand at a glance, so it has to work —
    // but a hand left face up on a phone on a table is a hand the player next
    // to you has read.
    vi.useFakeTimers()
    try {
      const { rail, onRevealChange } = hand()
      down(rail)
      up(rail)
      expect(onRevealChange).toHaveBeenLastCalledWith(true)
      vi.advanceTimersByTime(3100)
      expect(onRevealChange).toHaveBeenLastCalledWith(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('puts them back the moment a hold ends', () => {
    vi.useFakeTimers()
    try {
      const { rail, onRevealChange } = hand()
      down(rail)
      vi.advanceTimersByTime(600) // held, not tapped
      up(rail)
      expect(onRevealChange).toHaveBeenLastCalledWith(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('throwing the hand away', () => {
  it('says nothing until the thumb has left the rail', () => {
    const { rail } = hand()
    down(rail, 400)
    moveTo(rail, 380) // 20px: thumb wobble on a press
    expect(screen.queryByText(/fold/i)).not.toBeInTheDocument()
  })

  it('offers the target once the cards come off the rail', () => {
    const { rail } = hand()
    down(rail, 400)
    moveTo(rail, 340) // 60px
    expect(screen.getByText('Keep pulling to fold')).toBeInTheDocument()
  })

  it('arms only once the drag is unmistakable', () => {
    const { rail } = hand()
    down(rail, 400)
    moveTo(rail, 340)
    expect(screen.queryByText('Let go to fold')).not.toBeInTheDocument()
    moveTo(rail, 290) // 110px
    expect(screen.getByText('Let go to fold')).toBeInTheDocument()
  })

  it('folds when the thumb lets go inside the target', () => {
    const { rail, onMuck } = hand()
    down(rail, 400)
    moveTo(rail, 290)
    up(rail, 290)
    expect(onMuck).toHaveBeenCalledTimes(1)
  })

  it('does not fold when the thumb comes back down before letting go', () => {
    // The whole reason there is a gap between coming off the rail and arming:
    // you can see what is about to happen and still change your mind.
    const { rail, onMuck } = hand()
    down(rail, 400)
    moveTo(rail, 290)
    moveTo(rail, 395)
    up(rail, 395)
    expect(onMuck).not.toHaveBeenCalled()
  })

  it('does not fold on a coming-back-down the browser never reported', () => {
    // The move events are a courtesy and the release is the decision. A thumb
    // that pulls past the line and comes back can have the return trip
    // coalesced away — under load, on a cheap phone, at exactly the moment
    // somebody changed their mind. Deciding on the last move we happened to be
    // told about folds a hand from a position the player had already left.
    const { rail, onMuck } = hand()
    down(rail, 400)
    moveTo(rail, 290) // armed, and the only move that ever arrives
    up(rail, 350) // 50px: back inside the rail
    expect(onMuck).not.toHaveBeenCalled()
  })

  it('folds on a pull the browser only reported once it was over', () => {
    // And the other way round: no move arrived at all, but the thumb came off
    // the glass 120px up. That is a fold, and refusing it would leave the
    // player holding a hand they threw away.
    const { rail, onMuck } = hand()
    down(rail, 400)
    up(rail, 280)
    expect(onMuck).toHaveBeenCalledTimes(1)
  })

  it('does not fold when the gesture was taken away', () => {
    // A call arriving, the browser claiming the gesture for a scroll. None of
    // that decided anything, and folding on it would throw away a hand nobody
    // chose to throw away.
    const { rail, onMuck } = hand()
    down(rail, 400)
    moveTo(rail, 290)
    fireEvent.pointerCancel(rail, { pointerId: 1 })
    up(rail, 290)
    expect(onMuck).not.toHaveBeenCalled()
  })

  it('never arms when folding is not a legal move', () => {
    const { rail, onMuck } = hand({ canMuck: false })
    down(rail, 400)
    moveTo(rail, 250)
    expect(screen.getByText('Nothing to fold')).toBeInTheDocument()
    up(rail, 250)
    expect(onMuck).not.toHaveBeenCalled()
  })

  it('still lifts the cards when folding is not legal', () => {
    // Refusing to move them reads as the app having missed the gesture, and
    // then the thumb tries again harder.
    const { rail } = hand({ canMuck: false })
    down(rail, 400)
    moveTo(rail, 250)
    expect(screen.getByText('Nothing to fold')).toBeInTheDocument()
  })
})

describe('once you are out of the hand', () => {
  it('takes the cards away rather than leaving them on the rail', () => {
    render(
      <HoleCards cards={null} revealed={false} onRevealChange={() => {}} folded />,
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText(/out of this hand/i)).toBeInTheDocument()
  })

  it('reads differently from never having been dealt in', () => {
    render(<HoleCards cards={null} revealed={false} onRevealChange={() => {}} />)
    expect(screen.getByText(/not in this hand/i)).toBeInTheDocument()
  })
})

describe('two thumbs on the same glass', () => {
  const second = {
    down: (el: Element, y = 400) =>
      fireEvent.pointerDown(el, { pointerId: 2, clientX: 40, clientY: y }),
    move: (el: Element, y: number) =>
      fireEvent.pointerMove(el, { pointerId: 2, clientX: 40, clientY: y }),
    up: (el: Element) => fireEvent.pointerUp(el, { pointerId: 2 }),
  }

  it('does not let a second finger end the first one\'s gesture', () => {
    // The event that folds a hand answers to one pointer. A palm coming off
    // the glass mid-drag used to run `release` with `armed` read from whatever
    // the real thumb had reached — a hand thrown away by somebody's hand.
    const { rail, onMuck } = hand()
    down(rail)
    moveTo(rail, 400 - 120) // armed
    second.up(rail)
    expect(onMuck).not.toHaveBeenCalled()
    up(rail, 400 - 120)
    expect(onMuck).toHaveBeenCalledTimes(1)
  })

  it('does not let a second finger move where the drag started from', () => {
    const { rail, onMuck } = hand()
    down(rail, 400)
    // A finger landing lower down would have reset the origin, so the travel
    // already made would be measured from the new one — and a short pull would
    // arm the muck.
    second.down(rail, 700)
    second.move(rail, 700 - 120)
    up(rail)
    expect(onMuck).not.toHaveBeenCalled()
  })

  it('never folds on a gesture the browser took away', () => {
    // Losing the capture is a scroll claiming the drag, a call arriving, the
    // element going away. None of them is a decision.
    const { rail, onMuck, onRevealChange } = hand()
    down(rail)
    moveTo(rail, 400 - 120)
    fireEvent.lostPointerCapture(rail, { pointerId: 1 })
    expect(onMuck).not.toHaveBeenCalled()
    expect(onRevealChange).toHaveBeenLastCalledWith(false)
    // And the gesture is over: the thumb coming up later decides nothing.
    up(rail)
    expect(onMuck).not.toHaveBeenCalled()
  })
})
