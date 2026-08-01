"use client"

import { useLayoutEffect, useRef, useState } from "react"

import { PlayingCard } from "@/components/playing-card"
import { PlayerSeat } from "@/components/player-seat"
import { PotDisplay } from "@/components/pot-display"
import { ChipStack } from "@/components/chip-stack"
import { latestLine } from "@/lib/action-line"
import { baizeOf, deckOf } from "@/lib/table-style"
import {
  betLabel,
  betSpot,
  boxAt,
  crowded,
  estimateBetSize,
  estimateSeatSize,
  estimateStackSize,
  seatBox,
  seatCentre,
  stackOffset,
  type Box,
  type Point,
  type Size,
  type TableSize,
} from "@/lib/table-layout"
import type { GameView, PlayerView } from "@/lib/poker-api"

/**
 * How many chips are drawn beside a seat.
 *
 * Not the player's whole stack — that is what the number under their name is
 * for, and a hundred chips beside every seat is a table you cannot read. This
 * is the handful that says "they have chips", sized so a short stack visibly
 * *is* a short stack.
 */
function stackHeight(chips: number, startingChips: number) {
  if (chips <= 0) return 0
  const share = startingChips > 0 ? chips / startingChips : 1
  return Math.max(2, Math.min(9, Math.round(share * 5) + 2))
}

/**
 * An anchor.
 *
 * The split that makes movement possible later. Every positioned element used
 * to carry `-translate-x-1/2 -translate-y-1/2`, which *is* its transform — so
 * animating a chip from a seat to the pot would have meant rewriting that
 * transform on every frame, and `left`/`top` lay the page out again each time
 * where a transform goes straight to the compositor.
 *
 * So the anchor places, in corner coordinates, and the content inside it is
 * free to be animated without touching where it sits. Corner rather than
 * centre because the box has already been measured, which is what made the
 * centring translate necessary in the first place.
 */
function Anchor({
  at,
  size,
  z,
  piece,
  children,
  innerRef,
}: {
  at: Point
  size: Size
  z?: string
  /**
   * What this is, in one word. Not styling — it is how a check running in a
   * real browser can ask "does anything cover anything" without guessing from
   * class names, which is the check the pure test cannot make.
   */
  piece: string
  children: React.ReactNode
  innerRef?: (el: HTMLDivElement | null) => void
}) {
  return (
    <div
      ref={innerRef}
      data-piece={piece}
      className={`absolute left-0 top-0 ${z ?? ""}`}
      style={{
        // `translate` and not `translate3d`: nine seats' worth of compositor
        // layers is real GPU memory on an old phone, and nothing here is
        // moving yet. The layer goes on the pieces that animate, when they do.
        transform: `translate(${at.x - size.w / 2}px, ${at.y - size.h / 2}px)`,
      }}
    >
      {children}
    </div>
  )
}

function BetChip({ amount }: { amount: number }) {
  return (
    <div className="flex items-center gap-1 rounded-full bg-background/80 px-1.5 py-0.5 shadow-md ring-1 ring-primary/25 backdrop-blur">
      <ChipStack amount={amount} className="scale-90" />
      <span
        className="font-mono text-[11px] font-bold leading-none tabular-nums text-primary"
        title={amount.toLocaleString()}
      >
        {betLabel(amount)}
      </span>
    </div>
  )
}

interface Geometry {
  table: TableSize
  centre: Box | null
  seats: Size[]
  bets: (Size | undefined)[]
  stacks: (Size | undefined)[]
}

