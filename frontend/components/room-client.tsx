"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Pause, Play, Volume2, VolumeX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { PokerTable } from "@/components/poker-table"
import { ActionBar } from "@/components/action-bar"
import { BlindClock } from "@/components/blind-clock"
import { HoleCards } from "@/components/hole-cards"
import { RoomLobby } from "@/components/room-lobby"
import { HandResults } from "@/components/hand-results"
import { RabbitHunt } from "@/components/rabbit-hunt"
import { ShowCards } from "@/components/show-cards"
import { HelpSheet } from "@/components/help-sheet"
import { HostPanel } from "@/components/host-panel"
import { TableBreak } from "@/components/table-break"
import { TournamentResults } from "@/components/tournament-results"
import { useSecondsLeft } from "@/lib/use-countdown"
import { useTableEvents } from "@/lib/use-table-events"
import { useRunout } from "@/lib/use-runout"
import {
  ApiError,
  pokerApi,
  toGameView,
  loadSession,
  clearSession,
  type GameView,
  type Session,
  type TableControl,
} from "@/lib/poker-api"

const POLL_MS = 1200

export function RoomClient({ roomId }: { roomId: string }) {
  const router = useRouter()
  const [session, setSession] = useState<Session | null>(null)
  const [view, setView] = useState<GameView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [revealed, setRevealed] = useState(false)
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
      const raw = await pokerApi.getState(roomId, session.playerId, session.token)
      setView(toGameView(raw, session.playerId))
      setError(null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Connection lost"
      setError(msg)
      // A refusal is not a hiccup. The room is gone, or this device is holding
      // a credential the table no longer accepts — removed by the host, or
      // saved before the server started asking for one. Retrying that every
      // 1.2 seconds shows a spinner forever; the way out is the front door.
      if (e instanceof ApiError && e.isAuthFailure) {
        clearSession(roomId)
        router.replace(e.status === 404 ? "/" : `/join/${roomId}`)
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

  const handNumber = view?.handNumber
  const phase = view?.phase
  // A new deal means new cards: never carry a reveal across hands. The phase
  // matters as much as the number — the hand ends first, and up to a full
  // handover would pass with the cards still up if we only watched the deal.
  useEffect(() => setRevealed(false), [handNumber, phase])

  // Put the cards away the moment the app is no longer in front of the player —
  // switching apps or locking the phone should not leave a hand on screen.
  useEffect(() => {
    const hide = () => setRevealed(false)
    window.addEventListener("blur", hide)
    document.addEventListener("visibilitychange", hide)
    return () => {
      window.removeEventListener("blur", hide)
      document.removeEventListener("visibilitychange", hide)
    }
  }, [])

  const secondsLeft = useSecondsLeft(view?.actionDeadlineMs ?? null)
  const autoDealIn = useSecondsLeft(view?.autoDealAtMs ?? null)
  const { soundOn, setSoundOn } = useTableEvents(view)
  // An all-in arrives as a finished board in one response. Deal it out.
  const { board: shownBoard, revealing } = useRunout(view)

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
      const raw = await pokerApi.startHand(roomId, session.playerId, session.token)
      setView(toGameView(raw, session.playerId))
    })

  const handleAction = (action: "fold" | "check" | "call" | "raise", amount?: number) =>
    withBusy(async () => {
      if (!session || !view) return
      // The backend treats check and call as a single "call" action.
      const backendAction = action === "check" ? "call" : action
      const raw = await pokerApi.action(
        roomId,
        session.playerId,
        backendAction,
        amount,
        view.handNumber,
        view.turnId,
        session.token,
      )
      setView(toGameView(raw, session.playerId))
    })

  const handleSitToggle = () =>
    withBusy(async () => {
      if (!session || !view) return
      const raw = await pokerApi.toggleSitOut(
        roomId,
        session.playerId,
        !view.you?.sittingOut,
        view.handNumber,
        session.token,
      )
      setView(toGameView(raw, session.playerId))
    })

  const handleTableControl = (action: TableControl) =>
    withBusy(async () => {
      if (!session || !view) return
      const raw = await pokerApi.controlTable(
        roomId,
        session.playerId,
        action,
        view.handNumber,
        session.token,
      )
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

  const you = view.you
  const finished = view.phase === "finished"
  // No seat at this table. Everything below that belongs to a player — your
  // hand, sitting out, acting — has to be gated on this and not on optional
  // chaining: `!you?.sittingOut` is *true* for a spectator, which is how you
  // end up offering a chair to somebody who does not have one.
  const spectating = !you

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-4xl flex-col gap-4 px-3 py-4">
      <header className="flex items-start justify-between gap-2">
        <div className="flex flex-col">
          <h1 className="font-serif text-lg font-bold leading-tight text-foreground">{view.roomName}</h1>
          <span className="text-xs text-muted-foreground">
            {view.handNumber > 0 ? `Hand #${view.handNumber}` : "Not started"}
            {/* Everybody is told, not just the host: knowing it is the last
                hand changes how it gets played. */}
            {view.lastHand && !finished && (
              <span className="ml-2 font-bold text-accent">LAST HAND</span>
            )}
            {/* A hand nobody chose to play needs saying, or the missing
                preflop reads as the app having skipped a turn. */}
            {view.bombPot && <span className="ml-2 font-bold text-accent">BOMB POT</span>}
            {view.ante > 0 && !view.bombPot && (
              <span className="ml-2">ante {view.ante.toLocaleString()}</span>
            )}
            {error && <span className="ml-2 text-destructive">{error}</span>}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <HelpSheet />
          {/* On the table, not buried in settings: this gets used with other
              people in the room, and the person who needs it needs it now. */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSoundOn(!soundOn)}
            aria-pressed={soundOn}
            aria-label={soundOn ? "Mute the table" : "Unmute the table"}
            className="text-muted-foreground"
          >
            {soundOn ? <Volume2 /> : <VolumeX />}
          </Button>
          {!finished && <BlindClock view={view} />}
        </div>
      </header>

      {view.phase === "lobby" ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex w-full max-w-md flex-col gap-3">
            <RoomLobby view={view} onStart={handleStart} busy={busy} />
            {/* The moment you actually need this is before the cards come out:
                somebody joined the wrong table, or took the last seat. */}
            <HostPanel view={view} roomId={roomId} onDone={refresh} session={session} />
          </div>
        </div>
      ) : finished ? (
        // The hand that ends a tournament is the one everybody talks about, and
        // it used to be the only one nobody ever saw: the podium replaced it
        // outright. Show what won before who won.
        <div className="flex flex-1 flex-col items-center justify-center gap-3 overflow-y-auto py-2">
          <HandResults view={view} title="The final hand" className="shrink-0" />
          <TournamentResults view={view} />
        </div>
      ) : (
        <>
          {/* Above the table, because a stopped table looks exactly like a
              broken one and the difference has to be the first thing read. */}
          <TableBreak view={view} onControl={handleTableControl} busy={busy} />
          <PokerTable
            view={{ ...view, board: shownBoard }}
            revealed={revealed}
            secondsLeft={secondsLeft}
          />

          {/* Held back while the board is still coming out: the panel names the
              winner, and reading it before the river lands gives the ending
              away. */}
          {view.phase === "handover" && !revealing && (
            <div className="flex flex-col gap-2">
              <HandResults view={view} />
              <ShowCards view={view} roomId={roomId} onShown={refresh} session={session} />
              <HostPanel view={view} roomId={roomId} onDone={refresh} session={session} />
              <RabbitHunt
                roomId={roomId}
                handNumber={view.handNumber}
                boardLength={view.board.length}
                session={session}
              />
            </div>
          )}

          {/* Pinned to the bottom: on a short phone the table scrolls, but the
              buttons must stay reachable while the shot clock runs. */}
          <div className="sticky bottom-0 z-20 mt-auto -mx-3 flex flex-col gap-2 border-t border-border/40 bg-background/90 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur">
            {spectating ? (
              // Say it plainly. Somebody who is watching and does not know it
              // spends the night waiting for cards that are never coming.
              <div className="flex h-12 items-center justify-center rounded-xl border border-dashed border-border/60 text-sm text-muted-foreground">
                You are watching this table
              </div>
            ) : (
              view.phase === "hand" && (
                <HoleCards
                  cards={you?.cards ?? null}
                  revealed={revealed}
                  onRevealChange={setRevealed}
                  folded={you?.folded}
                />
              )
            )}

            {/* Sat out by the clock, you are no longer dealt in — so the way
                back has to be visible whatever the table is doing. */}
            {you?.sittingOut && !you.out && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2">
                <span className="text-sm text-foreground">
                  {you.autoSatOut
                    ? "You were sat out after missing your turn."
                    : you.inHand
                      ? "You sit out from the next hand."
                      : "You are sitting out."}
                </span>
                <Button size="sm" onClick={handleSitToggle} disabled={busy}>
                  Sit back in
                </Button>
              </div>
            )}

            {view.phase === "handover" ? (
              <>
                {view.isHost ? (
                  <div className="flex gap-2">
                    <Button
                      onClick={handleStart}
                      disabled={busy}
                      size="lg"
                      className="flex-1"
                    >
                      {autoDealIn != null && !view.paused
                        ? `Deal now · ${Math.ceil(autoDealIn)}s`
                        : "Deal next hand"}
                    </Button>
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={() => handleTableControl(view.paused ? "resume" : "pause")}
                      disabled={busy}
                      aria-label={view.paused ? "Start the table again" : "Stop the table"}
                    >
                      {view.paused ? <Play /> : <Pause />}
                    </Button>
                  </div>
                ) : (
                  <div className="flex h-16 items-center justify-center rounded-xl border border-border/60 bg-card/60 text-sm text-muted-foreground">
                    {view.paused
                      ? "The host stopped the table…"
                      : autoDealIn != null
                        ? `Next hand in ${Math.ceil(autoDealIn)}s`
                        : "Dealing the next hand…"}
                  </div>
                )}
                {!spectating && !you?.sittingOut && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleSitToggle}
                    // Heads-up there is nobody left to play, so the server
                    // refuses. Say so on the button instead of on an error.
                    disabled={busy || you?.canSitOut === false}
                    title={
                      you?.canSitOut === false
                        ? "The table needs at least two players to keep dealing."
                        : undefined
                    }
                    className="self-center text-muted-foreground"
                  >
                    Sit out next hand
                  </Button>
                )}
              </>
            ) : (
              <ActionBar
                view={view}
                onAction={handleAction}
                busy={busy}
                // Passed whoever is on the clock, not just you: knowing the
                // player you are waiting on has seven seconds left is the
                // difference between waiting and wondering.
                secondsLeft={secondsLeft}
              />
            )}
          </div>
        </>
      )}
    </main>
  )
}
