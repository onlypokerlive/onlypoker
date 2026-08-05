'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { sweepLeadIn, sweepStart } from '@/lib/chip-flight'
import { announce, audioIsAwake, setAudioAudible, unlockAudio } from '@/lib/sound'
import { closedByABet, diffViews, type TableEvent } from '@/lib/table-events'
import { useReducedMotion } from '@/lib/use-reduced-motion'
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

/**
 * On, and everything, until somebody says otherwise.
 *
 * The table makes noise because the table makes noise — chips, cards, knuckles
 * on wood — and a poker app that opens silent is a poker app whose best part is
 * behind a setting nobody goes looking for. Muting is one tap away and it is
 * remembered; being asked to *find* the sound is not.
 *
 * Named rather than written inline at the `useState` because it is a product
 * decision and not a default value.
 */
export const DEFAULT_SOUND_MODE: SoundMode = 'all'

/** What still gets through on "only my turn". Nothing that is about anyone else. */
const MINE: ReadonlySet<TableEvent> = new Set<TableEvent>(['yourTurn'])

/**
 * Moments this hook can name but cannot time, so the table says them instead.
 *
 * `diffViews` stays the one place a moment is *derived* — that is what keeps
 * what you hear and what you see from being two accounts of the same hand —
 * but deriving it is not the same as knowing when it happens. The pot going
 * out waits for the hand to finish being told, and how long that takes is nine
 * hands turning over or two, plus a runout, plus the rake it is made of. Said
 * here it landed on the response, up to five seconds before a single chip
 * moved: a sound for something that had not happened yet.
 *
 * So `poker-table` says this one, in `payOut`, at the instant the chips leave.
 */
const SAID_BY_THE_TABLE: ReadonlySet<TableEvent> = new Set<TableEvent>(['potWon'])

/** Whether this phone, set this way, says anything about this moment. */
export function audible(mode: SoundMode, event: TableEvent): boolean {
  if (mode === 'off') return false
  if (mode === 'all') return true
  return MINE.has(event)
}

/**
 * Whether the table itself may make a noise.
 *
 * The table says the moments only it knows the timing of — a hand turning over,
 * the pot going out — and every one of them is about somebody else, so none of
 * them is in {@link MINE}. Written as its own function rather than left as a
 * comparison at the call site because that comparison was `!== 'off'`, which
 * kept the whole table talking on the one setting that exists to stop it.
 */
export function tableIsAudible(mode: SoundMode): boolean {
  return mode === 'all'
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
  const [mode, setModeState] = useState<SoundMode>(DEFAULT_SOUND_MODE)
  const reduced = useReducedMotion()
  const previous = useRef<GameView | null>(null)
  const ready = useRef(false)
  // The highest decision this phone has ever announced. Monotonic and kept
  // apart from the view, because the view can go backwards: a slow poll
  // landing after a fast one puts an older table on screen, and measuring
  // "already seen" against that replays everything in between.
  const announced = useRef(0)

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
  //
  // Every gesture until one of them works, and not just the first. It was
  // `{ once: true }`, which spends the single attempt on whichever pointer
  // happened to land first — and the ones that do not count are exactly the
  // ones that happen first: a touch that starts a scroll, a tap that arrives
  // while the tab is still hidden, a gesture the browser cancels. Miss it and
  // the phone is silent for the rest of the night with nothing to press to fix
  // it. So it keeps asking until the context is genuinely awake, and then stops
  // for good.
  useEffect(() => {
    if (mode === 'off' || audioIsAwake()) return
    const wake = () => {
      unlockAudio()
      if (audioIsAwake()) stop()
    }
    const stop = () => {
      window.removeEventListener('pointerdown', wake)
      window.removeEventListener('keydown', wake)
    }
    window.addEventListener('pointerdown', wake)
    window.addEventListener('keydown', wake)
    return stop
  }, [mode])

  /**
   * Hold the media channel only while this table is allowed to speak.
   *
   * On iOS that channel is exclusive: taking it can stop whatever the room is
   * listening to. It was taken on the first touch of the page and never given
   * back — including on a table somebody had muted, which is a page that
   * interrupts the music in order to say nothing.
   *
   * Released on the way out too. Leaving the table is leaving the table.
   */
  useEffect(() => {
    setAudioAudible(mode !== 'off')
    return () => setAudioAudible(false)
  }, [mode])

  // Sounds waiting on the rake. Leaving the table is not a reason to hear a
  // card land on it a second later.
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const hush = useCallback(() => {
    for (const timer of timers.current) clearTimeout(timer)
    timers.current.clear()
  }, [])
  useEffect(() => hush, [hush])
  // Turning the sound off is a decision about now, not about the next moment.
  // Up to eight hundred milliseconds of table can already be scheduled when
  // somebody reaches for the switch, and hearing the rake land after muting is
  // the app arguing.
  useEffect(() => {
    if (mode === 'off') hush()
  }, [mode, hush])

  useEffect(() => {
    if (!view) return
    const before = previous.current
    const events = diffViews(before, view, announced.current)
    previous.current = view
    for (const action of view.actions) {
      announced.current = Math.max(announced.current, action.seq)
    }
    if (mode === 'off' || !events.length) return

    // Two moments the table draws on a delay, and a sound has to arrive with
    // the thing it is the sound of.
    //
    // The rake starts a beat after the bet that closed the street lands
    // (`sweepStart`), and the next card lands partway into the rake
    // (`sweepLeadIn`). The card was already waiting; the rake was not — so
    // whenever a street closed on a call, the chips were *heard* going in
    // about six hundred milliseconds before any of them moved.
    const collecting = events.includes('potCollect')
    const lateBet = collecting && closedByABet(before, view)
    const waitFor = (event: TableEvent) =>
      event === 'potCollect'
        ? sweepStart(lateBet)
        : event === 'street' && collecting
          ? sweepLeadIn(lateBet)
          : 0

    for (const event of events) {
      if (!audible(mode, event)) continue
      // Handed over to the table, unless nothing is going to move — with
      // reduced motion there is no flight to wait for and the chips are simply
      // where they end up, so the moment *is* the response and this is the only
      // thing left to say it.
      if (SAID_BY_THE_TABLE.has(event) && !reduced) continue
      const wait = waitFor(event)
      if (!wait) {
        announce(event)
        continue
      }
      const timer = setTimeout(() => announce(event), wait)
      timers.current.add(timer)
    }
  }, [view, mode, reduced])

  return { soundMode: mode, setSoundMode: setMode }
}
