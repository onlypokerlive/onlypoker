"use client"

import { useEffect, useRef, useState } from "react"
import { X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { pokerApi, type GameView, type PreAction, type Session } from "@/lib/poker-api"

/**
 * Deciding before your turn comes round.
 *
 * The single biggest thing that can be done for the pace of a hand: most
 * decisions in poker are already made by the time the action arrives, and the
 * seconds spent waiting for somebody to tap what they had decided a minute ago
 * are the ones a phone game can simply not spend.
 *
 * What is offered is the careful part. Nothing here names an amount — "call
 * 100" would have to be taken back the instant somebody raises to 300, and
 * getting that wrong pays a price the player never agreed to. All three are
 * defined against whatever the situation turns out to be, so there is nothing
 * to go stale.
 *
 * They are private. A table that could see who had already folded in advance
 * would be playing a different game.
 */
const CHOICES: { id: PreAction; label: string; hint: string }[] = [
  { id: "check", label: "Check", hint: "If it is free. If somebody bets, ask me." },
  { id: "check-fold", label: "Check / fold", hint: "Free card if there is one, otherwise I am out." },
  { id: "call-any", label: "Call any", hint: "Whatever it costs." },
]

export function PreActions({
  view,
  roomId,
  onDone,
  session,
}: {
  view: GameView
  roomId: string
  onDone: () => void
  session: Session | null
}) {
  const [busy, setBusy] = useState(false)
  /**
   * What was just tapped, before the server has said so.
   *
   * The row used to be drawn straight from `view.preAction`, which arrives on
   * the next poll — so tapping "Check / fold" did nothing visible for up to a
   * second and a bit. On a control whose whole job is to commit you to folding
   * a hand you have not seen the action on, a second of *looking like it did
   * not register* is the difference between a plan and a plan you no longer
   * trust — and the natural response is to tap it again, which is the gesture
   * that cancels it.
   */
  const [pending, setPending] = useState<PreAction | null | undefined>(undefined)
  const settled = useRef<PreAction | null>(view.preAction ?? null)
  const you = view.you

  // The server has caught up: stop guessing. Compared against the last value we
  // *saw* rather than against `pending`, so a change made from somewhere else —
  // the plan being spent when the turn came round — still clears it.
  useEffect(() => {
    const now = view.preAction ?? null
    if (now !== settled.current) {
      settled.current = now
      setPending(undefined)
    }
  }, [view.preAction])

  const chosen = pending !== undefined ? pending : (view.preAction ?? null)

  // Only while there is a hand you are in and it is somebody else's turn.
  // Planning your own turn is not planning — it is acting, by a second route.
  if (!you || view.phase !== "hand" || !you.inHand || you.folded) return null
  if (view.isYourTurn || view.actorId === you.id) return null
  // And only while a turn is actually coming. All-in there are no decisions
  // left to plan, and between streets nobody is on the spot — offering to
  // pre-fold a hand that is already dealing itself out is offering nonsense.
  if (!view.actorId || you.chips <= 0) return null

  async function choose(action: PreAction) {
    // Cancelling is tapping the same one again, and it is the reason this is a
    // set of toggles rather than a set of buttons: a plan made three players
    // ago is a plan you are allowed to change your mind about, right up until
    // the action reaches you.
    const next = chosen === action ? null : action
    setPending(next)
    setBusy(true)
    try {
      await pokerApi.setPreAction(
        roomId,
        you!.id,
        next ?? "clear",
        view.handNumber,
        session?.token,
      )
      onDone()
    } catch (e) {
      // It did not take. Showing it as chosen would be the worst outcome this
      // control has: a fold somebody believes is armed and is not, or believes
      // is cancelled and is not. Said out loud as well as drawn — a button that
      // silently springs back is a button somebody presses again.
      setPending(undefined)
      toast.error(e instanceof Error ? e.message : "That plan did not stick.")
    } finally {
      setBusy(false)
    }
  }

  const picked = CHOICES.find((c) => c.id === chosen)

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        {CHOICES.map((c) => {
          const on = chosen === c.id
          return (
            <Button
              key={c.id}
              size="sm"
              // Filled, not outlined-with-a-ring. A ring on an outline button
              // is the difference between two greys, and this is the one
              // control on the screen that acts on your behalf without asking
              // again — it has to be obvious across a room which one is armed.
              variant={on ? "default" : "outline"}
              disabled={busy}
              aria-pressed={on}
              onClick={() => choose(c.id)}
              className={cn("flex-1 gap-1", on && "font-bold")}
            >
              {/* The way out, drawn on the thing it undoes. Tapping the button
                  again is what cancels; nobody guesses that from a button that
                  merely looks pressed. */}
              {on && <X className="size-3" aria-hidden />}
              {c.label}
            </Button>
          )
        })}
      </div>
      <span
        className={cn(
          "text-center text-[11px]",
          picked ? "font-medium text-accent" : "text-muted-foreground",
        )}
      >
        {/* Saying what it will do beats hoping the label carries it: these fire
            without asking again, which is the point and also the risk. */}
        {picked ? `${picked.hint} Tap again to cancel.` : "Decide now and it plays itself when your turn comes."}
      </span>
    </div>
  )
}
