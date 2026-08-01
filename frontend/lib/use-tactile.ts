'use client'

import { useCallback, useRef } from 'react'

/**
 * Props that make a control answer the finger.
 *
 * Twenty lines, and what they buy is that an irreversible action stops being
 * tapped twice: the button sinks and flashes from the point that was touched
 * before the network has said anything at all. A control that looks identical
 * for 300ms after a fold is a control people fold twice with.
 *
 * The flash is driven from here rather than by `:active` alone because CSS
 * cannot know *where* the tap was, and the whole effect is that it comes from
 * under your own thumb.
 */
export function useTactile() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const el = event.currentTarget
    const box = el.getBoundingClientRect()
    el.style.setProperty('--tap-x', `${((event.clientX - box.left) / box.width) * 100}%`)
    el.style.setProperty('--tap-y', `${((event.clientY - box.top) / box.height) * 100}%`)
    el.dataset.tapped = 'true'
    if (timer.current) clearTimeout(timer.current)
    // Long enough to be seen, short enough that a second tap gets its own
    // flash rather than joining the one already fading.
    timer.current = setTimeout(() => {
      el.dataset.tapped = 'false'
    }, 60)
  }, [])

  return { className: 'tactile relative overflow-hidden', onPointerDown }
}
