"use client"

import { cn } from "@/lib/utils"
import { PlayingCard } from "@/components/playing-card"
import type { PlayerView } from "@/lib/poker-api"

const STATUS_CHIP = "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"

export function PlayerSeat({
  player,
  showdown,
}: {
  player: PlayerView
  showdown: boolean
}) {
  const cards = player.cards
  const isFolded = player.folded

  return (
    <div
      className={cn(
        "flex w-24 flex-col items-center gap-1 rounded-xl border p-1.5 transition-all sm:w-32 sm:p-2",
        player.isActor
          ? "border-accent bg-accent/10 shadow-[0_0_18px_hsl(var(--accent)/0.45)]"
          : "border-border/60 bg-card/80",
        isFolded && "opacity-45",
      )}
    >
      {/* Cards */}
      <div className="flex h-14 items-center justify-center gap-1">
        {cards ? (
          cards.map((c, i) => <PlayingCard key={i} card={c} size="sm" />)
        ) : player.cardsCount > 0 ? (
          Array.from({ length: player.cardsCount }).map((_, i) => (
            <PlayingCard key={i} card={null} faceDown size="sm" />
          ))
        ) : (
          <div className="h-14" />
        )}
      </div>

      {/* Name + chips */}
      <div className="flex w-full flex-col items-center gap-0.5">
        <div className="flex max-w-full items-center gap-1">
          <span className="truncate text-sm font-semibold text-card-foreground">{player.name}</span>
          {player.isButton && (
            <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-foreground text-[9px] font-bold text-background">
              D
            </span>
          )}
        </div>
        <span className="font-mono text-xs text-muted-foreground">{player.chips.toLocaleString()}</span>
      </div>

      {/* Blinds / bet / status */}
      <div className="flex min-h-5 flex-wrap items-center justify-center gap-1">
        {player.isSmallBlind && <span className={cn(STATUS_CHIP, "bg-secondary text-secondary-foreground")}>SB</span>}
        {player.isBigBlind && <span className={cn(STATUS_CHIP, "bg-secondary text-secondary-foreground")}>BB</span>}
        {player.allIn && <span className={cn(STATUS_CHIP, "bg-destructive text-destructive-foreground")}>All-in</span>}
        {isFolded && <span className={cn(STATUS_CHIP, "bg-muted text-muted-foreground")}>Fold</span>}
      </div>

      {/* Current bet */}
      {player.bet > 0 && (
        <div className="flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5">
          <span className="size-2 rounded-full bg-primary" aria-hidden />
          <span className="font-mono text-xs font-semibold text-primary">{player.bet.toLocaleString()}</span>
        </div>
      )}
    </div>
  )
}
