// The table's noises: eighty kilobytes of real clay and cardboard, with the
// synthesiser underneath as the thing that plays when they have not arrived.
//
// This file used to be synthesis only, and the argument for that was a good
// one: nothing to download, and no chance of a river card landing in silence
// because a file was still in flight. Both halves of that survive here. The
// recordings are fetched *after* the first touch and the synthesiser answers
// until they land, so the silence never happens — it just gets better once the
// download finishes, and on a cold start nobody hears the difference because
// eighty kilobytes arrive faster than the first hand is dealt.
//
// What the recordings buy is the thing synthesis could not: a clay disc has an
// irregularity in it that no amount of shaped noise reproduces. The synthesised
// version got the *shape* right — a transient, not a note, which is the rule
// the very first version broke and why it sounded like an arcade cabinet — but
// a real chip recorded at 96 kHz still wins, because it is a chip.
//
// **The volumes follow the rule that the loudness of a moment should be the
// inverse of how often it happens.** Chips going in occurs a hundred times a
// night and is barely there; a player going out happens twice and is allowed to
// be heard. That rule is expressed in {@link VOICES}, and {@link GAIN} is the
// measured set of numbers that makes the recordings land where the synthesised
// voices already were — so the two paths are the same loudness and swapping
// between them mid-hand is inaudible.
//
// The cuts themselves, and the reasoning for each one, are in
// `scripts/build-sounds.py`.

import { HAPTICS, type TableEvent } from '@/lib/table-events'

let ctx: AudioContext | null = null

/** Whether the context has ever actually been running. See `audioIsAwake`. */
export function audioIsAwake(): boolean {
  return ctx?.state === 'running'
}

/**
 * A sound that arrives later than this is not the sound of anything.
 *
 * The wake-up below is asynchronous, and a chip rattle that lands a second
 * after the chips is a second noise rather than a late one.
 */
const TOO_LATE_MS = 500

/**
 * Put this page's audio on the media channel rather than the ringer's, or give
 * it back.
 *
 * The single most common reason "the sound does not work on my iPhone", and it
 * is not a bug in the page: **on iOS the hardware silent switch mutes Web Audio
 * and does not mute an `<audio>` tag.** A phone that has been on silent since a
 * meeting last Tuesday — which is most phones — deals cards in silence, and
 * nothing in the app is wrong, so nobody ever finds it.
 *
 * `navigator.audioSession` is the standard answer and Safari has it. Older iOS
 * gets the trick the whole web used before the API existed — a silent looping
 * `<audio>` element, which is on the media channel by virtue of being an
 * element, and drags the context onto it.
 *
 * **What is being asked for is exclusive, and that is the cost.** A `playback`
 * session is not mixable: claiming it can stop whatever the room is listening
 * to. So it is not claimed on the way past — it is held only while this table
 * is actually allowed to make a noise, and handed straight back when it is not.
 * `unlockAudio` deliberately does not call this; {@link setAudioAudible} does,
 * from the one place that knows whether the switch is on.
 *
 * Both paths are best-effort and neither is load-bearing: with both refused the
 * app behaves exactly as it did, which is to say it works with the ringer on.
 */
function claimPlaybackChannel(): void {
  const session = (navigator as any).audioSession
  if (session) {
    try {
      session.type = PLAYBACK_TYPE
      return
    } catch {
      // Fall through to the element.
    }
  }
  if (silence) {
    void silence.play().catch(() => {})
    return
  }
  try {
    silence = new Audio(SILENCE)
    silence.loop = true
    // An attribute rather than a property: `playsinline` is typed onto video
    // elements only, and Safari reads it off the audio element all the same.
    silence.setAttribute('playsinline', '')
    // Not muted: a muted element is not playing media as far as the OS is
    // concerned, and the whole point is to be playing media. The file is
    // silent instead, which costs 444 bytes and nothing to listen to.
    void silence.play().catch(() => {})
  } catch {
    silence = null
  }
}

