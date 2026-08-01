'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { playEvent, unlockAudio } from '@/lib/sound'
import { diffViews, HAPTICS } from '@/lib/table-events'
import type { GameView } from '@/lib/poker-api'

const STORAGE_KEY = 'holdem:sound'

/**
 * Plays the table.
 *
 * Feeds every new view through {@link diffViews} and turns whatever changed
 * into sound and vibration. The previous view is kept in a ref rather than
 * state: it is only ever read to make a comparison, and putting it in state
 * would render the whole table a second time for every poll.
 */
export function useTableEvents(view: GameView | null) {
  const [enabled, setEnabledState] = useState(true)
  const previous = useRef<GameView | null>(null)
  const ready = useRef(false)

  // The preference lives in localStorage, which is not readable while the page
  // is being rendered on the server, so it is picked up on mount instead.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved !== null) setEnabledState(saved === 'on')
    } catch {
      // A browser with storage blocked still gets sound; it just forgets.
    }
    ready.current = true
  }, [])

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next)
    if (next) unlockAudio()
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off')
    } catch {
      // ignore
    }
  }, [])

  // iOS keeps the audio context asleep until a real gesture has happened. Any
  // touch on the page counts, so the table is usually awake long before it has
  // anything to say.
  useEffect(() => {
    const wake = () => unlockAudio()
    window.addEventListener('pointerdown', wake, { once: true })
    return () => window.removeEventListener('pointerdown', wake)
  }, [])

  useEffect(() => {
    if (!view) return
    const events = diffViews(previous.current, view)
    previous.current = view
    if (!enabled || !events.length) return

    for (const event of events) {
      playEvent(event)
      const pattern = HAPTICS[event]
      // Safari on iOS has no Vibration API at all. Nothing to fall back to —
      // it just does not buzz there.
      if (pattern && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate(pattern)
        } catch {
          // ignore
        }
      }
    }
  }, [view, enabled])

  return { soundOn: enabled, setSoundOn: setEnabled }
}
