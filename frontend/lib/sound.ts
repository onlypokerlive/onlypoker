// The table's noises, synthesised rather than loaded.
//
// Web Audio generates all of this in a few hundred bytes of code, which beats
// shipping samples: nothing to download, nothing to cache, and no chance of a
// river card landing in silence because a file was still in flight.
//
// The volumes follow the rule that the loudness of a moment should be the
// inverse of how often it happens. Chips going in occurs a hundred times a
// night and is barely there; a player going out happens twice and is allowed
// to be heard.

import type { TableEvent } from '@/lib/table-events'

let ctx: AudioContext | null = null

/**
 * Start (or wake) the audio context.
 *
 * iOS will not let a page make a sound until the user has touched it, and a
 * context created before that first touch stays suspended forever — the app
 * looks like the mute switch is broken. So this is called from a real gesture,
 * and again on every play in case the OS suspended us in the background.
 */
export function unlockAudio(): void {
  if (typeof window === 'undefined') return
  const Ctor = window.AudioContext ?? (window as any).webkitAudioContext
  if (!Ctor) return
  ctx ??= new Ctor()
  if (ctx.state === 'suspended') void ctx.resume()
}

function tone(
  at: number,
  { from, to, dur, type = 'sine', gain = 0.05 }: {
    from: number
    to?: number
    dur: number
    type?: OscillatorType
    gain?: number
  },
) {
  if (!ctx) return
  const osc = ctx.createOscillator()
  const amp = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(from, at)
  if (to) osc.frequency.exponentialRampToValueAtTime(to, at + dur)
  // Ramping rather than switching: a square edge on the envelope is a click,
  // and on a phone speaker that click is louder than the note.
  amp.gain.setValueAtTime(0.0001, at)
  amp.gain.exponentialRampToValueAtTime(gain, at + 0.012)
  amp.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  osc.connect(amp).connect(ctx.destination)
  osc.start(at)
  osc.stop(at + dur + 0.02)
}

/** Filtered noise — the closest thing to a card sliding across felt. */
function swish(at: number, { dur, cutoff, gain = 0.05 }: { dur: number; cutoff: number; gain?: number }) {
  if (!ctx) return
  const frames = Math.floor(ctx.sampleRate * dur)
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames)
  const src = ctx.createBufferSource()
  src.buffer = buffer
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.setValueAtTime(cutoff, at)
  const amp = ctx.createGain()
  amp.gain.setValueAtTime(gain, at)
  amp.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  src.connect(filter).connect(amp).connect(ctx.destination)
  src.start(at)
}

const VOICES: Record<TableEvent, (at: number) => void> = {
  // Two cards to each player: two swishes, close together.
  deal: (t) => {
    swish(t, { dur: 0.14, cutoff: 2400, gain: 0.05 })
    swish(t + 0.09, { dur: 0.14, cutoff: 2000, gain: 0.04 })
  },
  street: (t) => swish(t, { dur: 0.18, cutoff: 1800, gain: 0.06 }),
  // A hundred times a night. Barely there on purpose.
  chips: (t) => tone(t, { from: 1500, to: 900, dur: 0.05, type: 'triangle', gain: 0.035 }),
  yourTurn: (t) => {
    tone(t, { from: 660, dur: 0.09, type: 'sine', gain: 0.06 })
    tone(t + 0.11, { from: 880, dur: 0.11, type: 'sine', gain: 0.06 })
  },
  // Once a hand. Fluid, not triumphant — the confetti is saved for §4.0's
  // rare moments, and a fanfare every hand is what makes people mute the app.
  potWon: (t) => {
    tone(t, { from: 520, dur: 0.1, type: 'triangle', gain: 0.05 })
    tone(t + 0.08, { from: 780, dur: 0.16, type: 'triangle', gain: 0.05 })
  },
  levelUp: (t) => {
    tone(t, { from: 440, to: 660, dur: 0.3, type: 'sawtooth', gain: 0.035 })
    tone(t + 0.28, { from: 660, dur: 0.28, type: 'triangle', gain: 0.05 })
  },
  // Two or three times a night: this one gets the budget.
  elimination: (t) => {
    tone(t, { from: 320, to: 90, dur: 0.55, type: 'sawtooth', gain: 0.07 })
    tone(t + 0.3, { from: 160, to: 70, dur: 0.5, type: 'square', gain: 0.045 })
  },
  // Once a night, if that.
  tournamentEnd: (t) => {
    ;[523, 659, 784, 1047].forEach((f, i) =>
      tone(t + i * 0.11, { from: f, dur: 0.34, type: 'triangle', gain: 0.06 }),
    )
  },
}

export function playEvent(event: TableEvent): void {
  unlockAudio()
  if (!ctx || ctx.state !== 'running') return
  VOICES[event]?.(ctx.currentTime + 0.01)
}
