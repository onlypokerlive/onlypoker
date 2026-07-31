"use client"

import { useState } from "react"
import { UserMinus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { pokerApi, type GameView } from "@/lib/poker-api"

/**
 * The host's one destructive control.
 *
 * Deliberately plain. Removing somebody from a table of friends is a social
 * act, not a game event — the research doc is explicit that it gets no
 * animation and no flourish, because dressing it up turns an awkward moment
 * into a public spectacle. Two taps, a name, and it is done.
 */
export function HostPanel({
  view,
  roomId,
  onDone,
}: {
  view: GameView
  roomId: string
  onDone: () => void
}) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Only the host, and only between hands — the server refuses mid-hand, so
  // offering it there would be a button that exists to fail.
  if (!view.isHost || view.phase === "hand") return null
  const others = view.players.filter((p) => !p.isYou)
  if (!others.length) return null

  async function remove(targetId: string) {
    setBusy(true)
    try {
      await pokerApi.kickPlayer(roomId, view.you!.id, targetId)
      setConfirming(null)
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="rounded-xl border border-border/50 bg-card/50 px-3 py-2">
      <summary className="cursor-pointer text-xs text-muted-foreground">Host controls</summary>
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
    </details>
  )
}
