"use client"

import { WifiOff } from "lucide-react"

import { cn } from "@/lib/utils"
import { PlayingCard } from "@/components/playing-card"
import { ChipStack } from "@/components/chip-stack"
import { CHIP_W } from "@/lib/table-layout"
import type { PlayerView } from "@/lib/poker-api"

/**
 * The colour of somebody's avatar, from their name.
 *
 * Deterministic so a player is the same colour to everybody at the table and
 * the same colour tomorrow — an avatar that changes hue between hands is worse
 * than no avatar, because it is a signal that means nothing. Hue only: the
 * lightness and chroma are fixed so no player is harder to see than another.
 */
function avatarHue(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return h
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return "?"
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * The one word that says where somebody is sitting, or what they just did.
 *
 * The position wins, and it used to lose. "Away" and "Fold" sat above the
 * blinds in this list, so a big blind who let their clock run out stopped being
 * the big blind as far as the table could see — and on a hand where both blinds
 * timed out, which is exactly what a table of people looking at their phones
 * produces, the blinds vanished from the felt altogether. Where they are is
 * structural: it moves every hand, everybody has to know it, and nothing else
 * on screen says it.
 *
 * What is lost by demoting the states is nothing, because they are already
 * drawn: a folded seat is at a third opacity and an eliminated one is grey.
 * That is a stronger signal than a word in a pill, and it is legible from
 * across the table. Being *out* keeps its word — a player who has been knocked
 * out holds no position to report.
 */
function tag(player: PlayerView): { text: string; kind: "post" | "fold" | "out" } | null {
  if (player.out) return { text: "Out", kind: "out" }
  if (player.isStraddle) return { text: "STR", kind: "post" }
  if (player.isBigBlind) return { text: "BB", kind: "post" }
  if (player.isSmallBlind) return { text: "SB", kind: "post" }
  if (player.folded) return { text: "Fold", kind: "fold" }
  if (player.sittingOut && !player.inHand) return { text: "Sat out", kind: "out" }
  if (player.timedOut) return { text: "Away", kind: "out" }
  return null
}

/**
 * A player.
 *
 * The plate is the player and the rest is air — that is the whole arrangement,
 * and it is why this is not a bordered card with things stacked inside it. The
 * hand peeks from *behind* the avatar, the avatar overlaps the plate, and the
 * plate is the only thing with a background. It reads as a person sitting at a
 * table rather than a row in a list, and it is a third of the footprint, which
 * is what lets nine of them ring a phone.
 *
 * The ring around the avatar is the shot clock. The focus travelling from chair
 * to chair is what tells the table where the action is without anybody reading
 * a name, and a ring that drains says how long is left in the same glance.
 */
export function PlayerSeat({
  player,
  showdown,
  made = null,
  holdHand = false,
  lit,
  dim = false,
  revealed = false,
  compact = false,
  secondsLeft = null,
  actionSeconds = 0,
  chips = 0,
  chipsShown = 0,
  u = 1,
}: {
  player: PlayerView
  showdown: boolean
  /** How many discs to draw beside the plate. See `seatChips`. */
  chips?: number
  /** Their real chip count, which is what decides the colours. */
  chipsShown?: number
  /**
   * The scale the table is being drawn at. See `tableScale`.
   *
   * Every size in here is multiplied by it. The seat does not decide how big it
   * is — the table does, because the table is the thing that has to fit on the
   * screen, and nine plates that do not shrink with it are nine plates that end
   * up on top of each other.
   */
  u?: number
  /** Whether the viewer is currently holding the peek control. */
  revealed?: boolean
  /**
   * What this player won with, in words — the fifth beat of a showdown.
   *
   * Takes the position tag's row rather than getting one of its own: that row
   * is already reserved (see below), it is an inch from the cards being talked
   * about, and "SB" is not what anybody wants to read at the moment a hand is
   * turned over. Free, and it cannot drift.
   */
  made?: string | null
  /**
   * This hand's turn to be shown has not come round yet.
   *
   * A showdown arrives from the server as one response with every hand in it,
   * and turning them all over in one frame is the thing a showdown never is.
   * The table decides whose moment it is (`use-showdown`); the seat just holds
   * its cards down until told.
   */
  holdHand?: boolean
  /**
   * Whether this card is one of the five that made the winning hand, and its
   * moment to light has come.
   *
   * The board asks the same question of the same function (`use-showdown`), and
   * it has to: three of the five are usually on the board and two are in
   * somebody's hand, and lighting only the board half is what produced four lit
   * cards and a hole card sitting there in the dark — a winning hand that
   * visibly does not add up to five.
   */
  lit?: (card: string) => boolean
  /** The winning five are being picked out, and this hand is not among them. */
  dim?: boolean
  /**
   * Seven seats or more, where the ring stops having room to spare.
   *
   * Decided by the table rather than by the seat measuring its own crowding,
   * because only the table knows how many are at it. See `crowded()` in
   * `lib/table-layout.ts`, which is what the layout test measures against.
   */
  compact?: boolean
  /** Seconds left on the shot clock, when this seat is the one to act. */
  secondsLeft?: number | null
  actionSeconds?: number
}) {
  const isFolded = player.folded
  // Your own hand stays face down unless you're holding the peek control, so a
  // glance from the next chair gives nothing away. A hand that reaches
  // showdown is public information, so it stays up.
  // …and a hand the showdown never turned over stays yours: beaten, speaking
  // after the winner, thrown away face down. Your own screen must show what
  // the table sees, or you spend the pause thinking everybody read your bluff.
  const hideOwnHand = player.isYou && !revealed && !(showdown && player.showedDown)
  // …and at a showdown every hand waits its turn. The server sends them all in
  // the same response, which is why they used to arrive in the same frame:
  // nine hands appearing at once is the *answer* to the hand rather than the
  // hand. Gated on this rather than on `showdown` because a player who chooses
  // to turn their cards over after winning uncontested is not a showdown and
  // must not be held back — see `use-showdown`.
  // …with one exception, and it is the whole point of showing: a card you have
  // deliberately turned face up is public, and your own seat is the one seat
  // that was still drawing it face down. You see your hand on the rail either
  // way, so nothing looked like it had happened — the tap did nothing as far as
  // the table was concerned. Masked to exactly what everybody else can see,
  // which for one card shown is one card and one back.
  const turnedOver = player.shownIndices?.length
    ? (player.cards ?? []).map((c, i) => (player.shownIndices.includes(i) ? c : null))
    : null
  const cards = hideOwnHand || holdHand ? turnedOver : player.cards
  const shown = !!cards
  const showClock = player.isActor && actionSeconds > 0 && secondsLeft != null && !showdown
  const clockPct = showClock
    ? Math.min(100, Math.max(0, (secondsLeft! / actionSeconds) * 100))
    : 0
  const urgent = showClock && secondsLeft! <= 5

  // Every size below is "the number a designer would write for a 390px phone",
  // times the scale the table is actually being drawn at. One multiplication
  // rather than a set of breakpoints: the table shrinks continuously, so the
  // pieces on it have to as well, and a plate that steps between two sizes at a
  // threshold is a plate that is wrong on one side of it.
  const px = (n: number) => `${n * u}px`
  const av = (compact ? 32 : 38) * u
  const label = tag(player)

  return (
    <div
      className={cn(
        // `pr` is the sliver the stack's outer half lives in. The seat's
        // *content* is the plate's width; the box is that plus half a chip,
        // which is what `estimateSeatSize` reserves.
        "relative flex flex-col items-center transition-opacity",
        isFolded && "opacity-[0.32]",
        player.out && "opacity-40 grayscale",
      )}
      style={{
        // The plate's width, plus the sliver the stack's outer half lives in.
        // Has to agree with `estimateSeatSize`, which is what reserved it.
        width: px((compact ? 60 : 68) + CHIP_W / 2),
        paddingRight: px(CHIP_W / 2),
      }}
    >
      {/* Where they are sitting, over the hand. Small caps on a coloured pill:
          at this size a word needs a shape to be read as a word.

          In normal flow, and the row is there whether or not there is anything
          in it. Floating it above the plate on `position:absolute` is the
          obvious way to draw it and it is wrong: an absolutely positioned child
          does not appear in its parent's box, so the seat measures as if the
          tag were not there and the layout hands that spot to somebody's bet.
          That is exactly what happened — the small blind's chips landed under
          the "SB" pill. A reserved row costs eleven pixels and cannot drift. */}
      <div
        className="z-[3] flex items-center justify-center"
        style={{ height: px(11) }}
      >
        {/* Channel two: the number itself, once it is worth reading.
            A ring says "some" and a number says "four", and at four seconds the
            difference is whether you hurry. It takes the tag's place rather
            than getting a spot of its own — the row is already reserved, it is
            an inch from the ring that is draining, and "SB" is not what anybody
            needs to know with four seconds left. Held back until then so eight
            seats are not all counting at you. */}
        {/* The position tag keeps this row for good.
            It used to be handed over to the countdown at five seconds, and that
            was wrong twice: the blinds are the one thing on the felt nothing
            else says, and giving them up is how "where are the blinds?" got
            asked in the first place. The seconds now live on the avatar, where
            they belong — attached to the person on the clock rather than
            standing in for their position. */}
        {made ? (
          // Outranks everything else this row can say, and only appears for a
          // couple of seconds at the end of a hand somebody won by showing it.
          <span
            className="max-w-full truncate rounded-full font-extrabold uppercase tracking-[0.06em]"
            style={{
              fontSize: px(7),
              lineHeight: px(11),
              paddingInline: px(6),
              background: "var(--accent)",
              color: "var(--accent-ink)",
            }}
            title={made}
          >
            {made}
          </span>
        ) : label ? (
          <span
            className={cn(
              "whitespace-nowrap rounded-full font-extrabold uppercase tracking-[0.1em]",
              // Blinds are gold — they are a position, not a problem. Folding
              // is red and being gone is grey, and both are quieter than the
              // seat that is still in the hand.
              label.kind === "post" && "text-[color:var(--accent-ink)]",
              label.kind === "fold" && "text-white",
              label.kind === "out" && "text-[color:var(--ivory)]",
            )}
            style={{
              fontSize: px(7),
              lineHeight: px(11),
              paddingInline: px(6),
              background:
                label.kind === "post"
                  ? "var(--accent)"
                  : label.kind === "fold"
                    ? "color-mix(in srgb, var(--danger) 86%, transparent)"
                    : "rgba(0,0,0,.55)",
            }}
          >
            {label.text}
          </span>
        ) : null}
      </div>

      {/* The hand, peeking out from behind the avatar. Negative margin, not a
          row of its own: the cards are *held*, and a table where you can see
          who is still in the hand at a glance is the point of drawing them at
          all. They grow when turned over, and come forward as they do.

          No transition on that margin, and it used to have one. Two reasons,
          and the second is the expensive one. The cards' own width and height
          are inline and snap, so gliding the margin animated half of a two-part
          change — the hand jumped bigger and then slid. And margin is a layout
          property: nine seats easing it for 150ms is nine boxes changing size
          on every frame, each one waking the ResizeObserver that re-measures
          the whole table. A hand turning over was re-laying the table out about
          ten times for an effect nobody asked for. Movement belongs on
          `transform`; that is V4's job, on the pieces that actually travel. */}
      {(shown || player.cardsCount > 0) && (
        <div
          className="relative z-[1] flex justify-center"
          style={{
            gap: px(1),
            marginBottom: px(shown ? (compact ? -6 : -7) : compact ? -11 : -13),
          }}
        >
          {(cards ?? Array.from({ length: player.cardsCount }, () => null)).map((c, i) => (
            <PlayingCard
              key={i}
              card={c}
              faceDown={!c}
              size="xs"
              // A hand nobody has turned over is a marker, not a card, so it
              // shrinks to almost nothing. Turned over it has to be *read*,
              // which is a different job and a different size. Nine seats cap
              // the grown size: the plates are less than thirty pixels apart,
              // and a full-size revealed hand lands on the neighbour's.
              className="rounded-[2px]"
              style={{
                ...(shown
                  ? {
                      width: px(compact ? 17 : 22),
                      height: px(compact ? 24 : 31),
                      fontSize: px(compact ? 9 : 11),
                    }
                  : { width: px(compact ? 12 : 14), height: px(compact ? 17 : 20) }),
                // Picked out exactly as the board picks its own out, because
                // they are five cards of one hand and drawing them two
                // different ways is drawing two hands.
                opacity: dim && !(c && lit?.(c)) ? 0.32 : 1,
                boxShadow:
                  c && lit?.(c)
                    ? `0 0 0 ${1.5 * u}px var(--accent), 0 0 ${8 * u}px rgba(0,0,0,.55)`
                    : undefined,
                transition: "opacity 220ms ease-out, box-shadow 220ms ease-out",
              }}
            />
          ))}
        </div>
      )}

      {/* The avatar, and the clock around it. */}
      <div
        className="relative z-[2]"
        style={{ width: av, height: av, marginBottom: px(-7) }}
      >
        <div
          className="grid h-full w-full place-items-center rounded-full font-extrabold text-white/95"
          style={{
            fontSize: px(compact ? 11 : 13),
            background: `linear-gradient(150deg, oklch(0.62 0.14 ${avatarHue(player.name)}), oklch(0.34 0.09 ${avatarHue(player.name)}))`,
            boxShadow:
              "0 3px 10px rgba(0,0,0,.6), inset 0 0 0 2px rgba(255,255,255,.14)",
          }}
          aria-hidden
        >
          {initials(player.name)}
        </div>

        {showClock && (
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute -inset-1 rounded-full",
              // The beat pulses the glow rather than the seat: fading the whole
              // thing would dim the name and the chip count at exactly the
              // moment somebody needs to read them.
              urgent && "beat",
            )}
            style={{
              padding: Math.max(2, 3 * u),
              background: `conic-gradient(from -90deg, ${
                urgent ? "var(--danger)" : "var(--accent)"
              } ${clockPct}%, rgba(0,0,0,.5) 0)`,
              // Ring rather than disc: paint the padding box and knock the
              // content box back out of it.
              WebkitMask:
                "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
              WebkitMaskComposite: "xor",
              mask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
              maskComposite: "exclude",
            }}
          />
        )}

        {/* The seconds, on the person they belong to.
            The whole turn, not the last five seconds of it. The ring says
            "some time left", and "some" is the answer to a different question
            from the one anybody at a table is asking — which is whether they
            have time to think, and that is a number.

            Only one seat is ever on the clock, so this is not eight countdowns
            at once; that was the argument against the *tick*, and it got
            applied here by mistake. Absolutely positioned over the avatar,
            which is already reserved space, so it costs the seat no height and
            cannot push a chip onto a neighbour. */}
        {showClock && (
          <span
            role="timer"
            aria-label={`${Math.ceil(secondsLeft!)} seconds left to act`}
            className="absolute left-1/2 z-[3] -translate-x-1/2 rounded-full font-mono font-black tabular-nums text-white"
            style={{
              bottom: px(-5),
              fontSize: px(9),
              lineHeight: px(13),
              paddingInline: px(4),
              background: urgent ? "var(--danger)" : "rgba(10,8,6,.92)",
              boxShadow: `0 0 0 ${Math.max(1, 1.2 * u)}px ${
                urgent ? "var(--danger)" : "var(--accent)"
              }, 0 2px 5px rgba(0,0,0,.7)`,
            }}
          >
            {Math.ceil(secondsLeft!)}
          </span>
        )}

        {/* The button, on the corner of the avatar where a real one sits on
            the felt beside the player. */}
        {player.isButton && (
          <span
            className="absolute -bottom-0.5 -right-1.5 z-[3] grid size-4 place-items-center rounded-full text-[8px] font-black text-[#14100C]"
            style={{
              background: "linear-gradient(160deg,#FFF,#C7C0B0)",
              boxShadow: "0 2px 5px rgba(0,0,0,.6)",
            }}
            aria-label="Dealer button"
          >
            D
          </span>
        )}
      </div>

      {/* The plate, and the chips leaning on it.
          §1.6(b): the stack hangs off the *plate*, because the plate is the
          player and the rest is air. It used to be placed by the same search
          that places bets — sent off round the felt to find a gap — which never
          overlapped anything and always looked wrong, because "somewhere near
          seat 4 with room" is a different spot every hand. Chips that belong to
          somebody have to be *touching* them. Here it is a sibling of the
          plate, so it is part of the seat's own box and can no more drift than
          the name can. */}
      <div
        className={cn(
          "plate relative z-[1] flex w-full flex-col items-center transition-shadow",
          !player.connected && !player.out && "border-dashed",
        )}
        style={{
          borderRadius: px(7),
          paddingInline: px(5),
          paddingTop: px(8),
          paddingBottom: px(3),
          ...(player.isActor
            ? {
                borderColor: "var(--accent)",
                boxShadow:
                  "0 0 16px color-mix(in srgb, var(--accent) 42%, transparent), 0 4px 12px rgba(0,0,0,.5)",
              }
            : null),
        }}
      >
        <span className="flex w-full items-center justify-center gap-0.5">
          {/* The table needs to know who wandered off, not just who is slow. */}
          {!player.connected && !player.out && (
            <WifiOff className="size-2.5 shrink-0 opacity-60" aria-label="Disconnected" />
          )}
          <span
            className="truncate font-semibold leading-tight"
            style={{ color: "var(--ivory)", fontSize: px(9) }}
          >
            {player.name}
          </span>
        </span>
        <span
          className="font-mono font-bold leading-tight tracking-tight tabular-nums"
          style={{
            fontSize: px(11),
            // All-in is the one stack worth reading in a different colour: it
            // is not a number any more, it is a state.
            color: player.allIn ? "var(--danger)" : "var(--accent)",
          }}
        >
          {player.allIn ? "All in" : player.chips.toLocaleString()}
        </span>
      </div>
      {/* Not their whole stack — the number an inch to the left is the truth.
          This is the handful that says how deep they are without counting,
          which is what a stack across a table actually tells you.

          Absolute, into the gutter the seat reserves for it with `pr`, so the
          plate and everything stacked above it stay centred on the seat's own
          point on the ring. Laying it out as a flex sibling would shove the
          avatar and the hand twenty pixels off the mark, which is nine seats
          all leaning the same way. */}
      {chips > 0 && (
        <ChipStack
          amount={chipsShown}
          exactly={chips}
          u={u}
          className="pointer-events-none absolute right-0 z-[2]"
          style={{ bottom: -2 * u }}
        />
      )}

    </div>
  )
}
