"use client"

import { useEffect, useMemo, useState } from "react"
import { Minus, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import { inBigBlinds, presets, sizingContext, snapToPreset } from "@/lib/bet-sizing"
import type { GameView } from "@/lib/poker-api"

/**
 * What the bar says while somebody else is deciding.
 *
 * "Waiting for other players" told you nothing you could act on. Naming who the
 * table is waiting for is the difference between wondering whether the app has
 * frozen and knowing it is Marcos taking his time.
 */
export function waitingMessage(view: GameView): string {
  if (view.phase !== "hand") return "Hand not in progress"
  const actor = view.players.find((p) => p.id === view.actorId)
  // Between streets, and while a hand is being settled, nobody is on the spot.
  if (!actor) return "Dealing…"
  // What the table would say out loud, and the reason their countdown started
  // over — which reads as a glitch if nobody explains it.
  if (view.bankRunning) return `${actor.name} is into their time bank`
  return `${actor.name} is up`
}

export function ActionBar({
  view,
  onAction,
  busy,
  secondsLeft = null,
}: {
  view: GameView
  onAction: (action: "fold" | "check" | "call" | "raise", amount?: number) => void
  busy: boolean
  /** Seconds left on the shot clock — yours, or the player you are waiting on. */
  secondsLeft?: number | null
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

  const sizing = useMemo(() => sizingContext(view), [view])
  const sizes = useMemo(() => (sizing ? presets(sizing) : []), [sizing])

  if (!view.isYourTurn || !legal) {
    const waiting = waitingMessage(view)
    const countdown =
      view.phase === "hand" && view.actorId && view.actionSeconds > 0 && secondsLeft != null
        ? ` · ${Math.ceil(secondsLeft)}s`
        : ""
    return (
      <div className="flex h-16 items-center justify-center rounded-xl border border-border/60 bg-card/60 text-sm text-muted-foreground">
        {waiting}
        {countdown}
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
  // One big blind at a time is the step players think in. It is also the step
  // that stays useful as the blinds climb, which a fixed number of chips isn't.
  const step = Math.max(1, view.bigBlind)

  // Shot clock. Running out is not a penalty when checking is free, so say
  // exactly which action the clock is about to take.
  const timed = view.actionSeconds > 0 && secondsLeft != null
  // Once the bank is open the bar is measuring something else entirely, so it
  // has to be scaled against the bank — otherwise a sixty-second bank on a
  // twenty-second clock draws a bar that is three times full and never moves.
  const window = view.bankRunning
    ? Math.max(1, view.you?.timeBank ?? view.actionSeconds)
    : view.actionSeconds
  const timePct = timed ? Math.min(100, Math.max(0, (secondsLeft! / window) * 100)) : 0
  const urgent = timed && secondsLeft! <= 5
  const autoAction = legal.canCheck ? "Checking" : "Folding"

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-card/90 p-3 shadow-lg transition-colors",
        urgent ? "border-destructive/70" : "border-accent/40",
      )}
    >
      {timed && (
        <div className="flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-200 ease-linear",
                urgent ? "bg-destructive" : "bg-primary",
              )}
              style={{ width: `${timePct}%` }}
            />
          </div>
          <span
            className={cn(
              "w-24 shrink-0 text-right font-mono text-xs tabular-nums",
              urgent ? "font-bold text-destructive" : "text-muted-foreground",
            )}
            role="timer"
          >
            {/* Saying which clock is running matters: a countdown that
                restarts on its own reads as a glitch unless it is named. */}
            {urgent
              ? `${autoAction} in ${Math.ceil(secondsLeft!)}s`
              : view.bankRunning
                ? `${Math.ceil(secondsLeft!)}s of bank`
                : `${Math.ceil(secondsLeft!)}s to act`}
          </span>
        </div>
      )}

      {canRaise && (
        <div className="flex flex-col gap-2">
          {/* The sizes that cover most bets, so the slider becomes the
              exception rather than the only way through. */}
          {sizes.length > 0 && (
            <div className="grid grid-flow-col auto-cols-fr gap-1.5">
              {sizes.map((p) => (
                <Button
                  key={p.label}
                  type="button"
                  size="sm"
                  variant={clamp(raiseTo) === p.amount ? "secondary" : "outline"}
                  disabled={busy}
                  onClick={() => setRaiseTo(p.amount)}
                  className="px-1 text-xs font-semibold tabular-nums"
                  aria-label={`Raise to ${p.amount}`}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          )}

          {/* One row, not two: every pixel this bar takes comes off the table
              above it, and on a short phone the bottom seat is the first thing
              to go under it. */}
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="icon"
              variant="outline"
              disabled={busy || clamp(raiseTo) <= min}
              onClick={() => setRaiseTo(clamp(raiseTo - step))}
              aria-label={`Lower by ${step}`}
              className="size-9 shrink-0"
            >
              <Minus />
            </Button>
            <Slider
              value={raiseTo}
              min={min}
              max={max}
              step={1}
              onValueChange={(v) =>
                setRaiseTo(clamp(snapToPreset(readSliderValue(v), sizes, max - min)))
              }
              className="flex-1"
              aria-label="Raise amount"
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              disabled={busy || clamp(raiseTo) >= max}
              onClick={() => setRaiseTo(clamp(raiseTo + step))}
              aria-label={`Raise by ${step}`}
              className="size-9 shrink-0"
            >
              <Plus />
            </Button>
            {/* Chips are the number the engine takes; big blinds are the number
                players compare against. Both, or half the table is doing the
                division in their head — and both bright, because this is read
                at a glance in a dim room. */}
            <span className="flex w-16 shrink-0 flex-col items-end leading-tight">
              <span className="font-mono text-sm font-bold tabular-nums text-foreground">
                {clamp(raiseTo).toLocaleString()}
              </span>
              <span className="font-mono text-[10px] text-accent">
                {inBigBlinds(clamp(raiseTo), view.bigBlind)}
              </span>
            </span>
          </div>
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
