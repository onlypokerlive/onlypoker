"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Pause, Play, Volume1, Volume2, VolumeX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { PokerTable } from "@/components/poker-table"
import { ActionBar } from "@/components/action-bar"
import { BlindClock } from "@/components/blind-clock"
import { HoleCards } from "@/components/hole-cards"
import { RoomLobby } from "@/components/room-lobby"
import { HandResults } from "@/components/hand-results"
import { HandSummarySheet } from "@/components/hand-summary-sheet"
import { RabbitHunt } from "@/components/rabbit-hunt"
import { ShowCards } from "@/components/show-cards"
import { HelpSheet } from "@/components/help-sheet"
import { ChatSheet } from "@/components/chat-sheet"
import { HostPanel } from "@/components/host-panel"
import { TableBreak } from "@/components/table-break"
import { BuyChips } from "@/components/buy-chips"
import { PreActions } from "@/components/pre-actions"
import { RunoutOffer } from "@/components/runout-offer"
import { PlayAgain, TournamentResults } from "@/components/tournament-results"
import { HistoryRecorder } from "@/components/history-recorder"
import { InviteShareButton } from "@/components/invite-share-button"
import { useSecondsLeft } from "@/lib/use-countdown"
import { tableIsAudible, useTableEvents, type SoundMode } from "@/lib/use-table-events"
import { useShotClockWarning } from "@/lib/use-shot-clock-warning"
import { useDoubleTap } from "@/lib/use-double-tap"
import { baizeOf, deckOf } from "@/lib/table-style"
import { ownZoneHeight, zoneScale } from "@/lib/table-layout"
import { useViewportHeight } from "@/lib/use-viewport-height"
import { playCue } from "@/lib/sound"
import { useRunout } from "@/lib/use-runout"
import { cardsSide, useHandedness } from "@/lib/handedness"
import { useOverSilence } from "@/lib/over-silence"
import { handoverState } from "@/lib/handover"
import {
  failureCategory,
  recordActionRejected,
  recordGameStartAttempt,
  recordGameStartFailed,
  recordGameStarted,
  recordRoomSessionMissing,
  recordTournamentFinished,
} from "@/lib/growth"
import {
  ApiError,
  pokerApi,
  toGameView,
  loadSession,
  saveSession,
  clearSession,
  type GameView,
  type Session,
  type TableControl,
} from "@/lib/poker-api"

const POLL_MS = 1200

// The order the switch walks, and what each stop is called out loud. Everything
// → only my turn → nothing, which is the order somebody turns it down in.
const SOUND_NEXT: Record<SoundMode, SoundMode> = { all: "turn", turn: "off", off: "all" }
const SOUND_LABEL: Record<SoundMode, string> = {
  all: "everything",
  turn: "only my turn",
  off: "off",
}

