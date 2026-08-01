import { cn } from "@/lib/utils"
import { betLabel, POT_ROW_MAX, POT_SIDE_W, POT_W } from "@/lib/table-layout"
import type { PotView } from "@/lib/poker-api"

/**
 * What is in the middle, and — when it matters — how it is divided.
 *
 * A pill, not a panel: the pot sits *on* the cloth and the felt shows around
 * it, which is what stops the middle of the table reading as a dialog box. One
 * number is the ordinary case and stays an unnumbered "Pot", because numbering
 * a pot there is only one of just invites the question of where the other one
 * is.
 *
 * The moment somebody is all in for less than the bet it stops being one
 * number: the short stack is playing for the main pot and everybody else for
 * that plus a side pot they cannot win, and a table that shows only the total
 * is telling every one of them a different wrong thing. The side pots are drawn
 * smaller and dashed — they are secondary and should not compete with the one
 * everybody is playing for.
 */
export function PotDisplay({
  pots,
  total,
  youId,
  live = false,
  u = 1,
}: {
  pots: PotView[]
  total: number
  /** Whose eligibility to mark. Absent for spectators, who have none. */
  youId?: string | null
  /**
   * A hand is being played, so the pot is shown even at zero.
   *
   * Between hands there is genuinely nothing in the middle and the pill goes
   * away; during one it stays put whatever the number, because a pot that
   * appears and disappears as each street closes is the one fixed point on the
   * table moving about.
   */
  live?: boolean
  /**
   * The scale the table is drawn at. See `tableScale`.
   *
   * Not optional in spirit: `estimateCentreBox` reserves this block's room as
   * `POT_W * u` and `POT_ROW_MAX * u`, so a pot row drawn at a fixed size on a
   * table that has shrunk is a pot row sitting in the flank seats' chairs —
   * and the pure test would go on saying the table was fine, because the model
   * and the drawing would no longer be the same shape.
   */
  u?: number
}) {
  // Nothing collected yet — preflop, or a street that has only just opened —
  // is still a hand with a pot in it, and the pot vanishing off the middle of
  // the table between every street is the table losing the one thing everybody
  // is playing for. It reads zero because it *is* zero: what people have put in
  // is still sitting in front of them, which is exactly what the felt shows.
  if (total <= 0 && pots.length === 0 && !live) return null

  const pill =
    "flex items-center rounded-full border backdrop-blur-[4px] font-mono font-bold tabular-nums"
  const style = {
    background: "rgba(0,0,0,.44)",
    borderColor: "color-mix(in srgb, var(--inlay) 28%, transparent)",
    color: "var(--accent)",
  }
  // The main pot's metrics, at u = 1. Side pots are the same drawing a size down.
  // Tighter than it was, by twenty units across the two of them, and the
  // twenty are what let a main pot and a side pot share a row. Two pills on two
  // rows is nineteen units of height taken out of the middle of a nine-handed
  // table, and the matrix says exactly whose bets end up on top of each other
  // when that happens. A pill is a label; the ring is the game.
  const main = {
    gap: 5 * u,
    paddingInline: 5 * u,
    paddingBlock: 2 * u,
    fontSize: 12.5 * u,
  }
  const sideMetrics = {
    gap: 4 * u,
    paddingInline: 4 * u,
    paddingBlock: 1 * u,
    fontSize: 10.5 * u,
  }

  // The word and the number, and nothing else in here.
  //
  // A chip went in this pill for a while, as a stand-in for the pile of chips a
  // real table has in the middle. It was the wrong answer to the right
  // complaint: a token chip beside a number is a *label*, and the felt is
  // already full of labels. The pot's chips are chips, and they live on the
  // cloth under the board where you can watch them grow — see `PotPile`.
  const label = (
    <span
      className="font-sans font-extrabold uppercase tracking-[0.18em]"
      style={{
        fontSize: 7 * u,
        color: "color-mix(in srgb, var(--ivory) 40%, transparent)",
      }}
    >
      Pot
    </span>
  )

  if (pots.length <= 1) {
    return (
      <div className={cn(pill)} style={{ ...style, ...main, maxWidth: POT_W * u }}>
        {label}
        {betLabel(total)}
      </div>
    )
  }

  return (
    // Wrapped, not stacked, and wrapped is the operative word: the row is as
    // wide as the board and three pills are wider, so three pots are two rows —
    // the main and one side, then the second side underneath. Two pots do sit
    // side by side, which is the ordinary case; three do not, and saying they
    // did was the model's claim rather than the DOM's.
    //
    // The height of this block is what decides whether the flanking seats
    // clear it on a short screen, which is why the extra row is worth this
    // much explaining. `estimateCentreBox` carries the same arithmetic and the
    // matrix in `table-layout.test.ts` is what holds them together.
    <div
      className="flex flex-wrap items-center justify-center"
      style={{ maxWidth: POT_ROW_MAX * u, gap: 4 * u }}
    >
      {pots.map((pot, i) => {
        // Nobody is served an empty eligibility list any more, but a spectator
        // has no seat and an older server sent none — and greying out every
        // pot for them would say they had been cut out of the hand.
        const shutOut =
          !!youId && pot.playerIds.length > 0 && !pot.playerIds.includes(youId)
        const side = i > 0
        return (
          <div
            key={i}
            className={cn(
              pill,
              // Not hidden and not explained in words: the pots you cannot win
              // are still what the players around you are playing for, and
              // watching the side pot grow is half of watching the hand.
              shutOut && "opacity-45",
            )}
            style={{
              ...style,
              ...(side ? sideMetrics : main),
              maxWidth: (side ? POT_SIDE_W : POT_W) * u,
              borderStyle: side ? "dashed" : "solid",
              color: side
                ? "color-mix(in srgb, var(--accent) 72%, var(--ivory))"
                : "var(--accent)",
            }}
          >
            <span
              className="font-sans font-extrabold uppercase tracking-[0.18em]"
              style={{
                fontSize: (side ? 6.5 : 7) * u,
                color: "color-mix(in srgb, var(--ivory) 40%, transparent)",
              }}
            >
              {side ? `Side ${i}` : "Main"}
            </span>
            {betLabel(pot.amount)}
            {shutOut && (
              <span className="sr-only">— you are not playing for this one</span>
            )}
          </div>
        )
      })}
    </div>
  )
}
