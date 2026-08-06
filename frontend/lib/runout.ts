// Dealing out an all-in one card at a time.
//
// When everybody is all-in there is nothing left to decide, so the engine deals
// the rest of the board and settles the hand in a single step. The player gets
// the whole ending in one frame: the most tense moment of the night, over
// before it registered.
//
// Nothing about that needs the server. The client already receives the finished
// board — it just has to refuse to show all of it at once.

/** Every board size a hold'em hand passes through. */
const BOARD_SIZES = [0, 3, 4, 5]

/** How many streets a board of this size has seen. */
function streetOf(size: number): number {
  // Boards arrive at 0, 3, 4 or 5; anything else is rounded down to the last
  // street it completed rather than trusted.
  let street = 0
  for (let i = 1; i < BOARD_SIZES.length; i++) if (size >= BOARD_SIZES[i]) street = i
  return street
}

/**
 * The board sizes to show on the way from ``from`` to ``to``.
 *
 * Empty when the board advanced by a single street, which is the normal case
 * and must not be animated: a flop arriving after somebody called is not a
 * run-out, and pausing on it would put a delay in every hand.
 */
export function runoutSteps(from: number, to: number): number[] {
  const start = streetOf(from)
  const end = streetOf(to)
  if (end - start < 2) return []
  return BOARD_SIZES.slice(start + 1, end + 1)
}

/**
 * The beat where the hands are face up and no card has come yet.
 *
 * The reason the run-out is worth watching at all. A board dealt out over hole
 * cards nobody has seen is three cards and no stakes: the tension of an all-in
 * is entirely in knowing what each player needs, and that is knowledge the
 * table only has once the hands are turned over. Every room does it this way —
 * PokerStars went as far as removing the option to hide them, on the grounds
 * that not sweating the board was the worse game.
 *
 * So this is not a pause before the animation. It is the moment the animation
 * is *for*, and the cards that follow are the payoff.
 */
export const RUNOUT_LEAD_IN_MS = 900

/**
 * How long each street is held.
 *
 * Roughly three times an ordinary street, and that is the point: an ordinary
 * street arrives while somebody is still deciding what to do about it, and this
 * one arrives with every decision already made. Nobody is being kept waiting —
 * waiting *is* what everybody is here for. The juice curve puts an all-in in
 * the "every 10-20 hands" band, which is where the budget starts to exist.
 *
 * The exact figures the big rooms use are not published anywhere, so these are
 * not copied from one. What is copied is the shape: hands up, a beat, then the
 * board one street at a time with the last one held longest.
 */
export const RUNOUT_STREET_MS = 1300

/** And the card that decides it gets half a beat more. See §4.2 of the UX doc. */
export const RUNOUT_RIVER_EXTRA_MS = 500

/**
 * The beat between one board finishing and the next one starting.
 *
 * Two boards are dealt **one after the other**, which is how a card room does
 * it: the first board runs out, the table reacts to it, and only then does the
 * second come. Side by side they are one event that happens to have ten cards
 * in it; in sequence they are two answers to the same question, and the second
 * one is being read against an answer everybody already has.
 *
 * Longer than a street and shorter than the lead-in. What it is paying for is
 * not suspense — it is the moment where somebody says "well, that half is
 * yours" before anybody looks down again.
 */
export const RUNOUT_SECOND_BOARD_MS = 1100

/** Below this a card is a flicker rather than a card. */
const MIN_STREET_MS = 140
const MIN_LEAD_IN_MS = 200

/**
 * Two thirds of the pause, so the finished board is on screen for a moment
 * before the next hand takes it away.
 */
const SHARE_OF_PAUSE = 0.66

/** One board size and the moment it lands, measured from the hand ending. */
export interface RunoutBeat {
  /** Which board this street belongs to. Always 0 unless the hand ran twice. */
  board: number
  size: number
  at: number
}

