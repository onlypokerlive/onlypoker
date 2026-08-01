"use client"

import { useState } from "react"
import { Coins, LogOut } from "lucide-react"

import { Button } from "@/components/ui/button"
import { pokerApi, type GameView, type Session } from "@/lib/poker-api"

/**
 * Coming back, and going home.
 *
 * Both offers live together because they are the same decision seen from two
 * sides of a bust, and because both are only ever true between hands — chips
 * bought while you are in a pot would be written over by the settlement, and a
 * seat cannot be pulled out from under a hand everybody else is still in.
 *
 * Leaving asks first. It is the one control here that cannot be undone: the
 * stack goes home with the player and the tournament carries on without them.
 */
export function BuyChips({
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
  const [confirmingLeave, setConfirmingLeave] = useState(false)
  const you = view.you

  // A spectator has no chips to buy and no seat to leave. The optional chaining
  // is not enough on its own — `!you?.leaving` is true for somebody who is not
  // at the table at all.
  if (!you || view.phase === "finished") return null

  const busted = you.chips <= 0
  const canRebuy = view.rebuyOpen && busted
  const canAddOn = view.rebuyOpen && view.addOn && !busted && !you.addOnTaken
  const canLeave = view.allowLeaving && !you.leaving

  // `you.leaving` on its own is enough to render: somebody who has said
  // goodbye needs to see that it was heard, and hiding the panel the moment
  // the button disappears leaves them wondering whether the tap registered.
  if (!canRebuy && !canAddOn && !canLeave && !you.leaving) return null

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    try {
      await fn()
      setConfirmingLeave(false)
      onDone()
    } finally {
      setBusy(false)
    }
  }

  const buy = (what: "rebuy" | "add-on") =>
    run(() =>
      pokerApi.buyChips(roomId, you!.id, what, view.handNumber, session?.token),
    )

  return (
    <div className="flex flex-col items-center gap-1.5">
      {you.leaving && (
        <span className="text-xs text-muted-foreground">
          You are leaving after this hand.
        </span>
      )}
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {canRebuy && (
          <Button size="sm" disabled={busy} onClick={() => buy("rebuy")}>
            <Coins data-icon="inline-start" />
            Buy back in
          </Button>
        )}
        {canAddOn && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => buy("add-on")}>
            <Coins data-icon="inline-start" />
            Add {view.startingChips.toLocaleString()}
          </Button>
        )}
        {canLeave &&
          (confirmingLeave ? (
            <>
              <Button
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    pokerApi.leaveTable(
                      roomId,
                      you!.id,
                      view.handNumber,
                      session?.token,
                    ),
                  )
                }
              >
                Cash out and go
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmingLeave(false)}>
                Stay
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => setConfirmingLeave(true)}
            >
              <LogOut data-icon="inline-start" />
              Leave the table
            </Button>
          ))}
      </div>
    </div>
  )
}
