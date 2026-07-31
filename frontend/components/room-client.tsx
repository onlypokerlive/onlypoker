"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { PokerTable } from "@/components/poker-table"
import { ActionBar } from "@/components/action-bar"
import { RoomLobby } from "@/components/room-lobby"
import { HandResults } from "@/components/hand-results"
import {
  pokerApi,
  toGameView,
  loadSession,
  clearSession,
  type GameView,
  type Session,
} from "@/lib/poker-api"

const POLL_MS = 1200

export function RoomClient({ roomId }: { roomId: string }) {
  const router = useRouter()
  const [session, setSession] = useState<Session | null>(null)
  const [view, setView] = useState<GameView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pausePollRef = useRef(false)

  // Resolve session from local storage; if absent, send to join page.
  useEffect(() => {
    const s = loadSession(roomId)
    if (!s) {
      router.replace(`/join/${roomId}`)
      return
    }
    setSession(s)
  }, [roomId, router])

  const refresh = useCallback(async () => {
    if (!session || pausePollRef.current) return
    try {
      const raw = await pokerApi.getState(roomId, session.playerId)
      setView(toGameView(raw, session.playerId))
      setError(null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Connection lost"
      setError(msg)
      // If the room is gone, drop the stale session.
      if (msg.toLowerCase().includes("not found")) {
        clearSession(roomId)
        router.replace("/")
      }
    }
  }, [session, roomId, router])

  // Polling loop.
  useEffect(() => {
    if (!session) return
    refresh()
    const id = setInterval(refresh, POLL_MS)
    return () => clearInterval(id)
  }, [session, refresh])

  async function withBusy(fn: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    pausePollRef.current = true
    try {
      await fn()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed")
    } finally {
      pausePollRef.current = false
      setBusy(false)
    }
  }

  const handleStart = () =>
    withBusy(async () => {
      if (!session) return
      const raw = await pokerApi.startHand(roomId, session.playerId)
      setView(toGameView(raw, session.playerId))
    })

  const handleAction = (action: "fold" | "check" | "call" | "raise", amount?: number) =>
    withBusy(async () => {
      if (!session) return
      // The backend treats check and call as a single "call" action.
      const backendAction = action === "check" ? "call" : action
      const raw = await pokerApi.action(roomId, session.playerId, backendAction, amount)
      setView(toGameView(raw, session.playerId))
    })

  if (!view) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-3 text-muted-foreground">
        <Spinner className="size-6" />
        <p>{error ?? "Loading table…"}</p>
      </div>
    )
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-4xl flex-col gap-4 px-3 py-4">
      <header className="flex items-center justify-between gap-2">
        <div className="flex flex-col">
          <h1 className="font-serif text-lg font-bold leading-tight text-foreground">{view.roomName}</h1>
          <span className="text-xs text-muted-foreground">
            Blinds {view.smallBlind}/{view.bigBlind}
            {view.handNumber > 0 && ` · Hand #${view.handNumber}`}
          </span>
        </div>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </header>

      {view.phase === "lobby" ? (
        <div className="flex flex-1 items-center justify-center">
          <RoomLobby view={view} onStart={handleStart} busy={busy} />
        </div>
      ) : (
        <>
          <PokerTable view={view} />

          {view.phase === "handover" && <HandResults view={view} />}

          <div className="mt-auto">
            {view.phase === "handover" && view.isHost ? (
              <Button onClick={handleStart} disabled={busy} size="lg" className="w-full">
                Deal next hand
              </Button>
            ) : view.phase === "handover" ? (
              <div className="flex h-16 items-center justify-center rounded-xl border border-border/60 bg-card/60 text-sm text-muted-foreground">
                Waiting for host to deal the next hand…
              </div>
            ) : (
              <ActionBar view={view} onAction={handleAction} busy={busy} />
            )}
          </div>
        </>
      )}
    </main>
  )
}
