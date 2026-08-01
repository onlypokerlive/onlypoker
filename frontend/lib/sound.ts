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

/**
 * A little different every time.
 *
 * A deal to nine is eighteen cards, and eighteen identical noises is a
 * machine gun rather than a table — the ear notices sameness long before it
 * notices pitch. With samples this would mean shipping variants; synthesised
 * it is one multiplication. Deliberately small: enough that no two are the
 * same, not enough that any one of them sounds wrong.
 */
function vary(value: number, spread: number) {
  return value * (1 + (Math.random() * 2 - 1) * spread)
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
  // ±8% on the cut and ±10% on the level: the two knobs that make a card sound
  // like a different card without making it sound like a different thing.
  filter.frequency.setValueAtTime(vary(cutoff, 0.08), at)
  const amp = ctx.createGain()
  amp.gain.setValueAtTime(vary(gain, 0.1), at)
  amp.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  src.connect(filter).connect(amp).connect(ctx.destination)
  src.start(at)
}

/**
 * Knuckles on wood — the one sound everybody at a poker table knows.
 *
 * A low-passed burst of noise for the skin and a resonant sine under it for
 * the table itself, both dying almost immediately. The same family as the
 * deck being squared before a deal (G2), which is why they are written
 * together: the difference between them is how much low end is left in.
 */
function knock(at: number, { body = 150, gain = 0.06 }: { body?: number; gain?: number } = {}) {
  if (!ctx) return
  const frames = Math.floor(ctx.sampleRate * 0.05)
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  // Squared decay, not linear: a knock is almost entirely its attack, and a
  // gentler tail turns it into a tap on a cushion.
  for (let i = 0; i < frames; i++) {
    const fade = 1 - i / frames
    data[i] = (Math.random() * 2 - 1) * fade * fade
  }
  const src = ctx.createBufferSource()
  src.buffer = buffer
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(vary(700, 0.08), at)
  const amp = ctx.createGain()
  amp.gain.setValueAtTime(vary(gain, 0.1), at)
  amp.gain.exponentialRampToValueAtTime(0.0001, at + 0.05)
  src.connect(filter).connect(amp).connect(ctx.destination)
  src.start(at)
  // The wood.
  tone(at, { from: vary(body, 0.06), to: body * 0.6, dur: 0.06, type: 'sine', gain: gain * 0.9 })
}

/**
 * Noises the interface makes, as opposed to noises the table makes.
 *
 * Apart from {@link TableEvent} because nothing in a polled view implies them:
 * they belong to a moment on *this* phone — a card being turned over by an
 * animation running here, this player's clock, this player's rejected tap —
 * and the code that owns that moment asks for them directly.
 */
export type Cue = 'flip' | 'timeWarning' | 'error' | 'shuffle'

const VOICES: Record<TableEvent | Cue, (at: number) => void> = {
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

  // The sound of poker, and until now the table was silent for it. Two knocks
  // about 90ms apart, which is how a hand actually falls — one deliberate
  // rap is a door, two is a check.
  check: (t) => {
    knock(t, { gain: 0.055 })
    knock(t + 0.09, { gain: 0.04 })
  },
  // Cards going away across the felt. Longer and darker than a deal, and only
  // one of them: they leave together.
  fold: (t) => swish(t, { dur: 0.22, cutoff: 1200, gain: 0.045 }),
  // Calling and raising used to be the same noise, which made half the
  // information at the table inaudible. More body, and two of them.
  raise: (t) => {
    tone(t, { from: 1500, to: 900, dur: 0.05, type: 'triangle', gain: 0.045 })
    tone(t + 0.07, { from: 1300, to: 700, dur: 0.07, type: 'triangle', gain: 0.05 })
  },
  // Everything stops. No percussion at all — a note that opens out under the
  // table is what makes a room go quiet, where a bang would just be louder.
  allIn: (t) => {
    tone(t, { from: 180, to: 260, dur: 0.5, type: 'sawtooth', gain: 0.05 })
    tone(t + 0.06, { from: 360, to: 520, dur: 0.44, type: 'sine', gain: 0.04 })
  },
  // Fired once per hand turned over during a showdown, so in sequence it
  // builds. Dry and very short, or six of them in a row is a drum roll.
  potCollect: (t) => {
    swish(t, { dur: 0.16, cutoff: 900, gain: 0.045 })
    tone(t + 0.04, { from: 900, to: 500, dur: 0.09, type: 'triangle', gain: 0.03 })
  },

  // One hand turned over. Fired per hand during a showdown, so it has to be
  // dry and very short or six in a row become a drum roll.
  flip: (t) => swish(t, { dur: 0.07, cutoff: 3200, gain: 0.045 }),
  // The aviso that cannot fail, and only ever your own — nine countdowns
  // ticking at once is not a warning, it is a room nobody can sit in.
  timeWarning: (t) => tone(t, { from: 1200, dur: 0.045, type: 'square', gain: 0.04 }),
  // Something you asked for was refused. Short and downward, which is what
  // "no" sounds like in every interface anybody has ever used.
  error: (t) => tone(t, { from: 320, to: 190, dur: 0.11, type: 'square', gain: 0.04 }),
  // The deck squared and rapped on the table before a deal (G2). Same family
  // as `check` by design: wood and card, sharp attack, gone immediately.
  shuffle: (t) => {
    swish(t, { dur: 0.12, cutoff: 2600, gain: 0.035 })
    knock(t + 0.17, { body: 120, gain: 0.05 })
  },
}

export function playEvent(event: TableEvent | Cue): void {
  unlockAudio()
  if (!ctx || ctx.state !== 'running') return
  VOICES[event]?.(ctx.currentTime + 0.01)
}

/** Same thing, named for the caller that owns the moment. See {@link Cue}. */
export function playCue(cue: Cue): void {
  playEvent(cue)
}