/**
 * Hand the channel back.
 *
 * Because a page that keeps an exclusive session after it has been muted is a
 * page that took something and did not say what for. `auto` is the browser's
 * own judgement, which is where this started.
 *
 * The silent element is *paused* rather than dropped: while it is playing, iOS
 * treats this page as a media player and will offer it transport controls on
 * the lock screen — a poker table with a play button on the lock screen.
 */
function releasePlaybackChannel(): void {
  const session = (navigator as any).audioSession
  if (session) {
    try {
      session.type = 'auto'
    } catch {
      // ignore
    }
  }
  silence?.pause()
}

/**
 * The session this table asks for when it is allowed to make a noise.
 *
 * `playback` is the only type that escapes the silent switch, and it is not
 * mixable — so this is also the decision to interrupt whatever else the phone
 * is playing. One name, in one place, because it is a product decision and not
 * a constant: `ambient` is the other real answer and it means the table obeys
 * the silent switch and never touches the music.
 */
const PLAYBACK_TYPE = 'playback'

let silence: HTMLAudioElement | null = null

/** Fifty milliseconds of nothing, looped: 8kHz mono 8-bit, 444 bytes of WAV. */
const SILENCE =
  'data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA'

/**
 * Start (or wake) the audio context.
 *
 * iOS will not let a page make a sound until the user has touched it, and a
 * context created before that first touch stays suspended forever — the app
 * looks like the mute switch is broken. So this is called from a real gesture,
 * and again on every play in case the OS suspended us in the background.
 *
 * It is also where the recordings start downloading, for the same reason it is
 * where the context is built: decoding needs a context, and there is no context
 * until somebody has touched the page. Starting the fetch any earlier would mean
 * eighty kilobytes downloaded on a page nobody turned out to be playing on.
 */
export function unlockAudio(): void {
  if (typeof window === 'undefined') return
  const Ctor = window.AudioContext ?? (window as any).webkitAudioContext
  if (!Ctor) return
  ctx ??= new Ctor()
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
  fetchSamples()
}

/**
 * Say whether this table is allowed to make a noise, and take or give back the
 * audio channel to match.
 *
 * Separate from `unlockAudio` because they answer different questions. Waking
 * the context costs nothing and can happen on any touch; holding the media
 * channel is exclusive and can silence the room's music, so it is held only for
 * as long as there is something to hold it for. Called by the one thing that
 * knows: the sound switch.
 */
export function setAudioAudible(audible: boolean): void {
  if (typeof window === 'undefined') return
  if (audible) claimPlaybackChannel()
  else releasePlaybackChannel()
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

// --------------------------------------------------------------------------- //
// Materials
//
// Four things make every sound at a poker table: a clay disc, a card, the wood
// of the rail, and cloth. Everything below is built out of those, which is why
// the voices further down read as a list of events rather than a list of notes.
// --------------------------------------------------------------------------- //

/**
 * Shaped noise: the workhorse.
 *
 * `shape` is the exponent on the decay envelope, and it is most of the
 * difference between one material and another. 1 is a linear fade — cloth, a
 * card travelling. 3 or 4 is almost entirely attack — something hard meeting
 * something hard.
 */
function noise(
  at: number,
  {
    dur,
    freq,
    type = 'bandpass',
    q = 1,
    gain = 0.05,
    shape = 2,
    sweepTo,
  }: {
    dur: number
    freq: number
    type?: BiquadFilterType
    q?: number
    gain?: number
    shape?: number
    /** Where the filter ends up, for anything that travels. */
    sweepTo?: number
  },
) {
  if (!ctx) return
  const frames = Math.max(1, Math.floor(ctx.sampleRate * dur))
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < frames; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, shape)
  }
  const src = ctx.createBufferSource()
  src.buffer = buffer
  const filter = ctx.createBiquadFilter()
  filter.type = type
  filter.Q.setValueAtTime(q, at)
  filter.frequency.setValueAtTime(vary(freq, 0.09), at)
  if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, at + dur)
  const amp = ctx.createGain()
  amp.gain.setValueAtTime(vary(gain, 0.12), at)
  amp.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  src.connect(filter).connect(amp).connect(ctx.destination)
  src.start(at)
}

/** A pitched body under a transient, or — twice a night — an actual note. */
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

