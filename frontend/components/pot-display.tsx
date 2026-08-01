import { cn } from "@/lib/utils"
import type { PotView } from "@/lib/poker-api"

/**
 * What is in the middle, and — when it matters — how it is divided.
 *
 * One number is the ordinary case and stays a single unnumbered "Pot", because
 * numbering a pot there is only one of just invites the question of where the
 * other one is. The moment somebody is all in for less than the bet it stops
 * being one number: the short stack is playing for the main pot and everybody
 * else for that plus a side pot they cannot win, and a table that shows only
 * the total is telling every one of them a different wrong thing.
 */
export function PotDisplay({
  pots,
  total,
  youId,
}: {
  pots: PotView[]
  total: number
  /** Whose eligibility to mark. Absent for spectators, who have none. */
  youId?: string | null
}) {
  if (total <= 0 && pots.length === 0) return null

  if (pots.length <= 1) {
    return (
      <div className="rounded-full bg-background/70 px-4 py-1 text-center backdrop-blur">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Pot
        </span>
        <div className="font-mono text-lg font-bold tabular-nums text-accent">
          {total.toLocaleString()}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-0.5 rounded-2xl bg-background/70 px-3 py-1 backdrop-blur">
      {pots.map((pot, i) => {
        // Nobody is served an empty eligibility list any more, but a spectator
        // has no seat and an older server sent none — and greying out every
        // pot for them would say they had been cut out of the hand.
        const shutOut =
          !!youId && pot.playerIds.length > 0 && !pot.playerIds.includes(youId)
        return (
          <div
            key={i}
            className={cn(
              "flex items-baseline gap-2 leading-tight",
              // Not hidden and not explained in words: the pots you cannot win
              // are still what the players around you are playing for, and
              // watching the side pot grow is half of watching the hand.
              shutOut && "opacity-45",
            )}
          >
            <span className="w-12 shrink-0 text-right text-[10px] uppercase tracking-wide text-muted-foreground">
              {i === 0 ? "Main" : `Side ${i}`}
            </span>
            <span
              className={cn(
                "font-mono font-bold tabular-nums text-accent",
                i === 0 ? "text-base" : "text-sm",
              )}
            >
              {pot.amount.toLocaleString()}
            </span>
            {shutOut && (
              <span className="sr-only">— you are not playing for this one</span>
            )}
          </div>
        )
      })}
    </div>
  )
}
