"use client"

import { useState } from "react"
import { ChevronDown, Flag, Settings2, UserMinus } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { pokerApi, type GameView, type Session, type TableControl } from "@/lib/poker-api"

/**
 * The host's controls over the night rather than over a hand.
 *
 * Deliberately plain. Removing somebody from a table of friends is a social
 * act, not a game event — the research doc is explicit that it gets no
 * animation and no flourish, because dressing it up turns an awkward moment
 * into a public spectacle. Two taps, a name, and it is done. Calling the last
 * hand is the same kind of decision, so it lives in the same drawer.
 */
export function HostPanel({
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
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Only the host, and only where the server will accept it: never mid-hand,
  // and never once the placings are written. A button that exists to fail is
  // worse than no button.
  if (!view.isHost || view.phase === "hand" || view.phase === "finished") return null
  const others = view.players.filter((p) => !p.isYou)
  if (view.phase === "lobby" && others.length === 0) return null

  async function remove(targetId: string) {
    setBusy(true)
    try {
      await pokerApi.kickPlayer(roomId, view.you!.id, targetId, session?.token)
      setConfirming(null)
      onDone()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove that player.")
    } finally {
      setBusy(false)
    }
  }

  async function control(action: TableControl) {
    setBusy(true)
    try {
      await pokerApi.controlTable(
        roomId,
        view.you!.id,
        action,
        session?.token,
      )
      onDone()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the table.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="group rounded-xl border border-border/50 bg-card/50 px-3">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <Settings2 className="size-4 text-primary/70" aria-hidden />
          Host controls
        </span>
        <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-border/40 pb-3 pt-1">
      {/* Only once there is a night to end. In the lobby it would just be a
          button that stops a tournament nobody has started. */}
      {view.phase === "handover" && (
        <Button
          size="sm"
          variant={view.lastHand ? "secondary" : "ghost"}
          className="mt-2 w-full justify-start text-muted-foreground"
          disabled={busy}
          onClick={() => control(view.lastHand ? "keep-playing" : "last-hand")}
        >
          <Flag data-icon="inline-start" />
          {view.lastHand ? "Actually, keep playing" : "One more hand, then stop"}
        </Button>
      )}
      <ul className="mt-2 flex flex-col gap-1">
        {others.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate text-card-foreground">{p.name}</span>
            {confirming === p.id ? (
              <span className="flex shrink-0 items-center gap-1">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => remove(p.id)}
                >
                  Remove
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                  Cancel
                </Button>
              </span>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0 text-muted-foreground"
                onClick={() => setConfirming(p.id)}
                aria-label={`Remove ${p.name}`}
              >
                <UserMinus />
              </Button>
            )}
          </li>
        ))}
      </ul>
      </div>
    </details>
  )
}