/**
 * One clay disc striking another. The atom of every chip sound in the app.
 *
 * Sixteen milliseconds, and nearly all of it is the first three: a hard bright
 * transient around 3kHz for the strike, with a short ring near 1.4kHz under it
 * for the disc. Clay is not metal, so the ring is quiet and dies with the
 * strike — give it any sustain at all and it turns into a coin.
 */
function clack(at: number, { gain = 0.05, pitch = 1 }: { gain?: number; pitch?: number } = {}) {
  noise(at, { dur: 0.016, freq: 3000 * pitch, q: 1.4, gain, shape: 4 })
  tone(at, { from: vary(1400 * pitch, 0.1), dur: 0.014, type: 'triangle', gain: gain * 0.45 })
}

/**
 * Chips moving: several discs finding each other over a short window.
 *
 * The sound the app makes most, so the one worth getting right. A bet is not
 * one event — it is five or six discs pushed forward, knocking together,
 * quieter as the stack settles. The unevenness is the whole trick: clacks on a
 * regular grid are a drum machine, and no amount of pitch variation rescues
 * them. Squared random, so they bunch at the front the way a handful of chips
 * does — they land together and a straggler settles after.
 */
function chipRattle(
  at: number,
  { count = 5, spread = 0.09, gain = 0.045 }: { count?: number; spread?: number; gain?: number } = {},
) {
  for (let i = 0; i < count; i++) {
    const when = at + Math.pow(Math.random(), 1.7) * spread
    clack(when, { gain: gain * (1 - (0.45 * i) / count), pitch: vary(1, 0.16) })
  }
}

/** A card leaving the deck and travelling across cloth. */
function card(at: number, { dur = 0.1, gain = 0.05 }: { dur?: number; gain?: number } = {}) {
  noise(at, { dur, freq: 2600, sweepTo: 1500, q: 0.7, gain, shape: 1.5 })
  // The corner catching the felt as it stops. Tiny, and it is the difference
  // between a card and a breath.
  noise(at + dur * 0.82, { dur: 0.02, freq: 4200, q: 1.2, gain: gain * 0.55, shape: 4 })
}

/**
 * Knuckles on wood — the one sound everybody at a poker table knows.
 *
 * A low-passed burst for the skin and a resonant sine under it for the table,
 * both dying almost immediately. `body` is how big the table is.
 */
function knock(at: number, { body = 150, gain = 0.06 }: { body?: number; gain?: number } = {}) {
  noise(at, { dur: 0.05, freq: vary(700, 0.08), type: 'lowpass', gain, shape: 2 })
  tone(at, { from: vary(body, 0.06), to: body * 0.6, dur: 0.06, type: 'sine', gain: gain * 0.9 })
}

/** Something dragged across cloth: a pot swept in, a hand mucked. */
function sweep(at: number, { dur = 0.32, gain = 0.04 }: { dur?: number; gain?: number } = {}) {
  noise(at, { dur, freq: 1400, sweepTo: 420, type: 'lowpass', q: 0.6, gain, shape: 1 })
}

/**
 * Noises the interface makes, as opposed to noises the table makes.
 *
 * Apart from {@link TableEvent} because nothing in a polled view implies them:
 * they belong to a moment on *this* phone — a card being turned over by an
 * animation running here, this player's clock, this player's rejected tap —
 * and the code that owns that moment asks for them directly.
 */
// `shuffle` was here and has been removed rather than left unplayed. It was a
// good sound with nowhere to happen: the deck is shuffled by the server between
// hands, in a gap the client spends showing who won, and playing it there put a
// riffle over the one moment of the hand that is worth listening to. A voice
// nothing calls is a voice the next person wires up to find out where it goes.
export type Cue = 'flip' | 'timeWarning' | 'error'

