"use client"

import { cn } from "@/lib/utils"
import { PlayingCard } from "@/components/playing-card"
import type { GameView } from "@/lib/poker-api"

export function HandResults({ view }: { view: GameView }) {
  if (!view.lastResults.length) return null
  const sorted = [...view.lastResults].sort((a, b) => b.delta - a.delta)
  // Hands are only named when they were actually shown down.
  const shown = sorted.some((r) => r.handName)

  return (
    <div className="mx-auto flex max-h-[38vh] w-full max-w-md flex-col rounded-xl border border-border/60 bg-card/80 p-3">
      <h2 className="mb-2 shrink-0 text-center text-xs font-bold uppercase tracking-widest text-muted-foreground">
        {shown ? "Showdown" : "Hand results"}
      </h2>
      {/* Nine players' showdowns would run under the action bar, so the list
          scrolls inside the panel and the winner stays pinned at the top. */}
      <ul className="flex flex-col gap-1 overflow-y-auto">
        {sorted.map((r) => {
          const won = r.delta > 0
          return (
            <li
              key={r.playerId}
              className={cn(
                "flex flex-col gap-1 rounded-lg px-2 py-1.5",
                won && "bg-primary/10",
              )}
            >
              <div className="flex items-center justify-between text-sm">
                <span className={cn("text-card-foreground", won && "font-semibold")}>
                  {r.name}
                </span>
                <span
                  className={cn(
                    "font-mono font-semibold",
                    r.delta > 0
                      ? "text-accent"
                      : r.delta < 0
                        ? "text-destructive"
                        : "text-muted-foreground",
                  )}
                >
                  {r.delta > 0 ? "+" : ""}
                  {r.delta.toLocaleString()}
                </span>
              </div>

              {/* What they actually held, and the five cards that made it. */}
              {r.handName && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <div className="flex gap-0.5">
                    {r.handCards?.map((card, i) => (
                      <PlayingCard key={i} card={card} size="xs" />
                    ))}
                  </div>
                  <span
                    className={cn(
                      "text-xs",
                      won ? "font-semibold text-primary" : "text-muted-foreground",
                    )}
                  >
                    {r.handName}
                  </span>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