export function PokerTable({
  view,
  revealed = false,
  secondsLeft = null,
}: {
  view: GameView
  /** The viewer is holding the peek control, so their own cards are up. */
  revealed?: boolean
  /** Seconds left for the player currently to act. */
  secondsLeft?: number | null
}) {
  // Reorder players so that "you" is always at the bottom of the ring.
  const players = view.players
  const youIdx = players.findIndex((p) => p.isYou)
  const ordered: PlayerView[] =
    youIdx >= 0 ? [...players.slice(youIdx), ...players.slice(0, youIdx)] : players
  const total = ordered.length

  const tableRef = useRef<HTMLDivElement>(null)
  const centreRef = useRef<HTMLDivElement>(null)
  // Every seat is measured, not one of them: the blind and to-act badges make
  // some seats taller than others, and a chip stepped off the wrong size lands
  // on the seat next door.
  const seatRefs = useRef<(HTMLDivElement | null)[]>([])
  const betRefs = useRef<(HTMLDivElement | null)[]>([])
  const stackRefs = useRef<(HTMLDivElement | null)[]>([])
  const [geometry, setGeometry] = useState<Geometry>({
    table: { w: 0, h: 0 },
    centre: null,
    seats: [],
    bets: [],
    stacks: [],
  })

  const measured = geometry.seats.length === total
  const bets = ordered.map((p) => p.bet).join(",")
  // Turning a hand over grows a seat, and everything placed against that seat
  // was placed against a box that has just stopped existing. This is the
  // relayout trigger that gets forgotten, and the one that actually breaks
  // things — the other three are obvious enough to remember.
  const shown = ordered.map((p) => (p.cards ? p.cards.length : 0)).join(",")

  useLayoutEffect(() => {
    /**
     * Read everything, then write once.
     *
     * The order is the point. Measuring a seat, placing its chip, then
     * measuring the next seat makes the browser lay the whole page out again
     * to answer the second question, and it does that once per seat. Reading
     * the whole table in one pass and only then calling `setGeometry` took the
     * measured layout count from 97 to 40 on a bet and 99 to 42 on a resize,
     * with an identical result on screen.
     */
    const measure = () => {
      const table = tableRef.current
      if (!table) return
      const t = table.getBoundingClientRect()
      const relative = (el: Element | null): Box | null => {
        if (!el) return null
        const r = el.getBoundingClientRect()
        return {
          left: r.left - t.left,
          top: r.top - t.top,
          right: r.right - t.left,
          bottom: r.bottom - t.top,
        }
      }
      const sizeOf = (el: Element | null): Size | undefined => {
        if (!el) return undefined
        const r = el.getBoundingClientRect()
        return { w: r.width, h: r.height }
      }

      // Every read happens here, before a single write.
      const next: Geometry = {
        table: { w: t.width, h: t.height },
        centre: relative(centreRef.current),
        seats: ordered.map(
          (_, i) =>
            sizeOf(seatRefs.current[i]) ??
            estimateSeatSize({ width: t.width, seats: total, revealed }),
        ),
        bets: ordered.map((_, i) => sizeOf(betRefs.current[i])),
        stacks: ordered.map((_, i) => sizeOf(stackRefs.current[i])),
      }
      setGeometry(next)
    }

    measure()
    const observer = new ResizeObserver(measure)
    const watched = [
      tableRef.current,
      centreRef.current,
      ...seatRefs.current,
      ...betRefs.current,
      ...stackRefs.current,
    ]
    for (const el of watched) {
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
    // The four things that move everything: the board growing, the table
    // emptying, a bet changing width — and a seat changing size, which is the
    // one that gets left out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.board.length, total, bets, shown, measured])

  const table = geometry.table
  const live = table.w > 0 && measured

  // ---- Compute. Pure, from the measurements above, and nothing is written
  // to the document until React renders the result. ----
  const seatSizes = geometry.seats
  const seatBoxes = live
    ? ordered.map((_, i) => seatBox(i, total, table, seatSizes[i]))
    : null

  const betPlacements: (Point | null)[] = []
  const stackPlacements: (Point | null)[] = []
  if (seatBoxes) {
    const placedBets: Box[] = []
    for (let i = 0; i < total; i++) {
      if (ordered[i].bet <= 0) {
        betPlacements.push(null)
        continue
      }
      const size = geometry.bets[i] ?? estimateBetSize(ordered[i].bet)
      const at = betSpot(i, total, table, seatBoxes, size, geometry.centre, placedBets)
      placedBets.push(boxAt(at, size))
      betPlacements.push(at)
    }

    // Stacks last, and against the bets that were just placed rather than
    // against whatever the document still says — a chain that reads its own
    // half-finished output back out of the DOM gives an answer that depends on
    // the order it happened to run in.
    const placedStacks: Box[] = []
    for (let i = 0; i < total; i++) {
      const discs = stackHeight(ordered[i].chips, view.startingChips)
      if (discs <= 0) {
        stackPlacements.push(null)
        continue
      }
      const size = geometry.stacks[i] ?? estimateStackSize(discs)
      const at = stackOffset(i, total, table, seatBoxes, size, [
        ...(geometry.centre ? [geometry.centre] : []),
        ...placedBets,
        ...placedStacks,
      ])
      placedStacks.push(boxAt(at, size))
      stackPlacements.push(at)
    }
  }

  // Only a real showdown puts hands on the table. A pot won by folding ends in
  // "handover" too, and inferring from the phase would flip the winner's own
  // cards face up for whoever is sitting next to them.
  const showdown = view.wentToShowdown

  // The table's own voice. During a hand it is the last decision — the thing a
  // real table says out loud and the app used to swallow, which is why nobody
  // who was looking at their own cards knew where the action was. Once the
  // hand is settled the only thing worth saying is who won it.
  const said =
    view.phase === "hand" ? latestLine(view.actions, view.players) : view.message

  return (
    // Taller than a 3:4 box on phones: nine seats need the vertical room, or
    // the pairs flanking the top corners run into each other.
    <div
      ref={tableRef}
      data-baize={baizeOf(view.baize)}
      data-deck={deckOf(view.deck)}
      // The aspect ratio is not decoration and it is not negotiable: nine
      // seats need about 450px of table before adjacent boxes start touching,
      // and squashing the box to fit a short phone is what makes them touch.
      // Measured, not guessed — see the layout test, which walks the heights.
      // So the page scrolls on a short phone, as it already did, and the
      // buttons stay pinned.
      className="relative mx-auto aspect-[3/4.4] w-full max-w-sm sm:aspect-[3/2] sm:max-w-3xl"
    >
      {/* The rail, and the cloth inside it. Two boxes rather than a border,
          because wood and felt are different materials and a border can only
          be one colour. */}
      <div className="rail absolute inset-0 rounded-[46%] shadow-[0_10px_30px_rgba(0,0,0,0.55)]">
        <div className="baize absolute inset-3 rounded-[45%]">
          {/* The gold fillet. Inside the cloth, not on the wood — it is the
              line inlaid at the edge of the playing surface. */}
          <div
            className="absolute inset-5 rounded-[45%] border"
            style={{ borderColor: "color-mix(in oklab, var(--fillet) 30%, transparent)" }}
          />
        </div>
      </div>

      {/* Center: pot + board. */}
      <div className="absolute left-1/2 top-[42%] flex w-full -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2 px-2">
        {/* Measured as the reserved middle of the table, so it hugs its
            contents rather than spanning the full width. */}
        <div ref={centreRef} data-piece="centre" className="flex w-fit flex-col items-center gap-2">
          <PotDisplay pots={view.pots} total={view.pot} youId={view.you?.id} />
          <div
            data-testid="board"
            data-cards={view.board.length}
            className="flex min-h-[3rem] flex-wrap items-center justify-center gap-1"
          >
            {view.board.length > 0 ? (
              // Small on narrow phones: five cards at the sm size leave a
              // nine-handed table no room between the board and the seats.
              view.board.map((c, i) => (
                <PlayingCard
                  key={i}
                  card={c}
                  size="xs"
                  className="min-[380px]:h-12 min-[380px]:w-9 min-[380px]:text-xs"
                />
              ))
            ) : (
              <span className="text-xs text-muted-foreground/70">
                {view.phase === "hand" ? "Community cards" : "Waiting for next hand"}
              </span>
            )}
          </div>
        </div>
        {/* What the table would have said out loud. One region, announced
            politely, and never two: a screen reader given two live regions in
            the middle of the table reads them in whichever order it likes. */}
        <div
          role="status"
          aria-live="polite"
          className="flex min-h-6 items-center justify-center empty:hidden"
        >
          {said && (
            <span className="max-w-[16rem] text-balance rounded-lg bg-background/80 px-3 py-1 text-center text-xs text-foreground backdrop-blur">
              {said}
            </span>
          )}
        </div>
      </div>

      {/* The chips each player still has, beside their seat — never above it,
          which is where their cards are. Drawn before the bets so a bet that
          has nowhere else to go sits on top of a stack rather than under it. */}
      {ordered.map((p, i) =>
        stackPlacements[i] ? (
          <Anchor
            key={`stack-${p.id}`}
            piece="stack"
            at={stackPlacements[i]!}
            size={geometry.stacks[i] ?? estimateStackSize(stackHeight(p.chips, view.startingChips))}
            innerRef={(el) => {
              stackRefs.current[i] = el
            }}
          >
            <ChipStack amount={chipsShown(p.chips, view.startingChips)} />
          </Anchor>
        ) : null,
      )}

      {/* Chips wagered this street, out on the felt in front of each player. */}
      {ordered.map((p, i) =>
        betPlacements[i] ? (
          <Anchor
            key={`bet-${p.id}`}
            piece="bet"
            at={betPlacements[i]!}
            size={geometry.bets[i] ?? estimateBetSize(p.bet)}
            z="z-10"
            innerRef={(el) => {
              betRefs.current[i] = el
            }}
          >
            <BetChip amount={p.bet} />
          </Anchor>
        ) : null,
      )}

      {/* Seats */}
      {ordered.map((p, i) => (
        <Anchor
          key={p.id}
          piece="seat"
          at={seatCentre(i, total, table)}
          size={seatSizes[i] ?? estimateSeatSize({ width: table.w, seats: total, revealed })}
          z="z-20"
          innerRef={(el) => {
            seatRefs.current[i] = el
          }}
        >
          <PlayerSeat
            player={p}
            showdown={showdown}
            revealed={revealed}
            compact={crowded(total)}
            secondsLeft={p.isActor ? secondsLeft : null}
            actionSeconds={view.actionSeconds}
          />
        </Anchor>
      ))}
    </div>
  )
}

/**
 * The amount the drawn stack represents.
 *
 * Not their chip count — see {@link stackHeight}. The number under their name
 * is the truth; this is scaled so the *colours* say roughly how deep they are,
 * which is what a stack across a table tells you.
 */
function chipsShown(chips: number, startingChips: number) {
  const discs = stackHeight(chips, startingChips)
  if (discs <= 0) return 0
  // Enough that the breakdown reaches into the higher denominations for a big
  // stack and stays low for a short one.
  const step = Math.max(1, Math.round(startingChips / 20))
  return step * discs
}