const VOICES: Record<TableEvent | Cue, (at: number) => void> = {
  // Two cards each, pitched across the table rather than laid down.
  deal: (t) => {
    card(t, { dur: 0.085, gain: 0.045 })
    card(t + 0.075, { dur: 0.085, gain: 0.038 })
  },
  // The burn and the street: one card, put down deliberately.
  street: (t) => card(t, { dur: 0.12, gain: 0.055 }),

  // A hundred times a night, barely there — but *chips*, which is the whole
  // point and the thing the old sweeping beep was not.
  chips: (t) => chipRattle(t, { count: 5, spread: 0.08, gain: 0.04 }),

  // Not a melody. What tells you it is on you in a card room is the dealer
  // tapping the rail beside your seat — lighter and higher than a player's
  // knuckle-knock, so it is never mistaken for somebody checking.
  yourTurn: (t) => {
    knock(t, { body: 320, gain: 0.045 })
    knock(t + 0.13, { body: 380, gain: 0.05 })
  },

  // Once a hand: the pot dragged back and the stack landing in front of
  // somebody. Chips, not a fanfare — a fanfare every hand is what makes people
  // mute an app, and the two moments a night that earn one are below.
  potWon: (t) => {
    sweep(t, { dur: 0.34, gain: 0.045 })
    chipRattle(t + 0.16, { count: 9, spread: 0.3, gain: 0.045 })
  },

  // The blinds going up. A single soft chime is not a cheat here: real rooms
  // ring one, and it is the moment where a note carries something no object at
  // the table could say.
  levelUp: (t) => {
    tone(t, { from: 784, dur: 0.5, type: 'sine', gain: 0.05 })
    tone(t + 0.005, { from: 1568, dur: 0.34, type: 'sine', gain: 0.016 })
  },

  // Two or three times a night: this one gets the budget. Their chips swept
  // off the table, and the room going quiet underneath it.
  elimination: (t) => {
    sweep(t, { dur: 0.5, gain: 0.06 })
    chipRattle(t + 0.04, { count: 12, spread: 0.34, gain: 0.05 })
    tone(t + 0.12, { from: 190, to: 78, dur: 0.7, type: 'sine', gain: 0.045 })
  },

  // Once a night, if that. A cascade first — a very large stack being pushed
  // together — and only then a chord over the top of it.
  tournamentEnd: (t) => {
    chipRattle(t, { count: 22, spread: 0.75, gain: 0.05 })
    ;[523, 659, 784, 1047].forEach((f, i) =>
      tone(t + 0.18 + i * 0.1, { from: f, dur: 0.42, type: 'sine', gain: 0.045 }),
    )
  },

  // The sound of poker. Two raps about 90ms apart, which is how a hand
  // actually falls — one deliberate knock is a door, two is a check.
  check: (t) => {
    knock(t, { gain: 0.055 })
    knock(t + 0.09, { gain: 0.04 })
  },

  // Cards pushed away across the felt. Darker and longer than a deal, and one
  // of them: they leave together.
  fold: (t) =>
    noise(t, { dur: 0.2, freq: 1500, sweepTo: 700, q: 0.6, gain: 0.04, shape: 1.2 }),

  // Calling and raising are the same material in a different quantity, which
  // is exactly what they are at a table: more chips, pushed harder. Hearing
  // one as the other is how half the information at a table went inaudible.
  raise: (t) => chipRattle(t, { count: 9, spread: 0.16, gain: 0.05 }),

  // Everything stops. A whole stack goes forward — a long rattle — and under
  // it a note that opens out rather than bangs. A bang is only louder; a room
  // going quiet is what an all-in actually sounds like.
  allIn: (t) => {
    chipRattle(t, { count: 16, spread: 0.4, gain: 0.05 })
    tone(t + 0.05, { from: 150, to: 232, dur: 0.75, type: 'sine', gain: 0.045 })
  },

  // The street closed and the bets were swept in. Cloth first, chips settling
  // after — the order is what makes it read as a direction.
  potCollect: (t) => {
    sweep(t, { dur: 0.24, gain: 0.04 })
    chipRattle(t + 0.1, { count: 6, spread: 0.16, gain: 0.035 })
  },

  // One hand turned over. Fired per hand during a showdown, so it has to be
  // dry and very short or six in a row become a drum roll.
  flip: (t) => noise(t, { dur: 0.045, freq: 3400, q: 1.1, gain: 0.045, shape: 3 }),
  // The warning that cannot fail, and only ever your own — nine countdowns
  // ticking at once is not a warning, it is a room nobody can sit in. The one
  // deliberately synthetic voice in the app: this is the *app* talking, not
  // the table, and it has to cut through people talking over it.
  timeWarning: (t) => tone(t, { from: 1200, dur: 0.045, type: 'square', gain: 0.04 }),
  // Something you asked for was refused. Short and downward, which is what
  // "no" sounds like in every interface anybody has ever used.
  error: (t) => tone(t, { from: 320, to: 190, dur: 0.11, type: 'square', gain: 0.04 }),
}

