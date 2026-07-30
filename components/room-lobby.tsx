"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { Copy, Check, Users, Coins } from "lucide-react"
import type { GameView } from "@/lib/poker-api"

export function RoomLobby({
  view,
  onStart,
  busy,
}: {
  view: GameView
  onStart: () => void
  busy: boolean
}) {
  const [copied, setCopied] = useState(false)
  const seated = view.players.length
  const canStart = seated >= 2

  async function copyLink() {
    const url = `${window.location.origin}/join/${view.roomId}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success("Invite link copied")
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("Could not copy link")
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 rounded-2xl border border-border/60 bg-card/80 p-6">
      <div className="flex flex-col gap-1 text-center">
        <h2 className="font-serif text-2xl font-bold text-card-foreground text-balance">{view.roomName}</h2>
        <p className="text-sm text-muted-foreground">Waiting for players to join</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col items-center gap-1 rounded-xl bg-muted/50 p-3">
          <Coins className="size-5 text-accent" aria-hidden />
          <span className="font-mono text-sm font-semibold text-card-foreground">
            {view.smallBlind}/{view.bigBlind}
          </span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Blinds</span>
        </div>
        <div className="flex flex-col items-center gap-1 rounded-xl bg-muted/50 p-3">
          <Users className="size-5 text-accent" aria-hidden />
          <span className="font-mono text-sm font-semibold text-card-foreground">{seated}/9</span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Players</span>
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {view.players.map((p) => (
          <li
            key={p.id}
            className="flex items-center justify-between rounded-lg border border-border/50 bg-background/40 px-3 py-2"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-card-foreground">
              {p.name}
              {p.isHost && (
                <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-accent">
                  Host
                </span>
              )}
              {p.isYou && <span className="text-xs text-muted-foreground">(you)</span>}
            </span>
            <span className="font-mono text-xs text-muted-foreground">{p.chips.toLocaleString()}</span>
          </li>
        ))}
      </ul>

      <Button variant="outline" onClick={copyLink} className="w-full">
        {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
        Copy invite link
      </Button>

      {view.isHost ? (
        <Button onClick={onStart} disabled={!canStart || busy} className="w-full" size="lg">
          {canStart ? "Start game" : "Need at least 2 players"}
        </Button>
      ) : (
        <p className="text-center text-sm text-muted-foreground">Waiting for the host to start the game…</p>
      )}
    </div>
  )
}
