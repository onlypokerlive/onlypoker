'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { playEvent, unlockAudio } from '@/lib/sound'
import { diffViews, HAPTICS, type TableEvent } from '@/lib/table-events'
import type { GameView } from '@/lib/poker-api'

const STORAGE_KEY = 'holdem:sound'

/**
 * How much of the table this phone is allowed to make a noise about.
 *
 * Three, not two, because the real situation is not "sound or silence": it is
 * somebody on the sofa with other people in the room who only wants to know
 * when it is their turn. A mute switch makes them choose between annoying
 * everybody and missing every hand, and what they actually do is mute it and
 * then miss their turn.
 */
export type SoundMode = 'all' | 'turn' | 'off'

/** What still gets through on "only my turn". Nothing that is about anyone else. */
const MINE: ReadonlySet<TableEvent> = new Set<TableEvent>(['yourTurn'])

/** Whether this phone, set this way, says anything about this moment. */
export function audible(mode: SoundMode, event: TableEvent): boolean {
  if (mode === 'off') return false
  if (mode === 'all') return true
  return MINE.has(event)
}

/** Older devices stored a two-state switch. Read it rather than reset it. */
function parseMode(saved: string | null): SoundMode | null {
  if (saved === 'all' || saved === 'turn' || saved === 'off') return saved
  if (saved === 'on') return 'all'
  return null
}

/**
 * Plays the table.
 *
 * Feeds every new view through {@link diffViews} and turns whatever changed
 * into sound and vibration. The previous view is kept in a ref rather than
 * state: it is only ever read to make a comparison, and putting it in state
 * would render the whole table a second time for every poll.
 */
export function useTableEvents(view: GameView | null) {
  const [mode, setModeState] = useState<SoundMode>('all')
  const previous = useRef<GameView | null>(null)
  const ready = useRef(false)

  // The preference lives in localStorage, which is not readable while the page
  // is being rendered on the server, so it is picked up on mount instead.
  useEffect(() => {
    try {
      const saved = parseMode(localStorage.getItem(STORAGE_KEY))
      if (saved) setModeState(saved)
    } catch {
      // A browser with storage blocked still gets sound; it just forgets.
    }
    ready.current = true
  }, [])

  const setMode = useCallback((next: SoundMode) => {
    setModeState(next)
    if (next !== 'off') unlockAudio()
    try {
      localStorage.setItem(STORAGE_KEY, next)
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
    if (mode === 'off' || !events.length) return

    for (const event of events) {
      if (!audible(mode, event)) continue
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
  }, [view, mode])

  return { soundMode: mode, setSoundMode: setMode }
}