// --------------------------------------------------------------------------- //
// The recordings
//
// Everything above this line is the fallback. Everything below is what people
// actually hear once the files have landed.
// --------------------------------------------------------------------------- //

/** One file in `public/sounds`. Cut by `scripts/build-sounds.py`. */
type Sample =
  | 'chips-1' | 'chips-2' | 'chips-3'
  | 'raise' | 'pot-collect' | 'pot-won' | 'elimination' | 'all-in'
  | 'tournament-end'
  | 'deal-1' | 'deal-2' | 'deal-3' | 'street' | 'flip' | 'fold'
  | 'check' | 'your-turn' | 'level-up'

/**
 * A pool the same size as the number of times a thing happens in a row.
 *
 * Nine players dealt in is eighteen cards, and eighteen identical noises is a
 * machine gun rather than a table — the ear notices sameness long before it
 * notices pitch. The synthesiser solved this with {@link vary}; recordings
 * solve it by being different recordings, which is better, because the three
 * chip variants are three genuinely different handfuls rather than one handful
 * multiplied by 1.04.
 */
const DEAL = ['deal-1', 'deal-2', 'deal-3'] as const
const CHIPS = ['chips-1', 'chips-2', 'chips-3'] as const

/** One file inside a moment: which pool to draw from, when, and how loud. */
type Layer = {
  /** More than one name means a variant is chosen per play. */
  from: readonly Sample[]
  /** Seconds after the start of the moment. */
  at?: number
  /** Relative to the moment's own {@link GAIN} entry. */
  gain?: number
}

/**
 * Everything the table itself makes a noise about.
 *
 * `timeWarning` and `error` are excluded *by the type*, not by being left out
 * of a list, because they are the app talking rather than the table and they
 * are the two places in here where a synthetic noise is the right answer rather
 * than a compromise. Saying it this way means the compiler asks for a file and
 * a volume for every new table event, and refuses to accept one for those two.
 */
type Sampled = Exclude<TableEvent | Cue, 'timeWarning' | 'error'>

function isSampled(event: TableEvent | Cue): event is Sampled {
  return event !== 'timeWarning' && event !== 'error'
}

/**
 * What each moment is made of.
 *
 * Most are one file, because most were cut as one gesture. The one that is not
 * is the one the table performs rather than emits: a deal is two cards, and
 * they have to be two *different* cards or the pool was pointless.
 */
const SAMPLED: Record<Sampled, readonly Layer[]> = {
  deal: [{ from: DEAL }, { from: DEAL, at: 0.075, gain: 0.82 }],
  street: [{ from: ['street'] }],
  chips: [{ from: CHIPS }],
  raise: [{ from: ['raise'] }],
  check: [{ from: ['check'] }],
  fold: [{ from: ['fold'] }],
  yourTurn: [{ from: ['your-turn'] }],
  potCollect: [{ from: ['pot-collect'] }],
  potWon: [{ from: ['pot-won'] }],
  allIn: [{ from: ['all-in'] }],
  levelUp: [{ from: ['level-up'] }],
  elimination: [{ from: ['elimination'] }],
  tournamentEnd: [{ from: ['tournament-end'] }],
  flip: [{ from: ['flip'] }],
}

