"use client"

import { cn } from "@/lib/utils"
import { PlayingCard } from "@/components/playing-card"
import { PlayerSeat } from "@/components/player-seat"
import type { GameView } from "@/lib/poker-api"

// Seat positions around an oval, indexed by number of seats.
// Values are percentage-based [top, left] anchor points.
const LAYOUTS: Record<number, Array<{ top: string; left: string }>> = {
  1: [{ top: "88%", left: "50%" }],
  2: [
    { top: "88%", left: "50%" },
    { top: "8%", left: "50%" },
  ],
  3: [
    { top: "88%", left: "50%" },
    { top: "12%", left: "22%" },
    { top: "12%", left: "78%" },
  ],
  4: [
    { top: "88%", left: "50%" },
    { top: "46%", left: "9%" },
    { top: "8%", left: "50%" },
    { top: "46%", left: "91%" },
  ],
  5: [
    { top: "88%", left: "50%" },
    { top: "55%", left: "8%" },
    { top: "12%", left: "28%" },
    { top: "12%", left: "72%" },
    { top: "55%", left: "92%" },
  ],
  6: [
    { top: "82%", left: "50%" },
    { top: "68%", left: "10%" },
    { top: "18%", left: "14%" },
    { top: "10%", left: "50%" },
    { top: "18%", left: "86%" },
    { top: "68%", left: "90%" },
  ],
  7: [
    { top: "82%", left: "50%" },
    { top: "72%", left: "10%" },
    { top: "30%", left: "6%" },
    { top: "10%", left: "34%" },
    { top: "10%", left: "66%" },
    { top: "30%", left: "94%" },
    { top: "72%", left: "90%" },
  ],
  8: [
    { top: "84%", left: "50%" },
    { top: "78%", left: "12%" },
    { top: "40%", left: "5%" },
    { top: "10%", left: "26%" },
    { top: "8%", left: "50%" },
    { top: "10%", left: "74%" },
    { top: "40%", left: "95%" },
    { top: "78%", left: "88%" },
  ],
  9: [
    { top: "84%", left: "50%" },
    { top: "80%", left: "16%" },
    { top: "50%", left: "5%" },
    { top: "18%", left: "12%" },
    { top: "8%", left: "38%" },
    { top: "8%", left: "62%" },
    { top: "18%", left: "88%" },
    { top: "50%", left: "95%" },
    { top: "80%", left: "84%" },
  ],
}

export function PokerTable({ view }: { view: GameView }) {
  // Reorder players so that "you" is always at the bottom (index 0 of layout).
  const players = view.players
  const youIdx = players.findIndex((p) => p.isYou)
  const ordered =
    youIdx >= 0 ? [...players.slice(youIdx), ...players.slice(0, youIdx)] : players
  const layout = LAYOUTS[Math.min(ordered.length, 9)] ?? LAYOUTS[9]
  const showdown = view.phase === "handover"

  return (
    <div className="relative mx-auto aspect-[3/4] w-full max-w-sm sm:aspect-[3/2] sm:max-w-3xl">
      {/* Felt */}
      <div className="absolute inset-4 rounded-[45%] border-8 border-[#4a2c17] bg-[radial-gradient(ellipse_at_center,hsl(150_45%_22%),hsl(150_50%_14%))] shadow-[inset_0_0_60px_rgba(0,0,0,0.6)]">
        <div className="absolute inset-6 rounded-[45%] border border-accent/20" />
      </div>

      {/* Center: pot + board. Anchored slightly above the middle so the board
          never collides with the bottom ("you") seat on tall mobile ovals. */}
      <div className="absolute left-1/2 top-[42%] flex w-full -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2 px-2">
        <div className="rounded-full bg-background/70 px-4 py-1 text-center backdrop-blur">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Pot</span>
          <div className="font-mono text-lg font-bold text-accent">{view.pot.toLocaleString()}</div>
        </div>
        <div className="flex min-h-[3rem] flex-wrap items-center justify-center gap-1">
          {view.board.length > 0 ? (
            view.board.map((c, i) => <PlayingCard key={i} card={c} size="sm" />)
          ) : (
            <span className="text-xs text-muted-foreground/70">
              {view.phase === "hand" ? "Community cards" : "Waiting for next hand"}
            </span>
          )}
        </div>
        {view.message && (
          <div className="max-w-[16rem] text-balance rounded-lg bg-background/80 px-3 py-1 text-center text-xs text-foreground backdrop-blur">
            {view.message}
          </div>
        )}
      </div>

      {/* Seats */}
      {ordered.map((p, i) => {
        const pos = layout[i]
        if (!pos) return null
        return (
          <div
            key={p.id}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ top: pos.top, left: pos.left }}
          >
            <PlayerSeat player={p} showdown={showdown} />
          </div>
        )
      })}
    </div>
  )
}
