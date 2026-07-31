"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import type { GameView } from "@/lib/poker-api"

export function ActionBar({
  view,
  onAction,
  busy,
}: {
  view: GameView
  onAction: (action: "fold" | "check" | "call" | "raise", amount?: number) => void
  busy: boolean
}) {
  const legal = view.legal
  const min = legal?.minRaise ?? 0
  const max = legal?.maxRaise ?? 0
  const [raiseTo, setRaiseTo] = useState(min)

  // Reset the raise amount to the minimum whenever it becomes our turn again
  // or the legal range changes (new street / new hand / opponent re-raise).
  useEffect(() => {
    setRaiseTo(min)
  }, [min, max, view.handNumber, view.street])

  if (!view.isYourTurn || !legal) {
    return (
      <div className="flex h-16 items-center justify-center rounded-xl border border-border/60 bg-card/60 text-sm text-muted-foreground">
        {view.phase === "hand" ? "Waiting for other players..." : "Hand not in progress"}
      </div>
    )
  }

  const callAmt = legal.callAmount ?? 0
  const canRaise = legal.canRaise && max > min
  // Only an all-in raise is possible (remaining stack == minimum raise): show a
  // single button instead of a zero-width slider, which the slider can't render.
  const raiseIsAllInOnly = legal.canRaise && max > 0 && max <= min

  // Always clamp to the current legal window before sending. This guards against
  // a stale slider value left over from a previous poll or an off-step drag,
  // which would otherwise be rejected by the engine ("Raise must be between…").
  const clamp = (n: number) => {
    const rounded = Math.round(Number(n))
    if (!Number.isFinite(rounded)) return min
    return Math.min(max, Math.max(min, rounded))
  }
  // Base UI's single-thumb Slider emits a plain number from onValueChange, but
  // multi-thumb emits an array. Normalize both so a bad shape can't produce NaN.
  const readSliderValue = (v: number | readonly number[]) => (Array.isArray(v) ? v[0] : (v as number))
  const sendRaise = (n: number) => onAction("raise", clamp(n))

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-accent/40 bg-card/90 p-3 shadow-lg">
      {canRaise && (
        <div className="flex items-center gap-3">
          <span className="w-14 shrink-0 text-xs text-muted-foreground">Raise to</span>
          <Slider
            value={raiseTo}
            min={min}
            max={max}
            step={1}
            onValueChange={(v) => setRaiseTo(clamp(readSliderValue(v)))}
            className="flex-1"
          />
          <span className="w-16 shrink-0 text-right font-mono text-sm font-bold text-accent">
            {raiseTo.toLocaleString()}
          </span>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {legal.canFold && (
          <Button variant="destructive" disabled={busy} onClick={() => onAction("fold")}>
            Fold
          </Button>
        )}
        {legal.canCheck ? (
          <Button variant="secondary" disabled={busy} onClick={() => onAction("check")}>
            Check
          </Button>
        ) : (
          <Button variant="secondary" disabled={busy} onClick={() => onAction("call")}>
            Call {callAmt.toLocaleString()}
          </Button>
        )}
        {canRaise ? (
          <Button disabled={busy} onClick={() => sendRaise(raiseTo)}>
            {clamp(raiseTo) >= max ? "All-in" : "Raise"}
          </Button>
        ) : raiseIsAllInOnly ? (
          <Button disabled={busy} onClick={() => sendRaise(max)}>
            All-in {max.toLocaleString()}
          </Button>
        ) : (
          <Button disabled>Raise</Button>
        )}
      </div>
    </div>
  )
}
