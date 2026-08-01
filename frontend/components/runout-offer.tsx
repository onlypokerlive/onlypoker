"use client"

import { useState } from "react"
import { Layers } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useSecondsLeft } from "@/lib/use-countdown"
import { pokerApi, type GameView, type Session } from "@/lib/poker-api"

/**
 * "Run it twice?"
 *
 * The chips are already in and nobody has a decision left to make about the
 * hand, which is exactly why this needs its own short clock and its own place
 * on screen: the whole table is sitting waiting for cards, and one person
 * wandering off to the kitchen must not hold it up.
 *
 * Everybody still in has to agree, so an unanswered offer and a refusal come
 * to the same thing — which is what makes letting the clock answer safe.
 * Shown to the table too, not only to the players being asked, because
 * otherwise the pause before the cards come out looks like the app hanging.
 */
export function RunoutOffer({
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
  const left = useSecondsLeft(view.runoutEndsAtMs)
  if (!view.runoutSeats.length) return null

  const waiting = view.players
    .filter((p) => view.runoutSeats.includes(p.id))
    .map((p) => p.name)

  async function answer(what: "once" | "twice") {
    setBusy(true)
    try {
      await pokerApi.chooseRunout(
        roomId,
        view.you!.id,
        what,
        view.handNumber,
        session?.token,
      )
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-center">
      <span className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-accent">
        <Layers className="size-4" aria-hidden />
        Run it twice?
      </span>
      {view.askedAboutRunout ? (
        <>
          <span className="text-xs text-muted-foreground">
            {/* The rule, in the one sentence that matters: it is unanimous. */}
            Everybody still in has to agree, or it runs once.
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={busy} onClick={() => answer("twice")}>
              Twice
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => answer("once")}
            >
              Once
            </Button>
          </div>
        </>
      ) : (
        <span className="text-xs text-muted-foreground">
          Waiting for {waiting.join(" and ")}
        </span>
      )}
      {left != null && (
        <span className="text-xs tabular-nums text-muted-foreground" role="timer">
          {Math.max(0, Math.ceil(left))}s
        </span>
      )}
    </div>
  )
}