export function RoomClient({ roomId }: { roomId: string }) {
  const router = useRouter()
  const [session, setSession] = useState<Session | null>(null)
  const [view, setView] = useState<GameView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const pausePollRef = useRef(false)
  // Which poll was sent, and which one's answer is on screen. Two numbers and
  // not one: a request has to be stamped before it is sent to be recognised as
  // stale when it comes back.
  const pollRef = useRef(0)
  const answeredRef = useRef(0)
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null)
  const savedHostStateRef = useRef<boolean | null>(null)

  // Resolve session from local storage; if absent, send to join page.
  useEffect(() => {
    const s = loadSession(roomId)
    if (!s) {
      recordRoomSessionMissing()
      router.replace(`/join/${roomId}`)
      return
    }
    savedHostStateRef.current = s.isHost
    setSession(s)
  }, [roomId, router])

  const refresh = useCallback(async () => {
    if (!session || pausePollRef.current) return
    // Every poll takes a number, and only a newer answer than the one already
    // on screen is allowed to replace it. Without this a slow response lands
    // after a faster one that was sent later and the table jumps *backwards* —
    // which reads as a glitch, and quietly replays the moments in between the
    // next time round, because "what has this client already seen" is measured
    // against whatever view it is holding.
    const ticket = ++pollRef.current
    try {
      const raw = await pokerApi.getState(roomId, session.playerId, session.token)
      if (ticket < answeredRef.current) return
      answeredRef.current = ticket
      setView(toGameView(raw, session.playerId))
      setError(null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Connection lost"
      setError(msg)
      // A refusal is not a hiccup. The room is gone, or this device is holding
      // a credential the table no longer accepts — saved before the server
      // started asking for one, or belonging to a seat that has closed.
      // Retrying that every 1.2 seconds shows a spinner forever; the way out is
      // the front door.
      //
      // Being removed by the host is the one case where the credential stays.
      // It is the only thing that tells this device from a stranger's at that
      // door, and throwing it away is what would turn "you were removed" into
      // "welcome back" one tap later.
      if (e instanceof ApiError && (e.isAuthFailure || e.isRemoved)) {
        if (!e.isRemoved) clearSession(roomId)
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

  // How tall this screen is, and therefore how big your own controls are drawn
  // on it. Published to the CSS as `--zu` so a button's height, the gap above
  // it and the height of the whole zone all come off one number — see
  // `zoneScale`, which is the same idea as `tableScale` one row up.
  const viewportH = useViewportHeight()
  const zu = zoneScale(viewportH)

  const secondsLeft = useSecondsLeft(view?.actionDeadlineMs ?? null)
  const autoDealIn = useSecondsLeft(view?.autoDealAtMs ?? null)
  // Whether this phone talks over its own silent switch. Read before the table
  // events, because it is what the audio channel is claimed with.
  const { overSilence, setOverSilence } = useOverSilence()
  const { soundMode, setSoundMode } = useTableEvents(view, overSilence)
  // Which hand is holding the phone, and therefore which side of the peek band
  // the cards go on — the side the thumb is not coming from.
  const { handed, setHanded } = useHandedness()
  // Yours only. Nine countdowns ticking at once is not a warning, and whose
  // clock is nearly out is theirs to give away rather than ours to broadcast.
  useShotClockWarning({
    active: !!view?.isYourTurn && (view?.actionSeconds ?? 0) > 0,
    secondsLeft,
    audible: soundMode !== "off",
  })
  // An all-in arrives as a finished board in one response. Deal it out.
  const {
    board: shownBoard,
    boards: shownBoards,
    revealing,
    boardCompleteMs,
  } = useRunout(view)

  // Host authority can move without an account. Keep this device's persisted
  // session aligned with the server while never restoring an invalidated
  // recovery backup after a deliberate handoff.
  useEffect(() => {
    if (!session || !view || savedHostStateRef.current === view.isHost) return
    const latest = loadSession(roomId) ?? session
    const nextSession = view.isHost
      ? { ...latest, isHost: true }
      : {
          roomId: latest.roomId,
          playerId: latest.playerId,
          token: latest.token,
          isHost: false,
          spectator: latest.spectator,
        }
    saveSession(nextSession)
    savedHostStateRef.current = view.isHost
  }, [roomId, session, view])

  useEffect(() => {
    if (phase !== "finished") return
    window.scrollTo({ top: 0, behavior: "auto" })
    window.requestAnimationFrame(() => resultsHeadingRef.current?.focus())
  }, [phase])

  useEffect(() => {
    if (view?.phase !== "finished") return
    recordTournamentFinished(
      view.roomId,
      view.tournamentNumber,
      view.standings.length || view.players.length,
      view.handNumber,
      view.isHost,
    )
  }, [
    view?.phase,
    view?.roomId,
    view?.tournamentNumber,
    view?.standings.length,
    view?.players.length,
    view?.handNumber,
    view?.isHost,
  ])

  // Rapping the table is what checking *is*, so it is the gesture and not a
  // button. The whole felt, not a target: at a real table you knock wherever
  // your hand happens to be.
  const canCheckNow = !!view?.isYourTurn && !!view?.legal?.canCheck && !busy
  const { refused, ...feltTap } = useDoubleTap({
    enabled: canCheckNow,
    onDoubleTap: () => handleAction("check"),
  })
  // A gesture that silently does nothing is indistinguishable from one the app
  // never received — so the player taps harder, and then stops trusting it.
  useEffect(() => {
    if (!refused) return
    if (soundMode !== "off") playCue("error")
    // One notice, however many times it is asked for. A player whose tap did
    // nothing taps again — that is the whole reason this exists — and without
    // an id the second and third taps stacked three copies of the same
    // sentence over the table. Saying it louder is not saying it better.
    toast("Double-tap checks — on your turn, when checking is free.", {
      id: "double-tap",
    })
  }, [refused, soundMode])

  /**
   * Put a view on screen that came from an action rather than from a poll.
   *
   * It is newer than anything in flight by construction — the server has just
   * applied the decision — so it takes the next ticket, and any poll still on
   * its way back is discarded when it lands.
   */
  const showFresh = useCallback(
    (next: GameView) => {
      answeredRef.current = ++pollRef.current
      setView(next)
    },
    [],
  )

  async function withBusy(
    fn: () => Promise<void>,
    onError?: (error: unknown) => void,
  ) {
    if (busy) return
    setBusy(true)
    pausePollRef.current = true
    try {
      await fn()
    } catch (e) {
      onError?.(e)
      // Said as well as shown. Everything this device asks for and is refused
      // sounds the same, and it is the one cue that is unambiguously about
      // *you*: the double-tap that was not your turn already plays it, and a
      // raise the engine would not take was silent — so the table looked like
      // it had swallowed the tap rather than answered it.
      if (soundMode !== "off") playCue("error")
      // Also one at a time: a refused action is usually refused again a second
      // later, and two of these on top of each other is the table telling you
      // off twice for one mistake.
      toast.error(e instanceof Error ? e.message : "Action failed", {
        id: "action-refused",
      })
    } finally {
      pausePollRef.current = false
      setBusy(false)
    }
  }

  const handleStart = () => {
    const initialStart = view?.phase === "lobby" && view.handNumber === 0
    if (view && initialStart) recordGameStartAttempt(view.players.length)
    return withBusy(async () => {
      if (!session || !view) return
      const firstDeal = view.phase === "lobby" && view.handNumber === 0
      const raw = await pokerApi.startHand(roomId, session.playerId, session.token)
      const nextView = toGameView(raw, session.playerId)
      showFresh(nextView)
      if (firstDeal) {
        recordGameStarted(roomId, nextView.tournamentNumber, nextView.players.length)
      }
    }, (caught) => {
      if (initialStart) recordGameStartFailed(failureCategory(caught))
    })
  }

  // Another tournament at the same table. Named after the one that just
  // finished — the hand it ended on — so two taps are one decision.
  const handlePlayAgain = () =>
    withBusy(async () => {
      if (!session || !view) return
      const raw = await pokerApi.playAgain(
        roomId,
        session.playerId,
        view.handNumber,
        view.tournamentNumber,
        session.token,
      )
      showFresh(toGameView(raw, session.playerId))
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
      showFresh(toGameView(raw, session.playerId))
    }, (caught) => recordActionRejected(action, failureCategory(caught)))

  const handleSitToggle = () =>
    withBusy(async () => {
      if (!session || !view) return
      const raw = await pokerApi.toggleSitOut(
        roomId,
        session.playerId,
        !view.you?.sittingOut,
        session.token,
      )
      showFresh(toGameView(raw, session.playerId))
    })

  const handleTableControl = (action: TableControl) =>
    withBusy(async () => {
      if (!session || !view) return
      const raw = await pokerApi.controlTable(
        roomId,
        session.playerId,
        action,
        session.token,
      )
      showFresh(toGameView(raw, session.playerId))
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
  const handover = handoverState({
    lastHand: view.lastHand,
    isHost: view.isHost,
    paused: view.paused,
    autoDealIn,
  })

  return (
    // The cloth is chosen here rather than on the table, so the whole room is
    // lit by it: the deal button, the focus rings and the pot all agree with
    // the felt instead of the table being blue under a gold button. `.table-lit`
    // rebinds the four accent tokens; nothing else has to know.
    <main
      id="main-content"
      tabIndex={-1}
      data-baize={baizeOf(view.baize)}
      data-deck={deckOf(view.deck)}
      // Three zones in one screen, and nothing scrolls.
      //
      // `min-h-svh` used to let the page grow past the viewport and the table
      // went with it — so on a short phone you scrolled to see the top of the
      // table or the bottom of it, never both. `h-[100svh]` with
      // `overflow-hidden` makes the height a budget instead of a suggestion:
      // the header and your own zone take what they need, and the table gets
      // the rest and fits itself into it. `svh` and not `vh` because the mobile
      // URL bar moves and `vh` measures the tallest the viewport ever gets,
      // which is the one measurement guaranteed not to fit.
      className="table-lit mx-auto flex h-[100svh] w-full max-w-4xl flex-col overflow-hidden px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 outline-none"
      // The rows of the room breathe with the controls: on a short phone the
      // eight pixels between the header, the table and your zone are three
      // more rows of felt.
      style={{ gap: 8 * zu, "--zu": zu } as React.CSSProperties}
    >
      <header className="flex shrink-0 items-start justify-between gap-2">
        {/* `min-w-0 flex-1`, so this is the side that gives. Everything on the
            right is a number somebody is about to play against; the name of the
            room is the one thing on this bar that nobody needs to read twice. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="truncate font-serif text-base font-bold leading-tight text-foreground">{view.roomName}</h1>
          {/* `truncate`, not wrap: this line is allowed to be cut short, but a
              header that grows a third line on a narrow phone takes that line
              off the table below it. */}
          <span className="truncate text-xs text-muted-foreground">
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
        <div className="flex shrink-0 items-center gap-1">
          {view.phase !== "lobby" && view.phase !== "finished" && (
            <InviteShareButton
              roomId={view.roomId}
              roomName={view.roomName}
              phase={view.phase}
              isHost={view.isHost}
              playerCount={view.players.length}
              surface="table"
              compact
            />
          )}
          {session && <ChatSheet roomId={roomId} session={session} />}
          <HelpSheet
            handed={handed}
            onHandedChange={setHanded}
            overSilence={overSilence}
            onOverSilenceChange={setOverSilence}
          />
          {/* On the table, not buried in settings: this gets used with other
              people in the room, and the person who needs it needs it now. */}
          {/* Three states, cycled by tapping. A label rather than three
              buttons, because the middle one is the whole point and it needs
              saying — "only my turn" is not a thing anybody guesses from an
              icon. */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSoundMode(SOUND_NEXT[soundMode])}
            aria-label={`Table sound: ${SOUND_LABEL[soundMode]}. Tap for ${SOUND_LABEL[SOUND_NEXT[soundMode]]}.`}
            className="gap-1 px-2 text-muted-foreground"
          >
            {soundMode === "off" ? <VolumeX /> : soundMode === "turn" ? <Volume1 /> : <Volume2 />}
            {soundMode === "turn" && (
              <span className="text-[10px] font-semibold uppercase">Turn</span>
            )}
          </Button>
          {!finished && <BlindClock view={view} />}
        </div>
      </header>

      {view.phase === "lobby" ? (
        <div className="flex flex-1 items-center justify-center overflow-y-auto">
          <div className="flex w-full max-w-md flex-col gap-3">
            <RoomLobby
              view={view}
              roomId={roomId}
              session={session}
              onStart={handleStart}
              onRulesSaved={showFresh}
              busy={busy}
            />
            {/* The moment you actually need this is before the cards come out:
                somebody joined the wrong table, or took the last seat. */}
            <HostPanel view={view} roomId={roomId} onDone={refresh} session={session} />
          </div>
        </div>
      ) : finished ? (
        // The hand that ends a tournament is the one everybody talks about, and
        // it used to be the only one nobody ever saw: the podium replaced it
        // outright. Show what won before who won.
        // The night, and then what to do about it. Two rows and not one: the
        // podium is as long as the field and scrolls, so an action inside it
        // sits below the fold on a nine-handed table — which is a screen with
        // nothing on it to press, and is what this was.
        <div className="flex min-h-0 flex-1 flex-col items-center gap-3 py-2">
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto">
            <h2 ref={resultsHeadingRef} tabIndex={-1} className="sr-only">
              Final results for {view.roomName}
            </h2>
            <HandResults view={view} title="The final hand" className="shrink-0" />
            <TournamentResults view={view} />
          </div>
          <div className="flex w-full max-w-md flex-col items-center gap-2">
            <HistoryRecorder view={view} session={session} />
            <PlayAgain
              onPlayAgain={view.isHost ? handlePlayAgain : undefined}
              busy={busy}
            />
          </div>
        </div>
      ) : (
        <>
          {/* The table zone: whatever height is left once the header and your
              own zone have taken theirs — and both of those are fixed, so what
              is left is decided by the phone and by nothing else. `min-h-0` is
              load-bearing — without it a flex child refuses to shrink below its
              content and the table pushes the action bar off the bottom, which
              is the bug this whole layout exists to stop.

              The gesture lives on this wrapper rather than inside the table, so
              the table stays a drawing of a table and knows nothing about what
              tapping it means. */}
          <div
            {...feltTap}
            className="relative flex min-h-0 flex-1 items-center justify-center"
          >
            <PokerTable
              view={{ ...view, board: shownBoard, boards: shownBoards }}
              revealed={revealed}
              secondsLeft={secondsLeft}
              // The hands go face up first and the board is dealt out over
              // them; what waits for the last card is the answer — the winning
              // five lighting up and the pot going out.
              boardCompleteMs={boardCompleteMs}
              // A hand turning over is a sound the table makes, and the table
              // is the only thing that knows when one does — the reveal runs
              // on a clock here, not on anything the server said.
              audible={tableIsAudible(soundMode)}
            />

            {/* Over the felt, not above it.
                Both of these are announcements about the table — it is stopped,
                it is waiting for an answer before it deals — and both used to
                be rows in the column that the table's height is what is left
                over from. The stopped-table panel is 146px tall, so a table
                that stopped went from 527 to 373 and every seat and every chip
                on it moved: the app redrew the room to tell you the room had
                paused. Drawn on top, they cost the table nothing. */}
            <TableBreak view={view} onControl={handleTableControl} busy={busy} />
            {/* Shown to the whole table, not only to the players being asked:
                otherwise the pause before the cards come out looks like the app
                having hung. */}
            <RunoutOffer view={view} roomId={roomId} onDone={refresh} session={session} />

            {/* There was a line here — "Double-tap the felt to check", pinned
                to the bottom of the felt until the gesture had been used once.
                It is gone, and so is the flag in local storage that decided
                when to stop drawing it.

                It was never legible where it was put: the bottom seat is drawn
                at `z-[3]` and the line had no z-index at all, so on any phone
                short enough for the plate to reach the bottom of the felt —
                which is every small one — your own name and stack were painted
                straight through the middle of the sentence. Raising it above
                the seat only moves the collision.

                And it was answering a question nobody had. Checking has a
                button on the bar, in words, on every turn where it is free.
                The knock is a shortcut for people who play, and the help sheet
                one tap away is where a shortcut is written down. A gesture
                that needs a caption over the table to be found is a gesture
                the table can do without announcing. */}

            {/* Nothing covers the felt between hands, and that is the change.
                A full-screen panel went up the instant a hand ended — over the
                board that had just decided it, over the winner's cards, over
                everybody's stacks at the one moment they had all just changed.
                The summary was the least interesting thing on that screen and
                it was drawn on top of all of it.

                What ended the hand is now said where the table says everything
                else: the line above the pot names the winner, the board is
                still out, and the hands that went to showdown are still face
                up on the felt. The things that need a *decision* between hands
                moved down into your own band with everything else you touch. */}
          </div>

          {/* Your zone. Not sticky and not pinned — it is simply the last row
              of a screen that adds up, which is why it no longer has to be
              drawn over the table to stay reachable.

              One height, in every phase of every hand: playing, waiting,
              folded, between hands, watching. See `ownZoneHeight` for what the
              number is and for the four-year-old bug it closes. `justify-end`
              so short states pad at the top and the buttons stay against the
              bottom of the screen, where the thumb is; `overflow-hidden` so a
              state nobody has measured yet gives up its own top edge rather
              than taking a bite out of the table.

              Which is the failure this zone is *designed* to fail with, and it
              is silent: nothing throws, nothing scrolls, the top of the band
              simply stops being drawn. It shipped that way — a pass that took
              every button in the app to 44px overflowed this box by 16.7px and
              cut "Your hand" in half on every phone, and by 81.7px with the
              slider open, which took your own cards off the screen. So the box
              is named, and `e2e/your-zone-fits.spec.ts` measures the band's top
              edge against it at five sizes. */}
          <div
            data-own-zone
            className="z-20 flex shrink-0 flex-col justify-end overflow-hidden"
            style={{ height: ownZoneHeight(viewportH), gap: 6 * zu }}
          >
            {spectating ? (
              // Say it plainly. Somebody who is watching and does not know it
              // spends the night waiting for cards that are never coming.
              <div className="flex h-10 items-center justify-center rounded-xl border border-dashed border-border/60 text-[13px] text-muted-foreground">
                You are watching this table
              </div>
            ) : (
              view.phase === "hand" && (
                <HoleCards
                  // Folded, there is no hand to hold. Passing the cards anyway
                  // — the server still sends you your own — would leave a hand
                  // you have thrown away sitting on the rail to be peeked at
                  // for the rest of the deal.
                  cards={you?.folded ? null : (you?.cards ?? null)}
                  revealed={revealed}
                  onRevealChange={setRevealed}
                  folded={you?.folded}
                  made={you?.handName}
                  // The same drag that pulls the cards out throws them away if
                  // it keeps going, which is what a player's hand does at a
                  // real table. Gated on it being legal, so the target never
                  // arms on a hand that cannot be folded.
                  canMuck={!!view.isYourTurn && !!view.legal?.canFold && !busy}
                  onMuck={() => handleAction("fold")}
                  side={cardsSide(handed)}
                />
              )
            )}

            {/* Sitting out costs money, so the way back has to be visible
                whatever the table is doing — and the notice has to say what it
                is costing. It used to read "you sit out from the next hand",
                which described a rule where an absent player was skipped by
                the deal and paid nothing. That made stepping away the cheapest
                move at the table. You are dealt in and blinded like everybody
                else now, and somebody who is not told that will find out from
                their stack. */}
            {you?.sittingOut && !you.out && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2">
                <span className="text-sm text-foreground">
                  {you.autoSatOut
                    ? "Sat out after missing your turn — the blinds keep coming."
                    : "You are sitting out. The blinds still reach you."}
                </span>
                <Button size="sm" onClick={handleSitToggle} disabled={busy}>
                  Sit back in
                </Button>
              </div>
            )}

            {view.phase === "handover" ? (
              <>
                {/* The gap between hands, in the band you already look at.
                    Every one of these asks something of you — show your cards,
                    buy chips, run the table, see what would have come — so they
                    belong with the buttons rather than over the table.

                    The summary of the hand is deliberately *not* here. It is
                    the one thing in this list that asks nothing of anybody, and
                    a panel that appears on its own takes the eye off the table
                    at exactly the moment the table is telling the story: the
                    winner's plate names what they had, the five cards light up,
                    the pot goes to them in an arc. It lives behind a button
                    now — see `HandSummarySheet`. */}
                {!revealing && (
                  // The part of the zone that gives. How many of these are on
                  // offer changes hand to hand — a bluff worth showing, a stack
                  // worth topping up, a river worth peeking at — so this is the
                  // row that gives: `min-h-0` lets it shrink to whatever the
                  // zone has left and scroll the rest, instead of pushing the
                  // buttons down and the table up. Deliberately not `flex-1` —
                  // it must shrink and never grow, or a quiet hand leaves a
                  // hole between your cards and the buttons. It was capped at
                  // 34vh, which is a limit measured against the wrong thing
                  // entirely: the phone, rather than the room left in the zone.
                  <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
                    <ShowCards view={view} roomId={roomId} onShown={refresh} session={session} />
                    <BuyChips view={view} roomId={roomId} onDone={refresh} session={session} />
                    <HostPanel view={view} roomId={roomId} onDone={refresh} session={session} />
                    <RabbitHunt
                      roomId={roomId}
                      handNumber={view.handNumber}
                      boardLength={view.board.length}
                      session={session}
                    />
                  </div>
                )}
                {handover.kind === "finishing" ? (
                  <div
                    role="status"
                    aria-live="polite"
                    className="flex min-h-11 items-center justify-center rounded-xl border border-primary/35 bg-primary/10 px-4 text-center text-[13px] font-medium text-foreground"
                  >
                    {handover.label}
                  </div>
                ) : handover.kind === "host" ? (
                  <div className="flex gap-2">
                    <Button
                      onClick={handleStart}
                      disabled={busy}
                      size="lg"
                      className="flex-1"
                    >
                      {handover.label}
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
                  <div className="flex h-11 items-center justify-center rounded-xl border border-border/60 bg-card/60 text-[13px] text-muted-foreground">
                    {handover.label}
                  </div>
                )}
                {/* The two quiet ones, on one line.
                    Neither is a decision anybody came here to make — one leaves
                    the next hand, the other looks back at the last one — and
                    each was taking a full row of a zone whose every pixel is a
                    row of felt. Side by side they cost one row instead of two,
                    and being small is what says they are not the button above
                    them.

                    "Sit out" is not offered to somebody with no chips: they are
                    already out of the next hand, and it next to "buy back in"
                    reads as two ways of doing the same thing. */}
                <div className="flex items-center justify-center gap-3 text-muted-foreground">
                  {!spectating && !you?.sittingOut && !you?.out && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleSitToggle}
                      // The server has stopped refusing this — an absent player
                      // no longer strands the table, because they are still
                      // dealt in — but the field is still in the contract and
                      // still answered, so the button keeps obeying it.
                      disabled={busy || you?.canSitOut === false}
                      title={
                        you?.canSitOut === false
                          ? "You can't step away from this table right now."
                          : "You stay dealt in and keep paying the blinds."
                      }
                      className="h-7 px-2 text-xs text-muted-foreground"
                    >
                      Step away
                    </Button>
                  )}
                  {!revealing && <HandSummarySheet view={view} />}
                </div>
              </>
            ) : (
              // The controls, and whatever is being offered above them.
              //
              // They are much taller on your turn (sizes, stepper, clock, four
              // buttons) than off it, and it is OWN_ACTION_H — the tallest of
              // them — that the zone's own height is derived from.
              //
              // No scroller and no `justify-end` of its own, and both of those
              // are the same lesson: a flex column that is scrollable *and*
              // bottom-aligned puts its overflow above the top of the box and
              // starts you scrolled to the top, so the first thing you cannot
              // see is the row of buttons at the bottom — which is the one
              // thing on this screen that must never be cut off. The zone
              // above reserves the room, this fits inside it, and the fitting
              // is checked by a test rather than by a scrollbar.
              <div className="flex flex-col gap-1.5">
                {/* Folded, and asked while the memory of the hand is still
                    warm. Nothing turns over until the pot is pushed — see
                    `ShowCards` — but the decision belongs here, seconds after
                    throwing the cards away, and not in the two seconds of
                    handover when the table has already moved on.

                    Inside the reserved zone rather than under the rail: this
                    appears and disappears mid-hand, and anything that changes
                    height out here changes the size of the table. */}
                <ShowCards view={view} roomId={roomId} onShown={refresh} session={session} />
                {/* Above the buttons, where the decision would have been made
                    anyway. Renders nothing on your own turn — planning your
                    turn is not planning, it is acting by a second route. */}
                <PreActions
                  view={view}
                  roomId={roomId}
                  onDone={refresh}
                  session={session}
                />
                <ActionBar
                  view={view}
                  onAction={handleAction}
                  busy={busy}
                  // Passed whoever is on the clock, not just you: knowing the
                  // player you are waiting on has seven seconds left is the
                  // difference between waiting and wondering.
                  secondsLeft={secondsLeft}
                />
              </div>
            )}
          </div>
        </>
      )}
    </main>
  )
}