/**
 * How loud each moment is, measured rather than guessed.
 *
 * **These are calibration, not a ranking.** Two entries with the same number are
 * not equally loud, because the files are normalised to the same *peak* and a
 * peak says nothing about loudness: a dry knock and a fizz of chips can top out
 * identically and be six decibels apart to a listener. So the numbers cannot be
 * read straight down as a hierarchy, and the first version of this table was
 * written as if they could.
 *
 * What they are is the answer to one question asked of every moment: what gain
 * makes the recording arrive at the same level as the synthesised voice it
 * replaces? Each was measured by rendering both paths through an
 * OfflineAudioContext and comparing RMS. Before that, the recordings landed
 * between 1 dB below and **8.6 dB above** the synthesiser, which is a phone
 * that gets abruptly louder in the middle of a hand as the last file finishes
 * downloading — an artefact with no cause a player could ever guess at.
 *
 * The inverse-frequency rule still holds; it just lives in {@link VOICES},
 * which these reproduce. Retuning the mix by ear is still one number per
 * moment — but moving one now means the two paths disagree by that much, so
 * move the voice with it or accept the step.
 */
export const GAIN: Record<Sampled, number> = {
  // Medido tres veces por lado: el propio sintetizador varía ±1,1 dB de una
  // pasada a otra porque `vary` le mueve el filtro, así que afinar por debajo
  // de eso es medir ruido y no sonido.
  flip: 0.046,
  potCollect: 0.060,
  fold: 0.065,
  chips: 0.086,
  yourTurn: 0.089,
  deal: 0.090,
  check: 0.095,
  raise: 0.111,
  potWon: 0.119,
  street: 0.151,
  elimination: 0.246,
  allIn: 0.318,
  levelUp: 0.337,
  tournamentEnd: 0.426,
}

/**
 * Every file the table needs, deduplicated.
 *
 * Derived from {@link SAMPLED} rather than written out a second time, because a
 * second list is a list that goes stale — and exported, because the one thing
 * worth asserting about this module from outside is that all of these actually
 * exist on disk in both formats. A cut renamed in `build-sounds.py` and not
 * here is a moment that falls back to synthesis forever and says nothing about
 * it, which is exactly the sort of failure nobody notices until a game night.
 */
export const SAMPLE_FILES: readonly Sample[] = [
  ...new Set(Object.values(SAMPLED).flatMap((layers) => layers.flatMap((l) => [...l.from]))),
]

const decoded = new Map<Sample, AudioBuffer>()
/** The last variant each pool handed out, so it never hands it out twice. */
const lastPick = new Map<string, Sample>()
let fetching = false

/**
 * Which container this browser will actually decode.
 *
 * Opus in WebM is half the size and Chrome, Firefox and Safari 17.4+ all take
 * it. AAC in M4A is what everything older takes, and "older Safari" in a game
 * played on phones with friends is not an edge case, it is half the table. Both
 * are built; picking one and being wrong is an iPhone dealing cards in silence.
 */
function container(): 'webm' | 'm4a' {
  const probe = document.createElement('audio')
  return probe.canPlayType('audio/webm; codecs=opus') ? 'webm' : 'm4a'
}

/**
 * Fetch and decode everything, once, in the background.
 *
 * Deliberately not awaited by anything. A moment that arrives before its file
 * does is played by the synthesiser, which is the entire reason the synthesiser
 * is still here — so there is nothing to block on and no loading state to show.
 * A file that 404s or fails to decode simply leaves that one moment synthesised
 * forever, which is a bad outcome for a sound and not an outcome at all for
 * the app.
 */
function fetchSamples(): void {
  if (fetching || !ctx || typeof fetch === 'undefined') return
  fetching = true
  const ext = container()
  for (const name of SAMPLE_FILES) {
    void (async () => {
      try {
        const response = await fetch(`/sounds/${name}.${ext}`)
        if (!response.ok) return
        const buffer = await ctx!.decodeAudioData(await response.arrayBuffer())
        decoded.set(name, buffer)
      } catch {
        // Stays synthesised. Nothing else to do about it, and nothing to say:
        // the table keeps making the right noise at the right time either way.
      }
    })()
  }
}

/**
 * Choose a variant, never the same one twice running.
 *
 * Pure, and exported, because "twice running" is the only property here worth
 * testing and it is invisible from outside otherwise. Random-minus-the-last-one
 * rather than a cycle: a cycle of three is a pattern the ear learns in about
 * six hands, which is a slower version of the problem the pool was meant to fix.
 */
