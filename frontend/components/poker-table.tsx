"use client"

import { useLayoutEffect, useRef, useState } from "react"

import { PlayingCard } from "@/components/playing-card"
import { PlayerSeat } from "@/components/player-seat"
import type { GameView, PlayerView } from "@/lib/poker-api"

// Seats ride an ellipse with "you" at the bottom. Computing the ring beats
// hand-tuning a layout per table size: the spacing stays even from two players
// to nine, and nothing creeps into the middle where the board lives.
//
// The radii are percentages but a seat is measured in pixels, so they are set
// for the narrowest phone we support (320px). Anything wider only gains slack.
const SEAT_RX = 37
const SEAT_RY = 38

// Fallback half-size of a seat box, used only until one has been measured. The
// real thing is measured because the seat grows on wider screens, and a chip
// stepped off a stale size lands inside the box.
const SEAT_HALF_W = 34
const SEAT_HALF_H = 46
// Starting half-size of a bet chip, used only for the frame before the real one
// is measured. It has to be measured: the pill is as wide as the number inside
// it, so a five-figure raise is half again as wide as a blind, and a chip
// stepped off a guessed width sits on the seat it was meant to clear.
const CHIP_HALF_W = 22
const CHIP_HALF_H = 8
const CHIP_GAP = 8

function seatAngle(index: number, total: number) {
  // Start at the bottom (you) and work around the table.
  return Math.PI / 2 + (index * 2 * Math.PI) / total
}

function seatPosition(index: number, total: number) {
  const angle = seatAngle(index, total)
  return {
    left: `${50 + SEAT_RX * Math.cos(angle)}%`,
    top: `${50 + SEAT_RY * Math.sin(angle)}%`,
  }
}

// How far the chip may be walked in towards the middle, and slid sideways
// along the ring, while looking for a gap between the seats it has to clear.
const PUSH_STEP = 3
const MAX_PUSH = 90
const SLIDE_STEP = 4
// Generous, because on a three-handed 320px table the lane between a flank
// seat and the board is around 15px wide — nothing fits in it, and the only
// free felt is a good way along the ring. Small slides are still tried first.
const MAX_SLIDE = 72

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

interface SeatSize {
  halfW: number
  halfH: number
}

function overlaps(a: Box, b: Box) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

function expand(box: Box, px: number): Box {
  return {
    left: box.left - px,
    top: box.top - px,
    right: box.right + px,
    bottom: box.bottom + px,
  }
}

function seatCentre(index: number, total: number, table: { w: number; h: number }) {
  const angle = seatAngle(index, total)
  return {
    x: table.w / 2 + (SEAT_RX / 100) * table.w * Math.cos(angle),
    y: table.h / 2 + (SEAT_RY / 100) * table.h * Math.sin(angle),
  }
}

function seatBox(
  index: number,
  total: number,
  table: { w: number; h: number },
  size: SeatSize,
): Box {
  const c = seatCentre(index, total, table)
  return {
    left: c.x - size.halfW,
    top: c.y - size.halfH,
    right: c.x + size.halfW,
    bottom: c.y + size.halfH,
  }
}

function chipBox(x: number, y: number, chip: SeatSize): Box {
  return {
    left: x - chip.halfW,
    top: y - chip.halfH,
    right: x + chip.halfW,
    bottom: y + chip.halfH,
  }
}

function overlapArea(a: Box, b: Box) {
  const x = Math.min(a.right, b.right) - Math.max(a.left, b.left)
  const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  return x > 0 && y > 0 ? x * y : 0
}

// A chip over the board costs far more than a chip over a seat: the community
// cards and the pot are what everybody at the table is reading, and a seat has
// room to spare around its edge. High enough to be a rule rather than a
// trade-off, but still a weight, so a hopeless table degrades instead of
// snapping to some arbitrary corner.
const BOARD_WEIGHT = 200

/**
 * Where a player's wagered chips go: walked in from their seat towards the
 * middle, and slid along the ring, until the chip covers neither another seat
 * nor the pot and board.
 *
 * This works in pixels against the measured table, because the things it has to
 * avoid are sized in pixels while the seat ring is a percentage. On a 320px
 * phone seating nine, the lane between a flank seat and the community cards is
 * only a few pixels wide — guessing at percentages puts chips on top of a seat.
 *
 * It searches rather than solving in one shot because the obstacles are boxes
 * on a ring, not a single edge: past its own seat the chip can still be inside
 * a neighbour's, and every pixel further in opens that gap up, since the seats
 * are all centred on the ring it is leaving.
 *
 * Some tables have no clean answer at all — a five-figure raise is a wide pill,
 * and a narrow phone leaves nothing between a seat and the board. So the search
 * keeps the least-bad spot it saw rather than falling back on a fixed one: an
 * overlap of a few pixels is worth having when the alternative is a chip parked
 * squarely on somebody's stack.
 */
