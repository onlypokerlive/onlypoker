"use client"

import { cn } from "@/lib/utils"
import { PlayingCard } from "@/components/playing-card"
import type { GameView } from "@/lib/poker-api"

export function HandResults({
  view,
  title,
  className,
}: {
  view: GameView
  /** Overridden when this is the hand that ended the tournament. */
  title?: string
  className?: string
}) {
  if (!view.lastResults.length) return null
  const sorted = [...view.lastResults].sort((a, b) => b.delta - a.delta)
  // Hands are only named when they were actually shown down.
  const shown = sorted.some((r) => r.handName)

  return (
    <div
      className={cn(
        "mx-auto flex max-h-[38vh] w-full max-w-md flex-col rounded-xl border border-border/60 bg-card/80 p-3",
        className,
      )}
    >
      <h2 className="mb-2 shrink-0 text-center text-xs font-bold uppercase tracking-widest text-muted-foreground">
        {title ?? (shown ? "Showdown" : "Hand results")}
      </h2>
      {/* Nine players' showdowns would run under the action bar, so the list
          scrolls inside the panel and the winner stays pinned at the top. */}
      {view.sevenDeuceWin && (
        <p className="mb-2 shrink-0 rounded-lg bg-accent/15 px-2 py-1 text-center text-xs font-semibold text-accent">
          {view.sevenDeuceWin.name} took {view.sevenDeuceWin.amount.toLocaleString()} off the
          table with seven-deuce
        </p>
      )}
      {/* Two boards, half the pot each. Which one went to whom is the entire
          point of dealing it twice, and it is the one thing the stacks cannot
          tell you: winning both and chopping both come out the same. */}
      {view.boardResults.length > 1 && (
        <ul className="mb-2 flex shrink-0 flex-col gap-1">
          {view.boardResults.map((b, i) => (
            <li key={i} className="flex items-center justify-between gap-2">
              <span className="flex gap-0.5">
                {b.cards.map((c, j) => (
                  <PlayingCard key={j} card={c} size="xs" />
                ))}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {b.winners.join(" & ")}
              </span>
            </li>
          ))}
        </ul>
      )}
      <ul className="flex flex-col gap-1 overflow-y-auto">
        {sorted.map((r) => {
          const won = r.delta > 0
          // They chose to turn cards over after the fact, so "won without
          // showing" stops being true the moment they do.
          const turnedOver = !!view.players.find((p) => p.id === r.playerId)?.shownIndices
            ?.length
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

              {/* Everyone folded, so the winner never had to show. Say that
                  out loud: an empty space reads like something failed to load,
                  and this is the one line people ask about afterwards. */}
              {!shown && won && !turnedOver && (
                <span className="text-xs italic text-muted-foreground">
                  Won without showing
                </span>
              )}

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
