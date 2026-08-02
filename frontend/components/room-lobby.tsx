import { Button } from "@/components/ui/button"
import { Coins, Layers3, Timer, TrendingUp, UsersRound } from "lucide-react"
import { cn } from "@/lib/utils"
import type { GameView, PlayerView } from "@/lib/poker-api"
import { InviteShareButton } from "@/components/invite-share-button"
import { PlayerAvatar } from "@/components/player-avatar"

function Stat({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof Coins
  value: string
  label: string
}) {
  return (
    <div
      className="flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl border border-border/45 bg-background/35 px-1.5 py-2.5 text-center"
      aria-label={`${label}: ${value}`}
    >
      <Icon className="size-3.5 text-primary/85" aria-hidden />
      <span className="font-mono text-xs font-semibold tabular-nums text-card-foreground sm:text-sm">
        {value}
      </span>
      <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
    </div>
  )
}

function seatPosition(seat: number, maxSeats: number) {
  const angle = Math.PI / 2 + (seat / maxSeats) * Math.PI * 2
  return {
    left: `${50 + Math.cos(angle) * 44}%`,
    top: `${50 + Math.sin(angle) * 39}%`,
  }
}

function LobbySeatRail({ players, maxSeats }: { players: PlayerView[]; maxSeats: number }) {
  const playersBySeat = new Map(players.map((player) => [player.seat, player]))

  return (
    <div
      className="lobby-seat-rail relative mx-auto aspect-[1.78/1] w-full max-w-xl"
      role="img"
      aria-label={`${players.length} of ${maxSeats} seats filled`}
    >
      <div className="absolute inset-[8%] rounded-[48%] border border-primary/25" aria-hidden />
      {Array.from({ length: maxSeats }, (_, seat) => {
        const player = playersBySeat.get(seat)
        return (
          <span
            key={seat}
            className={cn(
              "absolute size-8 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-lg",
              player ? "ring-2 ring-primary/80 shadow-primary/10" : "",
            )}
            style={seatPosition(seat, maxSeats)}
            title={player ? `Seat ${seat + 1}: ${player.name}` : `Seat ${seat + 1}: open`}
            aria-hidden
          >
            {player ? (
              <PlayerAvatar src={player.avatarUrl} name={player.name} size="sm" />
            ) : (
              <span className="grid size-8 place-items-center rounded-full border border-border/80 bg-background/85 text-[11px] font-bold uppercase text-muted-foreground/50" />
            )}
          </span>
        )
      })}

      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[9px] font-bold uppercase tracking-[0.22em] text-primary/80">
          Table lobby
        </span>
        <strong className="mt-1 font-serif text-xl text-foreground sm:text-2xl">
          Waiting for the table
        </strong>
        <span className="mt-1 font-mono text-xs tabular-nums text-muted-foreground">
          {players.length}/{maxSeats} seats filled
        </span>
      </div>
    </div>
  )
}

export function RoomLobby({
  view,
  onStart,
  busy,
}: {
  view: GameView
  onStart: () => void
  busy: boolean
}) {
  const seated = view.players.length
  const canStart = seated >= 2

  return (
    <section className="room-panel w-full rounded-[1.6rem] p-3.5 sm:p-5">
      <h2 className="sr-only">Table lobby</h2>

      <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
        <Stat icon={Coins} value={`${view.smallBlind}/${view.bigBlind}`} label="Blinds" />
        <Stat icon={Layers3} value={view.startingChips.toLocaleString()} label="Starting" />
        <Stat
          icon={TrendingUp}
          value={view.levelMinutes > 0 ? `${view.levelMinutes} min` : "Fixed"}
          label="Levels"
        />
        <Stat
          icon={Timer}
          value={view.actionSeconds > 0 ? `${view.actionSeconds}s` : "None"}
          label="Action"
        />
      </div>

      <div className="mt-3 grid items-center gap-4 md:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)] md:gap-5">
        <LobbySeatRail players={view.players} maxSeats={view.maxSeats} />

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary/80">At the table</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {seated === 1 ? "The host is ready." : `${seated} players are ready.`}
              </p>
            </div>
            <span className="rounded-full border border-border/60 bg-background/40 px-2.5 py-1 font-mono text-xs tabular-nums text-muted-foreground">
              {seated}/{view.maxSeats}
            </span>
          </div>

          <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-0.5">
            {view.players.map((player) => (
              <li
                key={player.id}
                className="flex min-h-11 items-center justify-between rounded-xl border border-border/50 bg-background/40 px-3 py-2"
              >
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-card-foreground">
                  <span className="relative shrink-0">
                    <PlayerAvatar src={player.avatarUrl} name={player.name} size="sm" />
                    <span
                      className={cn(
                        "absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-background",
                        player.connected ? "bg-emerald-400" : "bg-muted-foreground/40",
                      )}
                      aria-label={player.connected ? "Connected" : "Disconnected"}
                    />
                  </span>
                  <span className="truncate">{player.name}</span>
                  {player.isHost ? (
                    <span className="rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary">
                      Host
                    </span>
                  ) : null}
                  {player.isYou ? (
                    <span className="shrink-0 text-xs text-muted-foreground">You</span>
                  ) : null}
                </span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                  {player.chips.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-auto flex flex-col gap-2">
            <InviteShareButton
              roomId={view.roomId}
              roomName={view.roomName}
              phase="lobby"
              isHost={view.isHost}
              playerCount={seated}
              surface="lobby"
              emphasis={!canStart}
            />

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
          </div>
        </div>
      </div>
    </section>
  )
}