function betOffset(
  index: number,
  total: number,
  table: { w: number; h: number },
  centre: Box | null,
  seats: Box[],
  chip: SeatSize,
) {
  const angle = seatAngle(index, total)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const c = seatCentre(index, total, table)

  const own = seats[index]
  const halfW = (own.right - own.left) / 2
  const halfH = (own.bottom - own.top) / 2
  // Distance at which the chip's *box* clears its own seat's box on at least
  // one axis. Stepping off the seat edge and adding a fixed gap falls short on
  // the diagonals, where clearing one axis is what the geometry actually asks
  // for and the shortfall lands the chip inside the seat it came from.
  const needX =
    Math.abs(cos) < 1e-6 ? Infinity : (halfW + chip.halfW + CHIP_GAP) / Math.abs(cos)
  const needY =
    Math.abs(sin) < 1e-6 ? Infinity : (halfH + chip.halfH + CHIP_GAP) / Math.abs(sin)
  const start = Math.min(needX, needY)

  const reserved = centre ? expand(centre, CHIP_GAP) : null
  const blocked = seats.map((s) => expand(s, CHIP_GAP))
  // What this spot costs, in pixels of covered content. Everything is padded by
  // the gap, so grazing the breathing room around a seat is cheap and actually
  // covering it is not.
  const cost = (cx: number, cy: number) => {
    const box = chipBox(cx, cy, chip)
    let total = reserved ? BOARD_WEIGHT * overlapArea(box, reserved) : 0
    for (const s of blocked) total += overlapArea(box, s)
    return total
  }

  // Sideways along the ring, for the tables where there is no room straight in.
  const tanX = -sin
  const tanY = cos
  // Never search past the middle of the table: the far side belongs to the
  // players sitting there.
  const toMiddle = Math.hypot(c.x - table.w / 2, c.y - table.h / 2)

  let best = { x: c.x - cos * start, y: c.y - sin * start, cost: Infinity }

  for (let pushed = 0; start + pushed <= Math.min(start + MAX_PUSH, toMiddle); pushed += PUSH_STEP) {
    const cx = c.x - cos * (start + pushed)
    const cy = c.y - sin * (start + pushed)
    for (let slide = 0; slide <= MAX_SLIDE; slide += SLIDE_STEP) {
      for (const dir of slide === 0 ? [1] : [1, -1]) {
        const sx = cx + tanX * slide * dir
        const sy = cy + tanY * slide * dir
        const spent = cost(sx, sy)
        if (spent === 0) return { left: `${sx}px`, top: `${sy}px` }
        if (spent < best.cost) best = { x: sx, y: sy, cost: spent }
      }
    }
  }

  return { left: `${best.x}px`, top: `${best.y}px` }
}

/**
 * Deep stacks in full are wider than the lane they have to sit in: "24,500" is
 * a 68px pill, and on a 320px phone that is most of the gap between a seat and
 * the board. Shortening past five figures is what a real table does with a
 * stack of chips anyway — you read the colour, not the count.
 */
function betLabel(amount: number) {
  if (amount < 10_000) return amount.toLocaleString()
  const thousands = amount / 1000
  const rounded = thousands < 100 ? thousands.toFixed(1).replace(/\.0$/, "") : Math.round(thousands)
  return `${rounded}k`
}

