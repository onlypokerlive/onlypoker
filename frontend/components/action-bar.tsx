"use client"

import { useEffect, useMemo, useState } from "react"
import { Minus, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import { inBigBlinds, presets, sizingContext, snapToPreset } from "@/lib/bet-sizing"
import { useTactile } from "@/lib/use-tactile"
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

  // Every decision button gets it. It is the cheapest guard there is against
  // an irreversible action being tapped twice, because the answer arrives
  // before the network's does.
  const tactile = useTactile()

  const sizing = useMemo(() => sizingContext(view), [view])
  const sizes = useMemo(() => (sizing ? presets(sizing) : []), [sizing])

  if (!view.isYourTurn || !legal) {
    const waiting = waitingMessage(view)
    const countdown =
      view.phase === "hand" && view.actorId && view.actionSeconds > 0 && secondsLeft != null
        ? ` · ${Math.ceil(secondsLeft)}s`
        : ""
    return (
      <div className="flex h-11 items-center justify-center rounded-xl border border-border/60 bg-card/60 text-[13px] text-muted-foreground">
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
  // The step players think in: half a big blind, on every street.
  //
  // It was a whole blind preflop for a while, on the reasoning that opens are
  // counted in whole blinds — you open to three, you three-bet to nine. Which
  // is true of the sizes people *name* and not of the ones they make: two and
  // a half is the standard open, and a stepper that cannot reach it is a
  // stepper you have to drag the slider past. Half a blind reaches every size
  // anybody actually uses and costs one extra tap on the ones it does not.
  //
  // Rounded, because chips are whole things: a half of an odd big blind is not
  // an amount anybody can push forward.
  const step = Math.max(1, Math.round(view.bigBlind / 2))

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

  const clockLabel = timed
    ? urgent
      ? `${autoAction} in ${Math.ceil(secondsLeft!)}s`
      : view.bankRunning
        ? `${Math.ceil(secondsLeft!)}s of bank`
        : `${Math.ceil(secondsLeft!)}s to act`
    : null

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-xl border bg-card/90 shadow-lg transition-colors",
        "gap-[calc(6px*var(--zu,1))] p-[calc(6px*var(--zu,1))]",
        urgent ? "border-destructive/70" : "border-accent/40",
      )}
    >
      {/* The clock, on the bar's own top edge rather than in a row of its own.
          A row cost twenty-four pixels of screen — and every pixel this band
          takes comes off the table above it, where the bottom seat is you. As
          an edge it costs three, and it is *more* legible there, because a bar
          that spans the whole control reads as the control draining rather than
          as a widget that happens to be near it. The seconds keep their words
          and move in beside the amount. */}
      {timed && (
        <div
          className="absolute inset-x-0 top-0 h-[3px] overflow-hidden rounded-t-xl bg-border/60"
          role="progressbar"
          aria-label={view.bankRunning ? "Time bank remaining" : "Action time remaining"}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(timePct)}
        >
          {/* `scaleX`, not `width` — the same way the blind clock's hairline
              drains. A width that eases lays the page out again on every frame
              of every second of every decision; a transform goes straight to
              the compositor and never touches layout. */}
          <div
            className={cn(
              "h-full w-full origin-left transition-transform duration-200 ease-linear",
              urgent ? "bg-destructive" : "bg-primary",
            )}
            style={{ transform: `scaleX(${timePct / 100})` }}
          />
        </div>
      )}

      {canRaise && (
        <div className="flex flex-col gap-[calc(6px*var(--zu,1))]">
          {/* The sizes that cover most bets, so the slider becomes the
              exception rather than the only way through.

              Two or more, though. `presets` always ends the list with All-in,
              so a short stack with nothing else affordable produced a row
              containing one full-width "All-in" button — sitting forty pixels
              above the raise button, which already says All-in the moment the
              slider reaches the top. Thirty-four pixels of table spent saying
              the same thing twice. */}
          {sizes.length > 1 && (
            <div className="grid grid-flow-col auto-cols-fr gap-[calc(6px*var(--zu,1))]">
              {sizes.map((p) => (
                <Button
                  key={p.label}
                  type="button"
                  size="sm"
                  variant={clamp(raiseTo) === p.amount ? "secondary" : "outline"}
                  disabled={busy}
                  onClick={() => setRaiseTo(p.amount)}
                  // These remain the primary sizing controls, so each keeps a
                  // full touch target even though exact sizing is collapsed.
                  className="min-h-11 px-1 text-xs font-semibold tabular-nums"
                  // "Set raise to", not "Raise to": this button moves the
                  // slider, it does not commit chips — and the button that
                  // *does* commit them is three inches below with almost the
                  // same words on it.
                  aria-label={`Set raise to ${p.amount}`}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          )}

          {/* One row, not two: every pixel this bar takes comes off the table
              above it, and on a short phone the bottom seat is the first thing
              to go under it. */}
          <details className="group rounded-lg border border-border/55 bg-background/25 px-2.5">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
              <span className="text-xs font-medium text-muted-foreground">Fine tune</span>
              <span className="flex items-baseline gap-1.5">
                <strong className="font-mono text-sm tabular-nums text-foreground">
                  {clamp(raiseTo).toLocaleString()}
                </strong>
                <span className="font-mono text-[10px] text-accent">
                  {inBigBlinds(clamp(raiseTo), view.bigBlind)}
                </span>
              </span>
            </summary>
            <div className="flex items-center gap-2 border-t border-border/45 py-2.5">
              <Button
                type="button"
                size="icon-lg"
                variant="outline"
                disabled={busy || clamp(raiseTo) <= min}
                onClick={() => setRaiseTo(clamp(raiseTo - step))}
                aria-label={`Lower by ${step}`}
                className="shrink-0"
              >
                <Minus />
              </Button>
              <Slider
                value={raiseTo}
                min={min}
                max={max}
                // A chip, not a blind. The stepper moves in half blinds; this
                // control is for exact stack and all-in amounts.
                step={1}
                onValueChange={(v) =>
                  setRaiseTo(clamp(snapToPreset(readSliderValue(v), sizes, max - min)))
                }
                className="flex-1"
                aria-label="Raise amount"
                aria-valuetext={`${clamp(raiseTo).toLocaleString()} chips · ${inBigBlinds(
                  clamp(raiseTo),
                  view.bigBlind,
                )}`}
              />
              <Button
                type="button"
                size="icon-lg"
                variant="outline"
                disabled={busy || clamp(raiseTo) >= max}
                onClick={() => setRaiseTo(clamp(raiseTo + step))}
                aria-label={`Raise by ${step}`}
                className="shrink-0"
              >
                <Plus />
              </Button>
            </div>
          </details>
        </div>
      )}

      {/* The words, whenever there is a clock at all.
          They used to be held back until the last five seconds, on the argument
          that the draining edge above and the ring round your avatar already
          carried the time. They carry that time is *passing*; neither of them
          says how much is left, and how much is left is the entire question —
          it is the difference between having a moment to think and not. Twelve
          pixels, and the shortest phone supported still adds up.

          The bank is the case that has to be said in words whatever else is on
          screen: a countdown that restarts on its own reads as a glitch. */}
      {timed && (
        // Out of the box, sitting on its own top edge.
        //
        // It was a row, and a row of a control panel is a row of felt: the
        // seventeen pixels it took came off the table, every hand, whether or
        // not anybody was looking at it. Absolutely positioned it costs the
        // layout nothing and reads better — a label on the rim of the thing
        // that is draining, rather than a line of text sitting between the
        // slider and the buttons where the thumb is about to land.
        <div
          role="timer"
          className={cn(
            "pointer-events-none absolute -top-[9px] left-1/2 z-10 -translate-x-1/2 rounded-full border px-2 py-[1px] font-mono text-[11px] font-bold leading-none tabular-nums shadow-sm",
            urgent
              ? "border-destructive/60 bg-destructive/15 text-destructive"
              : "border-border/60 bg-card text-muted-foreground",
          )}
        >
          {clockLabel}
        </div>
      )}

      {/* The amount lives *on* the button, on its own line, so committing chips
          and reading how many are the same glance. It used to be on the slider
          two rows up, which is where nobody looks at the moment they press. */}
      <div className="actions">
        {legal.canFold ? (
          <button
            {...tactile}
            type="button"
            className="tactile act act-fold"
            disabled={busy}
            onClick={() => onAction("fold")}
          >
            Fold
          </button>
        ) : (
          // Kept as an empty cell rather than removed: the three buttons must
          // not change places when folding stops being legal, or the thumb that
          // learned where "raise" is finds "call" there instead.
          <span aria-hidden />
        )}
        {legal.canCheck ? (
          <button
            {...tactile}
            type="button"
            className="tactile act act-call"
            disabled={busy}
            onClick={() => onAction("check")}
          >
            Check
          </button>
        ) : (
          <button
            {...tactile}
            type="button"
            className="tactile act act-call"
            disabled={busy}
            onClick={() => onAction("call")}
          >
            Call
            <small>{callAmt.toLocaleString()}</small>
          </button>
        )}
        {canRaise ? (
          <button
            {...tactile}
            type="button"
            className="tactile act act-raise"
            disabled={busy}
            onClick={() => sendRaise(raiseTo)}
            aria-label={
              clamp(raiseTo) >= max
                ? `Go all in for ${max.toLocaleString()}`
                : `Raise to ${clamp(raiseTo).toLocaleString()}`
            }
          >
            {clamp(raiseTo) >= max ? "All-in" : "Raise to"}
            <small>{clamp(raiseTo).toLocaleString()}</small>
          </button>
        ) : raiseIsAllInOnly ? (
          <button
            {...tactile}
            type="button"
            className="tactile act act-raise"
            disabled={busy}
            onClick={() => sendRaise(max)}
          >
            All-in
            <small>{max.toLocaleString()}</small>
          </button>
        ) : (
          <button type="button" className="act act-raise" disabled>
            Raise
          </button>
        )}
      </div>
    </div>
  )
}
