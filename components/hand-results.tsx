"use client"

import { cn } from "@/lib/utils"
import type { GameView } from "@/lib/poker-api"

export function HandResults({ view }: { view: GameView }) {
  if (!view.lastResults.length) return null
  const sorted = [...view.lastResults].sort((a, b) => b.delta - a.delta)

  return (
    <div className="mx-auto w-full max-w-md rounded-xl border border-border/60 bg-card/80 p-3">
      <h2 className="mb-2 text-center text-xs font-bold uppercase tracking-widest text-muted-foreground">
        Hand results
      </h2>
      <ul className="flex flex-col gap-1">
        {sorted.map((r) => (
          <li key={r.playerId} className="flex items-center justify-between px-2 py-1 text-sm">
            <span className="text-card-foreground">{r.name}</span>
            <span
              className={cn(
                "font-mono font-semibold",
                r.delta > 0 ? "text-accent" : r.delta < 0 ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {r.delta > 0 ? "+" : ""}
              {r.delta.toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