export function pickVariant(
  pool: readonly Sample[],
  previous: Sample | undefined,
  roll: number = Math.random(),
): Sample {
  if (pool.length === 1) return pool[0]
  const choices = pool.filter((name) => name !== previous)
  return choices[Math.min(choices.length - 1, Math.floor(roll * choices.length))]
}

/**
 * Say a moment with recordings, if every file it needs has arrived.
 *
 * All or nothing per moment: a deal with one of its two cards decoded would be
 * a deal with one card, which is worse than a synthesised deal with two. Returns
 * false and lets the synthesiser take it instead.
 */
function playSampled(event: TableEvent | Cue, at: number): boolean {
  if (!ctx || !isSampled(event)) return false
  const layers = SAMPLED[event]

  const chosen: Sample[] = []
  for (const layer of layers) {
    // Within one moment the previous layer is what must not repeat; across
    // moments it is the last thing this pool said. Both are "the sound you just
    // heard", which is the only thing the ear is comparing against.
    const key = layer.from.join()
    const pick = pickVariant(layer.from, chosen[chosen.length - 1] ?? lastPick.get(key))
    if (!decoded.has(pick)) return false
    chosen.push(pick)
    lastPick.set(key, pick)
  }

  const level = GAIN[event]
  layers.forEach((layer, i) => {
    const src = ctx!.createBufferSource()
    src.buffer = decoded.get(chosen[i])!
    // A little either side of the recorded pitch. The pool stops two chips in a
    // row being identical; this stops the same *variant* twice in one night
    // being identical, and it is small enough that nothing sounds detuned.
    src.playbackRate.setValueAtTime(vary(1, 0.035), at)
    const amp = ctx!.createGain()
    amp.gain.setValueAtTime(level * (layer.gain ?? 1), at)
    src.connect(amp).connect(ctx!.destination)
    src.start(at + (layer.at ?? 0))
  })
  return true
}

function say(event: TableEvent | Cue): void {
  if (!ctx) return
  const at = ctx.currentTime + 0.01
  if (playSampled(event, at)) return
  VOICES[event]?.(at)
}

export function playEvent(event: TableEvent | Cue): void {
  unlockAudio()
  if (!ctx) return
  if (ctx.state === 'running') {
    say(event)
    return
  }

  // Suspended, and about to stop being. `resume()` is a promise, and this used
  // to give up in front of it — so every sound that landed inside the wake-up
  // was dropped and nothing said so. On iOS that is not an edge case, it is the
  // *first* sound: the context is asleep until the page is touched and asleep
  // again every time the phone comes back from the lock screen, which at this
  // table is once a hand. The app sounded broken and then started working, and
  // both were the same code.
  //
  // Waited for rather than queued, and dropped if the wait runs long: a rattle
  // that arrives a second after the chips is not a late sound, it is a wrong
  // one.
  const asked = Date.now()
  void ctx
    .resume()
    .then(() => {
      if (ctx?.state !== 'running' || Date.now() - asked > TOO_LATE_MS) return
      say(event)
    })
    .catch(() => {
      // Refused: no gesture has happened yet. The next one will call this again.
    })
}

/** Same thing, named for the caller that owns the moment. See {@link Cue}. */
export function playCue(cue: Cue): void {
  playEvent(cue)
}

/**
 * Say a moment out loud: the noise and the buzz, which are one thing.
 *
 * A phone in a pocket is the buzz and a phone on a table is the noise, and
 * both are the same sentence — so they are said in one call rather than left
 * to two callers to remember. Here rather than in the hook because the hook is
 * no longer the only one saying things: the table announces the moments only
 * it knows the timing of, which are the ones that wait for something to finish
 * moving.
 */
export function announce(event: TableEvent | Cue): void {
  playEvent(event)
  const pattern = HAPTICS[event as TableEvent]
  // Safari on iOS has no Vibration API at all. Nothing to fall back to — it
  // just does not buzz there.
  if (pattern && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(pattern)
    } catch {
      // ignore
    }
  }
}

/** Every noise the app can make — so a settings screen can audition them. */
export const ALL_VOICES = Object.keys(VOICES) as (TableEvent | Cue)[]
