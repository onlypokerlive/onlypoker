"use client"

import { WifiOff } from "lucide-react"

import { cn } from "@/lib/utils"
import { PlayingCard } from "@/components/playing-card"
import type { PlayerView } from "@/lib/poker-api"

const STATUS_CHIP =
  "rounded-full px-1.5 py-px text-[9px] font-bold uppercase leading-tight tracking-wide sm:px-2 sm:py-0.5 sm:text-[10px]"

export function PlayerSeat({
  player,
  showdown,
  revealed = false,
  compact = false,
  secondsLeft = null,
  actionSeconds = 0,
}: {
  player: PlayerView
  showdown: boolean
  /** Whether the viewer is currently holding the peek control. */
  revealed?: boolean
  /**
   * Seven seats or more, where the ring stops having room to spare.
   *
   * The one place the screen wins an argument. Nine seats on a 320px phone put
   * adjacent seats seven pixels closer together than a full-size one is wide,
   * and the ring cannot be opened up because it is already as wide as the
   * cloth. So the seat gives instead — and the cards inside it give with it,
   * because a turned-over hand at full size lands on the neighbour's name.
   *
   * Decided here rather than by the seat measuring its own crowding, because
   * only the table knows how many are at it. See `crowded()` in
   * `lib/table-layout.ts`, which is what the layout test measures against.
   */
  compact?: boolean
  /** Seconds left on the shot clock, when this seat is the one to act. */
  secondsLeft?: number | null
  actionSeconds?: number
}) {
  const isFolded = player.folded
  // Your own hand stays face down unless you're holding the peek control, so a
  // glance from the next chair gives nothing away. A hand that reaches
  // showdown is public information, so it stays up.
  const hideOwnHand = player.isYou && !revealed && !(showdown && !isFolded)
  const cards = hideOwnHand ? null : player.cards
  const showClock =
    player.isActor && actionSeconds > 0 && secondsLeft != null && !showdown
  const clockPct = showClock
    ? Math.min(100, Math.max(0, (secondsLeft! / actionSeconds) * 100))
    : 0
  const urgent = showClock && secondsLeft! <= 5

  return (
    <div
      className={cn(
        // Deliberately small: nine of these have to ring a phone-sized table
        // without burying the felt. Wagered chips live out on the table.
        // The width tracks the viewport so a 320px phone doesn't push the
        // outermost seats off the edge of the table.
        "flex flex-col items-center gap-0.5 rounded-lg border p-1 transition-all sm:w-28 sm:gap-1 sm:rounded-xl sm:p-2",
        compact
          ? "w-[clamp(3.25rem,17vw,3.875rem)]"
          : "w-[clamp(3.75rem,20vw,4.75rem)]",
        player.isActor
          ? "border-accent bg-accent/10 shadow-[0_0_18px_hsl(var(--accent)/0.45)]"
          : "border-border/60 bg-card/90",
        isFolded && "opacity-45",
        player.out && "opacity-40 grayscale",
        !player.connected && !player.out && "border-dashed",
      )}
    >
      {/* Cards. At seven seats and up they are capped smaller — a hand turned
          over at full size on a 375px phone lands on the neighbour's name,
          and the seats are less than thirty pixels apart. This is the one
          point where the screen forces a loss of legibility, and it is
          written down so it is not rediscovered halfway through something. */}
      <div
        className={cn(
          "flex items-center justify-center gap-0.5 sm:h-12 sm:gap-1",
          compact ? "h-7" : "h-8",
        )}
      >
        {cards ? (
          // A null entry is a card its owner kept face down after turning the
          // other one over — showing one card is a move in itself.
          cards.map((c, i) => (
            <PlayingCard
              key={i}
              card={c}
              faceDown={!c}
              size="xs"
              className={cn(
                "sm:h-12 sm:w-9 sm:text-xs",
                compact && "h-6 w-[17px] text-[8px]",
              )}
            />
          ))
        ) : player.cardsCount > 0 ? (
          Array.from({ length: player.cardsCount }).map((_, i) => (
            <PlayingCard
              key={i}
              card={null}
              faceDown
              size="xs"
              className={cn("sm:h-12 sm:w-9", compact && "h-6 w-[17px]")}
            />
          ))
        ) : null}
      </div>

      {/* Name + chips */}
      <div className="flex w-full flex-col items-center">
        <div className="flex w-full items-center justify-center gap-0.5">
          {/* The table needs to know who wandered off, not just who is slow. */}
          {!player.connected && !player.out && (
            <WifiOff
              className="size-2.5 shrink-0 text-muted-foreground"
              aria-label="Disconnected"
            />
          )}
          <span className="truncate text-[11px] font-semibold leading-tight text-card-foreground sm:text-sm">
            {player.name}
          </span>
          {player.isButton && (
            <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-foreground text-[8px] font-bold text-background sm:size-4 sm:text-[9px]">
              D
            </span>
          )}
        </div>
        <span className="font-mono text-[10px] leading-tight text-muted-foreground sm:text-xs">
          {player.chips.toLocaleString()}
        </span>
      </div>

      {/* Position and status */}
      <div className="flex flex-wrap items-center justify-center gap-0.5 empty:hidden">
        {player.isSmallBlind && (
          <span className={cn(STATUS_CHIP, "bg-secondary text-secondary-foreground")}>SB</span>
        )}
        {player.isBigBlind && (
          <span className={cn(STATUS_CHIP, "bg-secondary text-secondary-foreground")}>BB</span>
        )}
        {player.isStraddle && (
          <span className={cn(STATUS_CHIP, "bg-accent text-accent-foreground")}>STR</span>
        )}
        {player.allIn && (
          <span className={cn(STATUS_CHIP, "bg-destructive text-destructive-foreground")}>
            All-in
          </span>
        )}
        {isFolded && <span className={cn(STATUS_CHIP, "bg-muted text-muted-foreground")}>Fold</span>}
        {player.out && <span className={cn(STATUS_CHIP, "bg-muted text-muted-foreground")}>Out</span>}
        {/* Sitting out takes effect from the next hand, so don't label someone
            who is still playing this one. */}
        {player.sittingOut && !player.out && !player.inHand && (
          <span className={cn(STATUS_CHIP, "bg-muted text-muted-foreground")}>Sat out</span>
        )}
        {player.timedOut && !player.out && !player.sittingOut && (
          <span className={cn(STATUS_CHIP, "bg-muted text-muted-foreground")}>Away</span>
        )}
      </div>

      {/* Shot clock for whoever is on the spot */}
      {showClock && (
        <div
          className="h-1 w-full overflow-hidden rounded-full bg-border"
          role="timer"
          aria-label={`${Math.ceil(secondsLeft!)} seconds left to act`}
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-200 ease-linear",
              urgent ? "bg-destructive" : "bg-primary",
            )}
            style={{ width: `${clockPct}%` }}
          />
        </div>
      )}
    </div>
  )
}
