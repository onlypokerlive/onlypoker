'use client'

import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'holdem:over-silence'

/**
 * Whether this table may speak over the phone's silent switch.
 *
 * On by default, because the alternative is a poker app that is silent on most
 * phones for a reason nobody can see: **on iOS the hardware silent switch mutes
 * Web Audio and does not mute an `<audio>` tag**, and a phone that has been on
 * silent since a meeting last Tuesday is most phones. Nothing in the app is
 * wrong when that happens, so nobody ever finds it.
 *
 * **It is a switch and not a decision made for people, because it has a cost
 * and the cost is somebody else's music.** Getting out from under the silent
 * switch means asking iOS for a `playback` session, and a `playback` session is
 * not mixable: taking it stops whatever the room was listening to. There is no
 * third option — iOS gives one or the other, and there is no way to interrupt
 * now and become mixable later. So the honest thing is to say what it does and
 * let it be turned off.
 *
 * Off, the table mixes with the music and obeys the switch, which is what every
 * page on the web does.
 */
export type OverSilence = boolean

/** On. See above: the silent phone is the common case, not the edge one. */
export const DEFAULT_OVER_SILENCE = true

/** What a stored value means, ignoring anything this never wrote. */
export function parseOverSilence(saved: string | null): OverSilence | null {
  if (saved === 'on') return true
  if (saved === 'off') return false
  return null
}

/**
 * Remembered per device, like the sound switch and the handedness one — it is a
 * fact about this phone in this room, and there are no accounts to hang it on.
 */
export function useOverSilence(): {
  overSilence: OverSilence
  setOverSilence: (next: OverSilence) => void
} {
  const [overSilence, setState] = useState<OverSilence>(DEFAULT_OVER_SILENCE)

  // Not readable while the page is being rendered on the server, so it is
  // picked up on mount — the same rule the sound switch follows.
  useEffect(() => {
    try {
      const saved = parseOverSilence(localStorage.getItem(STORAGE_KEY))
      if (saved !== null) setState(saved)
    } catch {
      // Storage blocked. The setting still works; it just forgets.
    }
  }, [])

  const setOverSilence = useCallback((next: OverSilence) => {
    setState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off')
    } catch {
      // ignore
    }
  }, [])

  return { overSilence, setOverSilence }
}
