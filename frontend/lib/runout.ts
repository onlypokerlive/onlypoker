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
 * How long to hold each card.
 *
 * The server is still counting down to the next deal while this plays — that
 * clock does not know or care that we are mid-reveal. So the whole sequence is
 * fitted inside a fraction of it, and a table with a short pause between hands
 * simply gets a faster run-out rather than one that gets dealt over.
 *
 * `pauseSeconds` is the time actually left before the next deal, not the room's
 * setting. Those used to be the same number and are not any more: the pause the
 * server grants depends on what happened in the hand, and an all-in gets its own
 * allowance precisely so this reveal fits. Pacing off the setting would have
 * spent a twelve-second pause as if it were five.
 */
export function runoutStepMs(steps: number, pauseSeconds: number, preferred = 800): number {
  if (steps <= 0) return preferred
  // Zero is a real answer here — the deal is already due — and it has to mean
  // "as fast as this is still watchable", not "use the default". `Infinity` is
  // the other real answer, for a table with nothing scheduled, and falls out of
  // the `min` below on its own.
  const pause = Math.max(0, pauseSeconds) * 1000
  // Two thirds, so the finished board is on screen for a moment before the
  // next hand takes it away.
  return Math.max(120, Math.min(preferred, (pause * 0.66) / steps))
}

/** Total time the reveal will take, for checking it fits. */
export function runoutDurationMs(steps: number, pauseSeconds: number): number {
  return steps * runoutStepMs(steps, pauseSeconds)
}

/**
 * The seconds the reveal has to play with.
 *
 * The deadline when there is one, because it is the truth; the room's setting
 * only as a floor for the moment between the hand ending and the first view
 * that carries the new deadline.
 */
export function runoutPauseSeconds(
  autoDealAtMs: number | null,
  autoDealSeconds: number,
  now = Date.now(),
): number {
  if (autoDealAtMs != null) return Math.max(0, (autoDealAtMs - now) / 1000)
  // Nothing scheduled: either the host deals by hand, or this view was taken
  // before the handover was armed. Either way nothing is coming to cut the
  // reveal off, so it plays at its own pace.
  return autoDealSeconds || Infinity
}
