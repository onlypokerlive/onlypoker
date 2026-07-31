'use client'

import { useEffect, useState } from 'react'

/**
 * Seconds left until `deadlineMs`, ticking locally between polls.
 *
 * Returns a fractional value so progress bars stay smooth, and null when there
 * is no deadline to count down to.
 */
export function useSecondsLeft(
  deadlineMs: number | null,
  tickMs = 200,
): number | null {
  const [, setTick] = useState(0)

  useEffect(() => {
    if (deadlineMs == null) return
    const id = setInterval(() => setTick((t) => t + 1), tickMs)
    return () => clearInterval(id)
  }, [deadlineMs, tickMs])

  if (deadlineMs == null) return null
  return Math.max(0, (deadlineMs - Date.now()) / 1000)
}

/** mm:ss for a whole number of seconds. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(total / 60)
  return `${minutes}:${String(total % 60).padStart(2, '0')}`
}
