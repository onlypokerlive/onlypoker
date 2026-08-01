"use client"

import { useState } from "react"

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
  const you = view.you

  // Only while there is a hand you are in and it is somebody else's turn.
  // Planning your own turn is not planning — it is acting, by a second route.
  if (!you || view.phase !== "hand" || !you.inHand || you.folded) return null
  if (view.isYourTurn || view.actorId === you.id) return null

  async function choose(action: PreAction) {
    setBusy(true)
    try {
      await pokerApi.setPreAction(
        roomId,
        you!.id,
        view.preAction === action ? "clear" : action,
        view.handNumber,
        session?.token,
      )
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        {CHOICES.map((c) => (
          <Button
            key={c.id}
            size="sm"
            variant={view.preAction === c.id ? "secondary" : "outline"}
            disabled={busy}
            aria-pressed={view.preAction === c.id}
            onClick={() => choose(c.id)}
            className={cn("flex-1", view.preAction === c.id && "ring-1 ring-accent")}
          >
            {c.label}
          </Button>
        ))}
      </div>
      <span className="text-center text-[11px] text-muted-foreground">
        {/* Saying what it will do beats hoping the label carries it: these fire
            without asking again, which is the point and also the risk. */}
        {CHOICES.find((c) => c.id === view.preAction)?.hint ??
          "Decide now and it plays itself when your turn comes."}
      </span>
    </div>
  )
}