function BetChip({ amount }: { amount: number }) {
  return (
    <div className="flex items-center gap-1 rounded-full bg-background/85 px-2 py-0.5 shadow-md ring-1 ring-primary/30 backdrop-blur">
      <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden />
      <span
        className="font-mono text-[11px] font-bold leading-none text-primary"
        title={amount.toLocaleString()}
      >
        {betLabel(amount)}
      </span>
    </div>
  )
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

  // Measure the table and the pot/board block so chips can be kept off them.
  const tableRef = useRef<HTMLDivElement>(null)
  const centreRef = useRef<HTMLDivElement>(null)
  // Every seat is measured, not one of them: the blind and to-act badges make
  // some seats taller than others, and a chip stepped off the wrong size lands
  // on the seat next door.
  const seatRefs = useRef<(HTMLDivElement | null)[]>([])
  const chipRefs = useRef<(HTMLDivElement | null)[]>([])
  const [geometry, setGeometry] = useState<{
    table: { w: number; h: number }
    centre: Box | null
    seats: SeatSize[]
    chips: (SeatSize | undefined)[]
  }>({ table: { w: 0, h: 0 }, centre: null, seats: [], chips: [] })

  // The seats have to be measured before a chip can be placed, and a chip has
  // to be on screen before it can be measured — so the first pass sizes the
  // seats, the second sizes the chips it just drew.
  const measured = geometry.seats.length === ordered.length
  const bets = ordered.map((p) => p.bet).join(",")

  useLayoutEffect(() => {
    const measure = () => {
      const table = tableRef.current
      if (!table) return
      const t = table.getBoundingClientRect()
      let centre: Box | null = null
      if (centreRef.current) {
        const c = centreRef.current.getBoundingClientRect()
        centre = {
          left: c.left - t.left,
          top: c.top - t.top,
          right: c.right - t.left,
          bottom: c.bottom - t.top,
        }
      }
      setGeometry({
        table: { w: t.width, h: t.height },
        centre,
        seats: ordered.map((_, i) => {
          const s = seatRefs.current[i]?.getBoundingClientRect()
          return s
            ? { halfW: s.width / 2, halfH: s.height / 2 }
            : { halfW: SEAT_HALF_W, halfH: SEAT_HALF_H }
        }),
        chips: ordered.map((_, i) => {
          const c = chipRefs.current[i]?.getBoundingClientRect()
          return c ? { halfW: c.width / 2, halfH: c.height / 2 } : undefined
        }),
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    const watched = [
      tableRef.current,
      centreRef.current,
      ...seatRefs.current,
      ...chipRefs.current,
    ]
    for (const el of watched) {
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
    // The centre block resizes as cards land, so re-measure on every street;
    // `bets` catches a chip growing a digit, `measured` the pass that first
    // put the chips on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.board.length, ordered.length, bets, measured])

  // Seat boxes in the same pixel space as the chips, so a chip can be tested
  // against the ones it must not cover.
  const seatBoxes =
    geometry.table.w > 0 && measured
      ? ordered.map((_, i) => seatBox(i, ordered.length, geometry.table, geometry.seats[i]))
      : null
  // Only a real showdown puts hands on the table. A pot won by folding ends in
  // "handover" too, and inferring from the phase would flip the winner's own
  // cards face up for whoever is sitting next to them.
  const showdown = view.wentToShowdown

  return (
    // Taller than a 3:4 box on phones: nine seats need the vertical room, or
    // the pairs flanking the top corners run into each other.
    <div
      ref={tableRef}
      className="relative mx-auto aspect-[3/4.4] w-full max-w-sm sm:aspect-[3/2] sm:max-w-3xl"
    >
      {/* Felt */}
      <div className="absolute inset-4 rounded-[45%] border-8 border-[#4a2c17] bg-[radial-gradient(ellipse_at_center,hsl(150_45%_22%),hsl(150_50%_14%))] shadow-[inset_0_0_60px_rgba(0,0,0,0.6)]">
        <div className="absolute inset-6 rounded-[45%] border border-accent/20" />
      </div>

      {/* Center: pot + board. */}
      <div className="absolute left-1/2 top-[42%] flex w-full -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2 px-2">
        {/* Measured as the reserved middle of the table, so it hugs its
            contents rather than spanning the full width. */}
        <div ref={centreRef} className="flex w-fit flex-col items-center gap-2">
          <div className="rounded-full bg-background/70 px-4 py-1 text-center backdrop-blur">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Pot</span>
            <div className="font-mono text-lg font-bold text-accent">{view.pot.toLocaleString()}</div>
          </div>
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
        {view.message && (
          <div className="max-w-[16rem] text-balance rounded-lg bg-background/80 px-3 py-1 text-center text-xs text-foreground backdrop-blur">
            {view.message}
          </div>
        )}
      </div>

      {/* Chips wagered this street, out on the felt in front of each player.
          Held back until the table has been measured, since their position is
          derived from it. */}
      {ordered.map((p, i) =>
        p.bet > 0 && seatBoxes ? (
          <div
            key={`bet-${p.id}`}
            ref={(el) => {
              chipRefs.current[i] = el
            }}
            className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
            style={betOffset(
              i,
              ordered.length,
              geometry.table,
              geometry.centre,
              seatBoxes,
              geometry.chips[i] ?? { halfW: CHIP_HALF_W, halfH: CHIP_HALF_H },
            )}
          >
            <BetChip amount={p.bet} />
          </div>
        ) : null,
      )}

      {/* Seats */}
      {ordered.map((p, i) => (
        <div
          key={p.id}
          // Measured so chips know how far to step around this seat.
          ref={(el) => {
            seatRefs.current[i] = el
          }}
          className="absolute -translate-x-1/2 -translate-y-1/2"
          style={seatPosition(i, ordered.length)}
        >
          <PlayerSeat
            player={p}
            showdown={showdown}
            revealed={revealed}
            secondsLeft={p.isActor ? secondsLeft : null}
            actionSeconds={view.actionSeconds}
          />
        </div>
      ))}
    </div>
  )
}