/**
 * The whole run-out as a schedule: when each board size appears.
 *
 * One function rather than a step length and a caller that multiplies, because
 * the beats are not evenly spaced any more — there is a lead-in before the
 * first card and the river is held longest — and a constant that nothing
 * computes is a constant that drifts away from the thing it describes.
 *
 * `handsUpMs` is how long the hands themselves take to turn over
 * (`revealBeats`), and it is the one part of this that does **not** compress:
 * it is a clock `use-showdown` runs on its own, and a board that squeezed under
 * it would land on cards still face down. Everything else is fitted into what
 * the pause has left.
 *
 * `pauseSeconds` is the time actually left before the next deal, not the room's
 * setting. Those used to be the same number and are not any more: the pause the
 * server grants depends on what happened in the hand, and an all-in gets its own
 * allowance precisely so this reveal fits. Pacing off the setting would have
 * spent a twelve-second pause as if it were five.
 */
export function runoutBeats(
  from: number,
  to: number,
  {
    pauseSeconds,
    handsUpMs = 0,
    boards = 1,
  }: { pauseSeconds: number; handsUpMs?: number; boards?: number },
): RunoutBeat[] {
  const steps = runoutSteps(from, to)
  if (!steps.length) return []

  // One run of streets per board, one board after the other. See
  // `RUNOUT_SECOND_BOARD_MS`: this is the order a card room deals them in, and
  // the second board is worth watching precisely because the first one has
  // already been answered.
  const run = Array.from({ length: Math.max(1, boards) }, (_, board) =>
    steps.map((size, i) => ({ board, size, opens: i === 0 })),
  ).flat()

  // The wait *before* each card, because that is where the tension is: the
  // river is the card that decides, so what it earns is a longer hold before it
  // lands and not a longer look at it afterwards. The very first card's wait is
  // the lead-in, so it has no gap of its own; the first card of a *later* board
  // waits out the board before it instead.
  const gaps = run.map((street, i) =>
    i === 0
      ? 0
      : street.opens
        ? RUNOUT_SECOND_BOARD_MS
        : RUNOUT_STREET_MS + (street.size === 5 ? RUNOUT_RIVER_EXTRA_MS : 0),
  )
  const flexible = RUNOUT_LEAD_IN_MS + gaps.reduce((a, b) => a + b, 0)
  // Zero is a real answer here — the deal is already due — and it has to mean
  // "as fast as this is still watchable", not "use the default". `Infinity` is
  // the other real answer, for a table with nothing scheduled, and falls out of
  // the `min` below on its own.
  const budget = Math.max(0, pauseSeconds) * 1000 * SHARE_OF_PAUSE - handsUpMs
  const scale = Math.min(1, Math.max(0, budget) / flexible)

  let at = handsUpMs + Math.max(MIN_LEAD_IN_MS, RUNOUT_LEAD_IN_MS * scale)
  return run.map((street, i) => {
    if (i > 0) at += Math.max(MIN_STREET_MS, gaps[i] * scale)
    return { board: street.board, size: street.size, at }
  })
}

/** When the board is finally complete, for whatever has to wait for it. */
export function runoutDurationMs(beats: RunoutBeat[]): number {
  return beats.length ? beats[beats.length - 1].at : 0
}

/**
 * The seconds the reveal has to play with.
 *
 * The deadline when there is one, because it is the truth; the room's setting
 * only as a floor for the moment between the hand ending and the first view
 * that carries the new deadline.
 *
 * `paused` is the third answer and it is not the same as the second. A stopped
 * table has no deadline *and* a non-zero setting, so reading the setting as a
 * floor said "eight seconds" about a table where the next hand is not coming
 * until somebody presses a button — and squeezed a nine-handed run-out into
 * roughly half its pace to beat a clock that was not running.
 */
export function runoutPauseSeconds(
  autoDealAtMs: number | null,
  autoDealSeconds: number,
  now = Date.now(),
  paused = false,
): number {
  if (autoDealAtMs != null) return Math.max(0, (autoDealAtMs - now) / 1000)
  // Nothing scheduled: the table is stopped, the host deals by hand, or this
  // view was taken before the handover was armed. Either way nothing is coming
  // to cut the reveal off, so it plays at its own pace.
  if (paused) return Infinity
  return autoDealSeconds || Infinity
}
