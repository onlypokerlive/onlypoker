import { Button } from "@/components/ui/button"
import { UsersRound } from "lucide-react"
import { cn } from "@/lib/utils"
import type { GameView, Session, PlayerView } from "@/lib/poker-api"
import { InviteShareButton } from "@/components/invite-share-button"
import { NightRules } from "@/components/night-rules"
import { PlayerAvatar } from "@/components/player-avatar"

/**
 * Where a seat sits on the rail.
 *
 * The radii are the ellipse the ring draws — `inset: 5% 3%` on a box, so 47%
 * across and 45% down — and not nine hand-placed pairs. A constant that nothing
 * measures and nothing derives is the failure this repo keeps having: it goes
 * on being right until somebody changes the box it was measured against.
 */
const RAIL_RX = 47
const RAIL_RY = 45

function seatPosition(seat: number, maxSeats: number) {
  const angle = Math.PI / 2 + (seat / maxSeats) * Math.PI * 2
  return {
    left: `${50 + Math.cos(angle) * RAIL_RX}%`,
    top: `${50 + Math.sin(angle) * RAIL_RY}%`,
  }
}

/**
 * The table, seen from above, with the empty seats showing.
 *
 * This is the roster — there is no list beside it. A ring that says nine seats
 * and a list that says the same nine names is one fact drawn twice, and the
 * second copy is what pushed the button that deals the cards off the bottom of
 * the phone.
 */
function LobbySeatRail({ players, maxSeats }: { players: PlayerView[]; maxSeats: number }) {
  const playersBySeat = new Map(players.map((player) => [player.seat, player]))

  return (
    <div
      className="lobby-seat-rail relative mx-auto aspect-[2.15/1] w-full max-w-xl"
      role="img"
      aria-label={`${players.length} of ${maxSeats} seats filled`}
    >
      <div className="absolute inset-y-[5%] inset-x-[3%] rounded-[48%] border border-primary/25" aria-hidden />
      {Array.from({ length: maxSeats }, (_, seat) => {
        const player = playersBySeat.get(seat)
        return (
          <span
            key={seat}
            className={cn(
              "absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-lg",
              player ? "ring-2 ring-primary/70 shadow-primary/10" : "",
            )}
            style={seatPosition(seat, maxSeats)}
            title={player ? `Seat ${seat + 1}: ${player.name}` : `Seat ${seat + 1}: open`}
            aria-hidden
          >
            {player ? (
              <PlayerAvatar src={player.avatarUrl} name={player.name} size="xs" />
            ) : (
              <span className="block size-6 rounded-full border border-border/80 bg-background/70" />
            )}
            {/* The host wears a crown. It is the cheapest mark there is: it
                takes no room, moves nothing, and needs no reading. */}
            {player?.isHost ? (
              <span className="absolute -right-1.5 -top-2 text-[10px] leading-none text-primary drop-shadow-[0_1px_3px_rgba(0,0,0,.9)]">
                ♛
              </span>
            ) : null}
          </span>
        )
      })}

      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <strong className="font-serif text-[17px] leading-tight text-foreground">Waiting</strong>
        <span className="mt-px font-mono text-[11px] tabular-nums text-muted-foreground">
          {players.length}/{maxSeats} seats
        </span>
      </div>
    </div>
  )
}

export function RoomLobby({
  view,
  roomId,
  session,
  onStart,
  onRulesSaved,
  busy,
  children,
}: {
  view: GameView
  roomId: string
  session: Session | null
  onStart: () => void
  onRulesSaved: (next: GameView) => void
  busy: boolean
  /** Rendered with the rest of the scrolling contents — see the layout note. */
  children?: React.ReactNode
}) {
  const seated = view.players.length
  const canStart = seated >= 2

  /*
   * Ring, invite, the rules of the night, and one button pinned at the bottom.
   *
   * The invite belongs to the ring: it is what you do about the empty seats you
   * are looking at, so it sits directly under them. Filed next to "Start game"
   * instead — which is where it was — the two read as the two halves of a
   * choice, and nobody is choosing between inviting people and dealing.
   *
   * The footer never shrinks and never scrolls. This screen grew a whole card
   * of house rules and nothing was holding it to the phone: measured at 320x568
   * before the fix, the ring was cropped 133px off the top, "Invite players"
   * sat at 598 on a 568-tall screen, and `scrollHeight === clientHeight`, so it
   * could not be scrolled to either. Centring a flex child taller than its
   * container clips it at *both* ends, and `overflow-y-auto` cannot reach past
   * the top edge.
   */
  return (
    <section className="room-panel flex min-h-0 w-full flex-1 flex-col rounded-[1.6rem] p-3.5 sm:p-5">
      <h2 className="sr-only">Table lobby</h2>

      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-1">
        <LobbySeatRail players={view.players} maxSeats={view.maxSeats} />

        <InviteShareButton
          roomId={view.roomId}
          roomName={view.roomName}
          phase="lobby"
          isHost={view.isHost}
          playerCount={seated}
          surface="lobby"
          size="sm"
        />

        {/* The night is agreed here and not on the home screen, with the people
            it applies to in the room and "we've got two hours" already said out
            loud. */}
        <NightRules view={view} roomId={roomId} session={session} onSaved={onRulesSaved} />

        {children}
      </div>

      <div className="mt-3 flex shrink-0 flex-col gap-1.5 border-t border-border/40 pt-3">
        {view.isHost ? (
          canStart ? (
            <Button onClick={onStart} disabled={busy} className="w-full" size="lg">
              Start game
            </Button>
          ) : (
            <div
              role="status"
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-muted/25 px-3 text-sm text-muted-foreground"
            >
              <UsersRound className="size-4 text-primary/70" aria-hidden />
              One more player is needed to deal in
            </div>
          )
        ) : (
          <div
            role="status"
            className="flex min-h-11 items-center justify-center rounded-xl border border-border/60 bg-muted/25 px-3 text-center text-sm text-muted-foreground"
          >
            Waiting for the host to start the game…
          </div>
        )}
        {/* Both questions a host has while looking at eight empty seats,
            answered in one line: whether they are waiting for anybody, and how
            many it takes. */}
        <p className="text-center text-[11px] leading-snug text-muted-foreground">
          {view.isHost
            ? "You start it. Two is enough to deal."
            : "The host starts it. Two is enough to deal."}
        </p>
      </div>
    </section>
  )
}
