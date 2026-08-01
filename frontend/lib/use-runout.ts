'use client'

import { useEffect, useRef, useState } from 'react'

import { runoutStepMs, runoutSteps } from '@/lib/runout'
import type { GameView } from '@/lib/poker-api'

/**
 * Holds back a board that arrived all at once, and deals it out card by card.
 *
 * Returns the board to draw and whether the reveal is still running — the
 * result panel has to stay hidden until it finishes, or it announces the winner
 * while the turn is still face down.
 */
export function useRunout(view: GameView | null) {
  const [heldTo, setHeldTo] = useState<number | null>(null)
  const seenLength = useRef(0)
  const seenHand = useRef(0)
  const started = useRef(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  const clearTimers = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }

  useEffect(() => clearTimers, [])

  useEffect(() => {
    if (!view) return
    const length = view.board.length

    // Arriving at a table that is already on the river is not a run-out. The
    // first view we ever see only sets the baseline.
    if (!started.current) {
      started.current = true
      seenLength.current = length
      seenHand.current = view.handNumber
      return
    }

    // A new hand outranks anything still playing: the table has moved on, and
    // holding a board from the previous hand would be showing a lie.
    if (view.handNumber !== seenHand.current) {
      clearTimers()
      setHeldTo(null)
      seenHand.current = view.handNumber
      seenLength.current = length
      return
    }

    const from = seenLength.current
    seenLength.current = length
    const steps = runoutSteps(from, length)
    if (!steps.length) return

    clearTimers()
    setHeldTo(from)
    const step = runoutStepMs(steps.length, view.autoDealSeconds)
    steps.forEach((size, i) => {
      timers.current.push(
        setTimeout(() => setHeldTo(i === steps.length - 1 ? null : size), step * (i + 1)),
      )
    })
  }, [view])

  const board = view && heldTo !== null ? view.board.slice(0, heldTo) : (view?.board ?? [])
  return { board, revealing: heldTo !== null }
}
