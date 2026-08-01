"use client"

import { Coffee } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useSecondsLeft } from "@/lib/use-countdown"
import type { GameView, TableControl } from "@/lib/poker-api"

function clock(seconds: number) {
  const whole = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`
}

/**
 * The table is stopped.
 *
 * Loud on purpose, and shown to everybody. A stopped table looks exactly like a
 * broken one — nothing is dealt, the clock is not moving — so the difference
 * has to be on screen or the next five minutes are spent asking whether the app
 * has frozen. The countdown is the whole point: "back in four minutes" is a
 * break, "back at some point" is an outage.
 */
export function TableBreak({
  view,
  onControl,
  busy,
}: {
  view: GameView
  onControl: (action: TableControl) => void
  busy: boolean
}) {
  const left = useSecondsLeft(view.breakEndsAtMs)
  if (!view.paused || view.phase === "finished") return null

  const scheduled = view.breakEndsAtMs != null
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-center">
      <span className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-accent">
        <Coffee className="size-4" aria-hidden />
        {scheduled ? "Break" : "Table stopped"}
      </span>
      <span className="text-2xl font-bold tabular-nums text-foreground">
        {scheduled && left != null ? clock(left) : "Paused"}
      </span>
      <span className="text-xs text-muted-foreground">
        {/* Said out loud because it is the thing players actually worry about
            during a break, and the thing this release exists to fix. */}
        The blinds are not going up while the table is stopped.
      </span>
      {view.isHost && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => onControl("resume")}
        >
          {scheduled ? "Back early" : "Start the table"}
        </Button>
      )}
    </div>
  )
}
