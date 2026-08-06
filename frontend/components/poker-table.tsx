"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

import { PlayingCard } from "@/components/playing-card"
import { PlayerSeat } from "@/components/player-seat"
import { PotDisplay } from "@/components/pot-display"
import { ChipStack } from "@/components/chip-stack"
import { latestLine } from "@/lib/action-line"
import { announce } from "@/lib/sound"
import { useBoardsEntrance } from "@/lib/board-entrance"
import { boardWinner } from "@/lib/showdown"
import { baizeOf, deckOf } from "@/lib/table-style"
import { closedByABet, diffViews, newActions, potGrowth } from "@/lib/table-events"
import { dealBeats } from "@/lib/deal"
import { useReducedMotion } from "@/lib/use-reduced-motion"
import { useShowdown } from "@/lib/use-showdown"
import {
  BET_MS,
  betToFelt,
  calledPart,
  centreOf,
  payoutFromPot,
  sweepLeadIn,
  sweepStart,
  sweepToPot,
  type Flight,
} from "@/lib/chip-flight"
import {
  BET_CHIPS,
  BOARD_CARD_H,
  BOARD_CARD_W,
  BOARD_WINNER_H,
  betLabel,
  betSpot,
  boxAt,
  crowded,
  estimateBetSize,
  estimateSeatSize,
  placeBets,
  CHIP_W,
  POT_PILE_COLUMNS,
  POT_PILE_OVERLAP,
  potPileTall,
  seatChips,
  seatBox,
  seatCentre,
  RAIL_MARGIN,
  SAID_H,
  tableBox,
  tableScale,
  type Box,
  type Point,
  type SeatHand,
  type Size,
  type TableSize,
} from "@/lib/table-layout"
import type { GameView, PlayerView } from "@/lib/poker-api"

/**
 * How tall somebody's stack stands.
 *
 * Not their chip count — that is the number under their name, and a hundred
 * discs beside every seat is a table nobody can read. This is how *deep* they
 * are, which is the thing you read across a table before you read anything.
 *
 * It used to be `share * most * 0.6 + 1` against a ceiling of five, and that
 * arithmetic is the whole complaint: a chip leader with four times the table
 * got five discs and somebody nearly out got three. Two chips of difference to
 * express the entire spread of a tournament, so every seat looked the same and
 * the felt said nothing.
 *
 * A starting stack now stands at about a third of the ceiling. That is the
 * number that makes the scale work by itself: with nobody buying anything,
 * chips are conserved and the *average* stack is the starting stack, so the
 * middle of the table sits at a third and there is as much room to grow into
 * as there is to fall from. Doubling up is visible. Being crippled is visible.
 * Nobody has to decide anything per level.
 *
 * Rebuys, add-ons and late entries all put fresh chips on the table, so the
 * average drifts up and every stack reads a little shorter than it did. That
 * is a slow, table-wide drift rather than a wrong answer — the ceiling and the
 * clamp both still hold — and correcting for it would mean the same stack
 * changing height because somebody else bought in, which is worse.
 */
function stackHeight(chips: number, startingChips: number, table: TableSize) {
  if (chips <= 0) return 0
  const share = startingChips > 0 ? chips / startingChips : 1
  // The ceiling is the table's, not this function's — see `seatChips`.
  const most = seatChips(table)
  return Math.max(1, Math.min(most, Math.round(share * most * 0.34)))
}

/**
 * The mound of chips in the middle, as a number of short columns.
 *
 * Measured in big blinds, because that is the only unit in which "how big is
 * that pot" means anything — five thousand is a monster on a table with 25/50
 * blinds and a limp on a table with 2,000/4,000. It grows sideways rather than
 * upwards for the reason in `POT_PILE_COLUMNS`: height in the middle of the
 * table belongs to the flanking seats, and width across it is free.
 */
function potColumns(pot: number, bigBlind: number): number {
  if (pot <= 0) return 0
  const blinds = bigBlind > 0 ? pot / bigBlind : 0
  if (blinds >= 60) return POT_PILE_COLUMNS
  if (blinds >= 25) return 3
  return blinds >= 8 ? 2 : 1
}

/**
 * The pot, as chips on the cloth.
 *
 * Columns pushed into each other rather than laid out in a row, which is what
 * makes it a mound and not a bar chart — and it is what a dealer's pot actually
 * looks like, because they are stacking with one hand while the other one is
 * still raking.
 *
 * The colours come from what the pot is *made of* (`chipColumn`, by value), so
 * a big pot goes gold and blue on its own without anybody deciding a threshold.
 */
function PotPile({
  amount,
  columns,
  tall,
  u,
}: {
  amount: number
  columns: number
  tall: number
  u: number
}) {
  if (columns <= 0 || amount <= 0) return null
  // Each column carries its share, so the denominations spread across the mound
  // instead of every column being a copy of the same stack.
  const share = Math.max(1, Math.round(amount / columns))
  return (
    <div className="flex justify-center" aria-hidden>
      {Array.from({ length: columns }, (_, i) => (
        <ChipStack
          key={i}
          amount={share}
          exactly={tall}
          u={u}
          // Negative margin, not absolute positioning: the row has to measure
          // as wide as the mound actually is, because `estimateCentreBox`
          // reserves the middle and a block that measures narrower than it
          // draws is the divergence the matrix cannot see.
          style={i === 0 ? undefined : { marginLeft: -POT_PILE_OVERLAP * u }}
        />
      ))}
    </div>
  )
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

/**
 * One lot of chips crossing the felt.
 *
 * Two nested elements and two properties, which is the whole trick: the outer
 * one translates in a straight line and the inner one hops, and a straight line
 * plus a hop is an arc. Both go to the compositor, so nine of these at once is
 * something an old phone can do.
 *
 * The starting position is written, then read back, then the ending one is
 * written. That read is not redundant: without forcing the layout in between,
 * the browser coalesces the two writes and the chip is simply at the end, and
 * `requestAnimationFrame` — the obvious alternative — does not fire at all when
 * the tab is behind, which leaves the chip nailed to the felt halfway across.
 */
function ChipFlight({
  flight,
  u,
  onDone,
}: {
  flight: Flight
  u: number
  onDone: (key: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.transition = "none"
    // Not on the felt until the chips it draws are standing somewhere. A
    // delayed transition holds the element at its starting point, so a rake
    // waiting on the bet that closed the street was already sitting in the
    // bet's spot while the bet was still flying towards it: the same chips on
    // screen twice, one of them waiting for the other to arrive. Switching the
    // opacity on the departure delay fixed that and opened the opposite hole —
    // a rake is created when the server clears the felt and leaves up to eight
    // hundred milliseconds later, and in between the money was nowhere at all.
    // So it is its own moment: see `Flight.seenAt`.
    el.style.opacity = "0"
    el.style.transform = `translate(${flight.from.x}px, ${flight.from.y}px)`
    void el.offsetWidth
    el.style.transition =
      `transform ${flight.ms}ms cubic-bezier(.32,.72,.36,1) ${flight.delay}ms,` +
      ` opacity 0ms linear ${flight.seenAt ?? flight.delay}ms`
    el.style.opacity = "1"
    el.style.transform = `translate(${flight.to.x}px, ${flight.to.y}px)`
    const timer = setTimeout(() => onDone(flight.key), flight.ms + flight.delay + 40)
    return () => clearTimeout(timer)
    // One flight, one animation. Re-running it would restart a chip mid-air.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={ref}
      // What these chips are and which hand they belong to, in the same spirit
      // as `data-piece`: the order money moves in is most of what this file is
      // about, and a check running in a real browser has no other way to ask
      // whether the rake went before the payout.
      data-flight={flight.key}
      className="pointer-events-none absolute left-0 top-0 z-30 will-change-transform"
      aria-hidden
    >
      {/* The centring is written out rather than reached for with
          `-translate-x-1/2`: in Tailwind v4 that utility sets the `translate`
          property, which is the property the hop animates, and the two would be
          fighting over one slot. `transform` and `translate` are separate
          properties and compose, which is exactly what is wanted here. */}
      <div
        className="chip-hop"
        style={
          {
            transform: "translate(-50%, -50%)",
            "--arc": `${-flight.arc}px`,
            animationDuration: `${flight.ms}ms`,
            animationDelay: `${flight.delay}ms`,
          } as React.CSSProperties
        }
      >
        <ChipStack amount={flight.amount} max={BET_CHIPS} u={u} />
      </div>
    </div>
  )
}

/**
 * One card crossing the felt: out of the button on a deal, or into the middle
 * on a muck.
 */
interface Pitch {
  key: string
  from: Point
  to: Point
  delay: number
  /**
   * A hand being thrown away rather than dealt.
   *
   * The difference is not decoration. A dealt card arrives — it grows into
   * place and stays. A mucked one *leaves*: it slides away, turns as it goes
   * and is gone before it gets there, because nobody ever sees where a folded
   * hand ends up. Drawing them the same way would make folding look like being
   * dealt in.
   */
  muck?: boolean
}

/**
 * A card being pitched across the felt.
 *
 * Face down and never anything else — what is on it is nobody's business until
 * its owner picks it up, and a card that flips over on the way there tells the
 * whole table what everyone was dealt.
 *
 * No hop, unlike a chip: a dealt card is *skimmed* along the cloth, and giving
 * it an arc makes it a thrown object. The spin is the whole of the flourish, and
 * it is one property.
 */
function DealtCard({
  pitch,
  u,
  onDone,
}: {
  pitch: Pitch
  u: number
  onDone: (key: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ms = pitch.muck ? MUCK_MS : PITCH_MS
    el.style.transition = "none"
    el.style.transform = pitch.muck
      ? `translate(${pitch.from.x}px, ${pitch.from.y}px)`
      : `translate(${pitch.from.x}px, ${pitch.from.y}px) scale(.7)`
    el.style.opacity = pitch.muck ? "1" : "0"
    // Same reason as `ChipFlight`: two writes with no read between them get
    // coalesced, and rAF does not fire at all with the tab behind.
    void el.offsetWidth
    el.style.transition = pitch.muck
      ? `transform ${ms}ms cubic-bezier(.4,0,.7,.4) ${pitch.delay}ms, opacity ${ms}ms ease-in ${pitch.delay}ms`
      : `transform ${ms}ms cubic-bezier(.22,.66,.3,1) ${pitch.delay}ms, opacity 90ms linear ${pitch.delay}ms`
    // A mucked hand stops short of the middle and turns as it goes, and is
    // gone before it lands — nobody at a table ever sees where a folded hand
    // ends up, and drawing it arriving would make folding look like being
    // dealt in backwards.
    el.style.transform = pitch.muck
      ? `translate(${pitch.from.x + (pitch.to.x - pitch.from.x) * 0.55}px, ${
          pitch.from.y + (pitch.to.y - pitch.from.y) * 0.55
        }px) rotate(-14deg)`
      : `translate(${pitch.to.x}px, ${pitch.to.y}px) scale(1)`
    el.style.opacity = pitch.muck ? "0" : "1"
    const timer = setTimeout(() => onDone(pitch.key), ms + pitch.delay + 30)
    return () => clearTimeout(timer)
    // One pitch, one flight. Re-running it would restart a card mid-air.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute left-0 top-0 z-30 will-change-transform"
      aria-hidden
    >
      <div style={{ transform: "translate(-50%, -50%)" }}>
        <PlayingCard
          card={null}
          faceDown
          size="xs"
          style={{ width: 14 * u, height: 20 * u }}
        />
      </div>
    </div>
  )
}

/** How long one card takes to reach its seat. */
const PITCH_MS = 300
/** And how long a folded one takes to leave. Slower: it is a decision. */
const MUCK_MS = 480

/**
 * What somebody has pushed in this street.
 *
 * Real chips and the bare figure on the cloth — no pill behind it. The dark
 * rounded plate this used to sit in was the single thing that made the felt
 * read as a screen: chips are objects on a table, and putting a label around
 * them turns them into an annotation of a table instead.
 */
function BetChip({ amount, u }: { amount: number; u: number }) {
  return (
    <ChipStack amount={amount} max={BET_CHIPS} label={betLabel(amount)} u={u} />
  )
}

/**
 * One community card, and its arrival.
 *
 * The animation lives on a wrapper so the card itself stays a card. That also
 * keeps the transform off the measured box — a scaling child does not change
 * its parent's layout, so the middle of the table holds still while the flop
 * comes out, and nothing gets re-placed against a box that is mid-flight.
 */
function BoardCard({
  card,
  delay,
  u,
  lit,
  dim,
}: {
  card: string
  delay: number | null
  u: number
  /** One of the five that made the winning hand, and its moment has come. */
  lit?: boolean
  /** The winning five are being picked out, and this is not one of them. */
  dim?: boolean
}) {
  const face = (
    <PlayingCard
      card={card}
      size="xs"
      // Stated, not inferred from the shadow below. Same reason `data-piece`
      // exists: the lighting is a beat in a sequence, and a check running in a
      // real browser has to be able to ask when it happened without reading a
      // box-shadow back out of a computed style and hoping.
      data-lit={lit ? 'true' : undefined}
      // Sized off the table, not off a viewport breakpoint. Five cards have to
      // clear the seats on the flanks, and the seats are a share of the table —
      // so the board is one too. See BOARD_CARD_W.
      style={{
        width: BOARD_CARD_W * u,
        height: BOARD_CARD_H * u,
        fontSize: 13 * u,
        // Picked out by *lighting*, not by moving: five cards jumping up out of
        // a row of five is five separate events, and this is one. Opacity and a
        // ring, both cheap, both reversible the instant the next hand starts.
        opacity: dim && !lit ? 0.32 : 1,
        boxShadow: lit
          ? `0 0 0 ${1.5 * u}px var(--accent), 0 0 ${10 * u}px rgba(0,0,0,.55)`
          : undefined,
        transition: "opacity 220ms ease-out, box-shadow 220ms ease-out",
      }}
    />
  )
  if (delay == null) return face
  return (
    <div
      className="card-arriving relative"
      style={{ animationDelay: `${delay}ms` }}
    >
      {face}
      {/* The back, on top, until the card is edge-on. */}
      <div
        className="card-arriving-back absolute inset-0"
        style={{ animationDelay: `${delay}ms` }}
        aria-hidden
      >
        <PlayingCard
          card={null}
          faceDown
          size="xs"
          style={{ width: BOARD_CARD_W * u, height: BOARD_CARD_H * u }}
        />
      </div>
    </div>
  )
}

/**
 * What a seat is holding, from the same three conditions `PlayerSeat` draws it
 * from — so the estimate a seat is placed with before it has been measured is
 * the size it is about to turn out to be, rather than the size an average seat
 * would have been.
 */
/**
 * What the winner had, in words, or null for everybody else.
 *
 * Only the winner: naming every hand at the table turns the fifth beat of a
 * showdown into a wall of text, and the question the table is asking at that
 * moment has one answer.
 */
function handNameOf(view: GameView, playerId: string): string | null {
  const result = view.lastResults.find((r) => r.playerId === playerId)
  return result && result.won > 0 ? (result.handName ?? null) : null
}

function handOf(p: PlayerView, revealed: boolean, showdown: boolean): SeatHand {
  const hidden = p.isYou && !revealed && !(showdown && !p.folded)
  if (!hidden && p.cards) return 'up'
  return p.cardsCount > 0 ? 'down' : 'none'
}

interface Geometry {
  centre: Box | null
  /**
   * The mound of chips under the board — where the pot actually sits.
   *
   * Measured separately from the centre block because it is where money goes.
   * The centre of the *block* is the board, so chips raked into it flew across
   * the community cards and stopped on top of them: a pot that lands on the
   * one thing everybody at the table is reading.
   */
  pile: Box | null
  seats: Size[]
  bets: (Size | undefined)[]
}

export function PokerTable({
  view,
  revealed = false,
  secondsLeft = null,
  boardCompleteMs = 0,
  audible = false,
}: {
  view: GameView
  /** The viewer is holding the peek control, so their own cards are up. */
  revealed?: boolean
  /** Seconds left for the player currently to act. */
  secondsLeft?: number | null
  /**
   * When the board will finish being dealt out card by card (`use-runout`).
   *
   * The order of an all-in is hands first, then the board, then the answer: the
   * hands turn over on their own beats, the run-out plays over them, and only
   * the winning five lighting up and the pot going out wait for the last card.
   * See `Runout.boardCompleteMs`.
   */
  boardCompleteMs?: number
  /** Whether the table may make a noise. Off is off. */
  audible?: boolean
}) {
  // Reorder players so that "you" is always at the bottom of the ring.
  const players = view.players
  const youIdx = players.findIndex((p) => p.isYou)
  const ordered: PlayerView[] =
    youIdx >= 0 ? [...players.slice(youIdx), ...players.slice(0, youIdx)] : players
  const total = ordered.length

  // The room the table has been given. Measured rather than assumed, because it
  // is whatever the header and your own zone left behind — and it changes when
  // the keyboard opens, the URL bar slides away, or the phone is turned.
  const zoneRef = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState<Size>({ w: 0, h: 0 })
  const tableRef = useRef<HTMLDivElement>(null)
  const centreRef = useRef<HTMLDivElement>(null)
  const pileRef = useRef<HTMLDivElement>(null)
  // Every seat is measured, not one of them: the blind and to-act badges make
  // some seats taller than others, and a chip stepped off the wrong size lands
  // on the seat next door.
  const seatRefs = useRef<(HTMLDivElement | null)[]>([])
  const betRefs = useRef<(HTMLDivElement | null)[]>([])
  const [geometry, setGeometry] = useState<Geometry>({
    centre: null,
    pile: null,
    seats: [],
    bets: [],
  })

  // The table's box, worked out rather than measured — and that is the whole
  // point, not a shortcut.
  //
  // It used to be measured off the div, which meant two state hops between the
  // room changing and the seats knowing about it: `room` set the div's size on
  // one render, and the seats only learned the new size on the *next* one, from
  // a ResizeObserver reading back a number we had just written. So for a frame
  // — and on a rotation, until something else happened to fire the observer —
  // nine seats were being walked round a ring computed for the table that had
  // just stopped existing. It looked exactly like a layout bug and it was a
  // sequencing one.
  //
  // Its shape is a range now (see ASPECT_MIN/MAX), so it is set in pixels from
  // the room it has, and that same box is what everything on the felt is
  // stepped off. One source, no lag.
  const box = tableBox(room.w + RAIL_MARGIN * 2, room.h)

  // Only a real showdown puts hands on the table. A pot won by folding ends in
  // "handover" too, and inferring from the phase would flip the winner's own
  // cards face up for whoever is sitting next to them.
  const showdown = view.wentToShowdown

  /**
   * Every board on the felt — one on almost every hand, two when it is run
   * twice.
   *
   * Read from `boards` and not from `board`, and this is the whole of what was
   * missing: the server has always sent both, and the felt has always drawn
   * `boards[0]`. A hand run twice showed one run-out and then a results panel
   * announcing that the other half of the pot went somewhere else, on the
   * strength of five cards nobody ever saw dealt.
   */
  const boards = view.boards?.length ? view.boards : [view.board]
  const boardRows = boards.length

  // The showdown, beat by beat: which hands have turned over, which of the
  // winning five are lit, and whether the rest should be standing back.
  const beats = useShowdown(view, ordered, boardCompleteMs)
  // Per seat, because they no longer all turn over at once.
  const shownDown = ordered.map((_, i) => showdown && beats.shown(i))
  // Named once the hand has finished being told, and not before: the results
  // arrive from the server while `use-runout` is still holding the river back,
  // so read straight they would announce the winner over an unfinished board.
  const boardWinners = boards.map((_, b) => boardWinner(view.boardResults ?? [], b))

  /**
   * A hand coming face up, heard.
   *
   * The one sound the table makes that no comparison of two server responses
   * could ever find: the reveal runs on a clock here, and to the server the
   * whole showdown is a single response. So `flip` sat in the sound bank with
   * nothing to play it, and the loudest four seconds of the night went by in
   * silence.
   *
   * Nothing sounds on the hand this client walked in on. The count jumps
   * straight to every hand at once there, which is not a reveal — it is
   * arriving after one.
   */
  const faceUp = shownDown.filter(Boolean).length
  const heard = useRef({ hand: 0, count: 0 })
  useEffect(() => {
    const before = heard.current
    heard.current = { hand: view.handNumber, count: faceUp }
    if (before.hand !== view.handNumber) return
    if (audible && faceUp > before.count) announce("flip")
  }, [faceUp, view.handNumber, audible])

  const measured = geometry.seats.length === total
  const bets = ordered.map((p) => p.bet).join(",")
  // Turning a hand over grows a seat, and everything placed against that seat
  // was placed against a box that has just stopped existing. This is the
  // relayout trigger that gets forgotten, and the one that actually breaks
  // things — the other three are obvious enough to remember.
  //
  // The showdown beat is in here too, and it has to be. Hands now turn over one
  // at a time rather than all at once, so a seat grows *between* two polls with
  // nothing else about the view having changed — and every chip placed against
  // that seat a moment ago is now placed against a box that has stopped
  // existing. This is the relayout trigger the plan warns gets forgotten, in the
  // one new place it can fire.
  const shown = ordered
    .map((p, i) => `${p.cards ? p.cards.length : 0}${shownDown[i] ? 'x' : ''}`)
    .join(",")

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
      const zone = zoneRef.current
      const table = tableRef.current
      if (!zone || !table) return
      const z = zone.getBoundingClientRect()
      setRoom({ w: z.width, h: z.height })
      // Still read off the table's own rect, because these are positions
      // *within* it — but its size is `box`, not this rectangle.
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
        centre: relative(centreRef.current),
        pile: relative(pileRef.current),
        seats: ordered.map(
          (p, i) =>
            sizeOf(seatRefs.current[i]) ??
            estimateSeatSize({
              table: { w: t.width, h: t.height },
              seats: total,
              revealed,
              hand: handOf(p, revealed, shownDown[i]),
            }),
        ),
        bets: ordered.map((_, i) => sizeOf(betRefs.current[i])),
      }
      setGeometry(next)
    }

    measure()
    const observer = new ResizeObserver(measure)
    const watched = [
      zoneRef.current,
      tableRef.current,
      centreRef.current,
      pileRef.current,
      ...seatRefs.current,
      ...betRefs.current,
    ]
    for (const el of watched) {
      if (el) observer.observe(el)
    }

    // And the window itself, which a ResizeObserver on an element inside it can
    // miss. The case that matters is not somebody turning a laptop window: it is
    // the mobile URL bar sliding away, which changes `svh` under the whole
    // layout without any element being resized by a layout the observer sees.
    // `visualViewport` is the one that fires for it; `resize` covers rotation
    // and the browsers that do not have it.
    window.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('resize', measure)
    }
    // The five things that move everything: the board growing, a *second*
    // board appearing under it, the table emptying, a bet changing width — and
    // a seat changing size, which is the one that gets left out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.board.length, boardRows, total, bets, shown, measured])

  const table = box
  const live = room.w > 0 && measured
  // The scale everything on the felt is drawn at. One number, read straight off
  // the table's own measured width — so a table squeezed into a short screen is
  // the same table smaller, not the same pieces on a smaller ring.
  const u = tableScale(table)

  // ---- Compute. Pure, from the measurements above, and nothing is written
  // to the document until React renders the result. ----
  const seatSizes = geometry.seats
  const seatBoxes = live
    ? ordered.map((_, i) => seatBox(i, total, table, seatSizes[i]))
    : null

  // The same call the model makes, so the matrix is checking this table and not
  // a near relative of it. Measured sizes where there are any — that is the
  // whole difference between the two callers, and it is why sizes arrive as a
  // question rather than as a list.
  const betSizeOf = (i: number) =>
    ordered[i].bet > 0
      ? (geometry.bets[i] ?? estimateBetSize(ordered[i].bet, table))
      : null
  const betPlacements: (Point | null)[] = seatBoxes
    ? placeBets(total, table, seatBoxes, geometry.centre, betSizeOf)
    : []

  /**
   * What the hand is worth right now — collected *and* on the cloth.
   *
   * The server's `pot` is what has been swept in, which is the engine's honest
   * answer and the wrong one to put in the middle of a table: it means the
   * number sits still through a whole street of betting and then jumps when the
   * street closes, so the one figure everybody is playing for is the one figure
   * that is never current. Adding the live bets makes it the total, which is
   * what anybody at a table means by "the pot" — and it also makes the sweep
   * read correctly, because the number holds still while the chips move into
   * it, which is exactly what happens on a real table.
   */
  /**
   * The hand whose pot is still stacked in the middle, waiting to go out.
   *
   * Set when the hand ends and cleared at the instant the payout starts
   * moving, because the mound and the arc are the same money. `pot` goes to
   * zero the moment the engine pushes, so the middle first emptied several
   * seconds too early — and then, once `potAtEnd` held it there, it did not
   * empty at all: the chips flew to the winner and an identical pile stayed
   * behind, so the pot was paid twice and one of the two never moved.
   *
   * Null on a hand this client walked in on and with reduced motion, where
   * nothing crosses the felt and the middle is simply where it ends up: empty.
   */
  const [middleHolds, setMiddleHolds] = useState<number | null>(null)
  const inTheMiddle = view.pot || (middleHolds === view.handNumber ? view.potAtEnd : 0)
  const middlePot = inTheMiddle + ordered.reduce((sum, p) => sum + p.bet, 0)

  // The table's own voice. During a hand it is the last decision — the thing a
  // real table says out loud and the app used to swallow, which is why nobody
  // who was looking at their own cards knew where the action was. Once the
  // hand is settled the only thing worth saying is who won it.
  const said =
    view.phase === "hand" ? latestLine(view.actions, view.players) : view.message

  // ---- Movement ----
  //
  // The transport already existed: `diffViews` turns two polled snapshots back
  // into the moments between them, and has been driving the sound since V3. The
  // same list drives the chips. One derivation, so what you hear and what you
  // see can never be two different accounts of the same hand.
  const reduced = useReducedMotion()
  const previousView = useRef<GameView | null>(null)
  /**
   * The felt as it last stood, with something on it.
   *
   * A sweep has to start from where the chips *were*, and by the time the
   * server says the street closed they are already gone from the view. So the
   * last non-empty arrangement is kept, and it is deliberately not cleared by
   * an empty one — an empty felt is the thing we are trying to animate away
   * from, not a new state to remember.
   */
  const lastFelt = useRef<{ key: string; at: Point; amount: number }[]>([])
  /**
   * A number that never repeats, stamped into every flight key.
   *
   * A key has one job here: to tell React that these chips are not the ones it
   * drew a moment ago. Built out of the player and the amount it failed at
   * that — a player calling 300 on the flop and 300 on the turn produced the
   * same key twice, React reused the element, and its effect does not re-run
   * (by design: re-running restarts a chip in mid-air), so the second rake
   * simply never moved.
   */
  const flightGen = useRef(0)
  /**
   * The pot, worked out and waiting for the showdown to finish telling itself.
   *
   * Computed where the moment happens — the geometry it needs is the geometry
   * of *that* frame — and released by the beat that ends the hand.
   */
  const owed = useRef<Flight[] | null>(null)

  /**
   * How long the next board card waits before it lands.
   *
   * Written by the movement effect below, which is the only place that knows
   * whether there is a rake for the card to land into and whether that rake is
   * itself waiting on a bet. Passed as a getter rather than a number so it is
   * read when the cards arrive — the effect that sets it is a layout effect and
   * has already run by then, and reading a ref during a render is reading a
   * value that belongs to the last one.
   */
  const boardLead = useRef(0)

  // Which board cards are landing right now, and on what beat. Null for the
  // ones that were already there — somebody opening the app mid-hand is
  // looking at a flop, not watching one being dealt.
  const arriving = useBoardsEntrance(boards, () => boardLead.current)
  const [flights, setFlights] = useState<Flight[]>([])
  const dropFlight = useCallback(
    (key: string) => setFlights((all) => all.filter((f) => f.key !== key)),
    [],
  )
  // Whose bet is currently in the air, so the spot it is heading for can wait
  // for it rather than drawing the same chips a second time.
  const inFlight = new Set(
    flights.flatMap((f) => (f.seat === undefined ? [] : [f.seat])),
  )
  /**
   * What is actually stacked in the middle: the pot, less whatever is still
   * crossing the felt towards it.
   *
   * The same rule as `inFlight` and the same reason, at the other end of the
   * journey. The server's `pot` is the total the instant the street closes, so
   * the mound was drawn at its new size while the chips that made it new were
   * still in the air — the bets vanished from in front of the players, the
   * middle grew, and only then did the rake set off, delivering money that had
   * already arrived. Subtracting the flights makes the mound grow as they land,
   * one lot at a time, which is what a pot being raked in looks like.
   *
   * The pill above is untouched by this: what the hand is worth does not stop
   * being true because the chips are between two places.
   */
  const stacked = Math.max(
    0,
    inTheMiddle - flights.reduce((n, f) => (f.toPot ? n + f.amount : n), 0),
  )
  const [pitches, setPitches] = useState<Pitch[]>([])
  const dropPitch = useCallback(
    (key: string) => setPitches((all) => all.filter((p) => p.key !== key)),
    [],
  )

  /**
   * The pot leaving the middle: the arc, the mound that stops being there, and
   * the sound of it.
   *
   * One function because they are one event. The mound goes when the chips
   * *start moving* rather than when they are created, which is not the same
   * instant: a pot won by folding is paid in the same response that rakes the
   * last bets in, so its arc waits for that rake to land. Emptying the middle
   * on creation would leave a gap where the pot is nowhere at all.
   *
   * The sound is here for the same reason and it was not: `useTableEvents`
   * played it on the response that ended the hand, and the chips wait for the
   * showdown to finish telling itself — one hand turning over is a second and a
   * half of that, nine is nearly five, and an all-in adds a runout on top. So
   * the pot was heard being won while everybody was still looking at the cards.
   */
  const emptying = useRef<ReturnType<typeof setTimeout> | null>(null)
  const payOut = useCallback(
    (payout: Flight[]) => {
      setFlights((all) => [...all, ...payout])
      const leaves = Math.min(...payout.map((f) => f.delay))
      if (emptying.current) clearTimeout(emptying.current)
      const gone = () => {
        setMiddleHolds(null)
        if (audible) announce("potWon")
      }
      if (leaves <= 0) gone()
      else emptying.current = setTimeout(gone, leaves)
    },
    [audible],
  )
  useEffect(
    () => () => {
      if (emptying.current) clearTimeout(emptying.current)
    },
    [],
  )

  useLayoutEffect(() => {
    const previous = previousView.current
    previousView.current = view
    const events = previous ? diffViews(previous, view) : []
    const gen = ++flightGen.current
    // Whether the rake is waiting on a bet to land first — the one question
    // this whole sequence is built on. See `closedByABet`.
    const lateBet = closedByABet(previous, view)
    // What the board is told, before anything below can return early: with no
    // rake to land into there is nothing to wait for, and that includes a
    // player who has asked for less movement, where no chips are going to
    // cross the felt at all.
    boardLead.current =
      !previous || !geometry.centre || reduced || !events.includes("potCollect")
        ? 0
        : sweepLeadIn(lateBet)
    // Nothing to compare against, nowhere to fly to, or a player who has asked
    // the system for less movement — in which case the chips are simply where
    // they end up, which is what every one of these animations is a picture of.
    if (!previous || !geometry.centre || reduced) return

    // Where the money goes: the mound under the board, not the middle of the
    // block — which is the board itself. Chips were being raked onto the
    // community cards and left sitting on top of them.
    const middle = centreOf(geometry.pile ?? geometry.centre)

    // The deal. Every card comes off the button, one at a time, twice round —
    // which is where cards actually come from, and the only thing on this table
    // that ever refers to the dealer button being where it is.
    if (events.includes("deal")) {
      const button = ordered.findIndex((p) => p.isButton)
      const source = seatCentre(button < 0 ? 0 : button, total, table)
      // Named for what it is rather than `beats`, which in this file is the
      // showdown's — and the same word for two clocks in one effect is how you
      // end up reading the wrong one.
      const perSeat = dealBeats(total, button < 0 ? 0 : button, {
        dealtTo: (i) => ordered[i].cardsCount > 0 || !!ordered[i].cards,
      })
      setPitches(
        perSeat.flatMap((delays, i) =>
          delays.map((delay, card) => ({
            key: `pitch-${view.handNumber}-${i}-${card}`,
            from: source,
            to: seatCentre(i, total, table),
            delay,
          })),
        ),
      )
    }

    // A hand being thrown away. Folding used to be a seat going grey, which is
    // a *state* — and folding is not a state, it is the most common decision
    // anybody makes at a table. The cards go, towards the middle, and are gone
    // before they get there.
    const folded = newActions(previous, view).filter((a) => a.kind === "fold")
    for (const action of folded) {
      const i = ordered.findIndex((p) => p.id === action.playerId)
      if (i < 0) continue
      const from = seatCentre(i, total, table)
      setPitches((all) => [
        ...all,
        ...[0, 1].map((card) => ({
          key: `muck-${action.seq}-${card}`,
          from,
          to: middle,
          // Together, near enough — two cards pushed away are one movement of
          // one hand, not two cards being dealt.
          delay: card * 40,
          muck: true,
        })),
      ])
    }

    // Chips leaving a stack for the felt. The one moment in a hand where money
    // moved and nothing on screen did: a bet used to appear fully formed in
    // front of its owner, which is what made the table read as a scoreboard of
    // a poker game rather than a poker game.
    const pushed = newActions(previous, view).filter(
      (a) => a.kind === "call" || a.kind === "bet" || a.kind === "raise",
    )
    /**
     * Bets that were made and collected inside the same response, with where
     * they briefly stood — so the rake below can start from them.
     *
     * The last player to act closes the street, so the server has already
     * swept their chips by the time we hear about the call. Their `bet` in the
     * view is zero, and this loop used to skip them on exactly that test: the
     * one decision in every betting round that ends it was also the one that
     * never showed any chips moving. The action itself still says what they
     * put out, which is what the felt would have been holding.
     */
    const late: { key: string; at: Point; amount: number; since: number }[] = []
    // Somewhere to put chips the felt no longer has a spot for. The layout only
    // reserves a place for bets that are still standing, which for the bet that
    // closed the street is none — so this asks the same function the layout
    // asks, for the seat and the amount the action says it was.
    const alsoPlaced: Box[] = []
    const spotFor = (i: number, amount: number) => {
      if (betPlacements[i]) return betPlacements[i]
      if (!seatBoxes) return null
      const size = estimateBetSize(amount, table)
      const at = betSpot(i, total, table, seatBoxes, size, geometry.centre, alsoPlaced)
      alsoPlaced.push(boxAt(at, size))
      return at
    }
    /**
     * One push per seat, however many decisions arrived in the response.
     *
     * A poll is more than a second and a raise war fits inside one: A calls to
     * 100, B raises to 300, A calls 200 more. That is two actions from A, and
     * drawn one flight each they were two pushes of whatever A's bet came to —
     * six hundred chips leaving a stack that lost three. `to` is a running
     * total and only the last one is true; `amount` is what each decision
     * actually cost, and those do add up.
     */
    const byPlayer = new Map<string, { out: number; to: number; seq: number }>()
    for (const action of pushed) {
      const had = byPlayer.get(action.playerId)
      byPlayer.set(action.playerId, {
        out: (had?.out ?? 0) + action.amount,
        to: Math.max(had?.to ?? 0, action.to),
        seq: action.seq,
      })
    }
    for (const [playerId, push] of byPlayer) {
      const i = ordered.findIndex((p) => p.id === playerId)
      if (i < 0 || push.out <= 0) continue
      // What is standing on the cloth when it lands, which is what the spot has
      // to be sized for — not what this decision cost. A call of 200 on top of
      // 100 leaves a pile of 300 in front of them.
      const resting = ordered[i].bet > 0 ? ordered[i].bet : push.to
      const to = spotFor(i, resting)
      if (!to) continue
      setFlights((all) => [
        ...all,
        betToFelt(i, seatCentre(i, total, table), to, push.out, String(push.seq)),
      ])
      // Standing on the cloth only once its own flight lands — which is what
      // the rake below waits for, and what its chips must not be visible
      // before.
      if (ordered[i].bet <= 0) {
        late.push({ key: playerId, at: to, amount: resting, since: BET_MS })
      }
    }

    // When the last chip of the rake lands, if there is a rake at all. The
    // payout below waits for it: a dealer sweeps the bets in and *then* pushes
    // the pot out, and on a hand won by folding both arrive in one response.
    let raked = 0
    if (events.includes("potCollect")) {
      // Everything that was standing on the cloth: what was resting there at
      // the last poll, plus whatever landed a moment ago. Keyed by player, so
      // a caller who already had chips out is raked once, for the total the
      // action left in front of them rather than for what they added.
      const held = new Map<string, (typeof late)[number]>(
        // Already resting there at the last poll, so visible from the off.
        lastFelt.current.map((c) => [c.key, { ...c, since: 0 }]),
      )
      for (const chip of late) held.set(chip.key, chip)
      // Trimmed to what the middle actually grew by, because an uncalled bet
      // goes back rather than in. Same number `diffViews` asked its yes/no
      // question of, so the chips and the sound cannot disagree about how much
      // moved. See `calledPart`.
      const chips = calledPart([...held.values()], potGrowth(previous, view))
      if (chips.length) {
        const sweep = sweepToPot(chips, middle, sweepStart(lateBet), gen)
        raked = Math.max(...sweep.map((f) => f.delay + f.ms))
        setFlights((all) => [...all, ...sweep])
      }
      lastFelt.current = []
    }

    if (events.includes("potWon")) {
      // Where each winner is sitting, and what they are being paid. Read off
      // the results rather than off the pot, because a split is two payments
      // out of one pot and a side pot is two pots into possibly one seat.
      const seatOf = new Map(ordered.map((p, i) => [p.id, i]))
      // What came *out of the pot*, not what the hand left them with. A player
      // who called 100 and won a side pot of 20 finished the hand at -80 and
      // still has chips coming across the felt; on `delta` they got nothing,
      // and so did both halves of every chop.
      const paid = view.lastResults
        .filter((r) => r.won > 0)
        .flatMap((r) => {
          const i = seatOf.get(r.playerId)
          if (i === undefined) return []
          return [{ key: r.playerId, at: seatCentre(i, total, table), amount: r.won }]
        })
      // Held until the hand has finished being *told*.
      //
      // This used to leave the middle on the same response that started the
      // reveal, so the pot crossed the felt while hands were still turning
      // over and before the winning five had been picked out. The money moving
      // is the answer to the hand; it was arriving before the question had
      // been asked.
      //
      // Asked here rather than left to the effect below, because a pot won by
      // folding has nothing to wait for and `done` is already true for it —
      // and an effect that only fires when a boolean *changes* never fires at
      // all for those. Every pot nobody showed a hand for was being worked
      // out, put in this pocket, and left in it.
      if (paid.length) {
        // The middle is holding this pot from now until it goes out.
        setMiddleHolds(view.handNumber)
        // Nothing to wait for: out it goes, once the rake it is made of has
        // landed. Something to wait for: the showdown outlasts the rake several
        // times over, so by the time it is released the middle is long settled
        // and the payout needs no delay of its own.
        if (beats.done) {
          payOut(payoutFromPot(middle, paid, gen, raked))
        } else {
          owed.current = payoutFromPot(middle, paid, gen)
        }
      }
      // The hand is over and the felt is cleared by the next deal; anything
      // still remembered from it belongs to a hand that no longer exists.
      lastFelt.current = []
    }
    // Driven by the view, which is the only thing that says a moment happened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  // The pot goes out when the hand has finished being told, and not before.
  //
  // Its own effect rather than a timer set where the payout is worked out,
  // because "the showdown is over" is a question `useShowdown` already answers
  // — nine hands turning over take longer than two, and a duration guessed
  // here would be wrong for one of them.
  useLayoutEffect(() => {
    if (!beats.done || !owed.current) return
    const payout = owed.current
    owed.current = null
    payOut(payout)
    // `payOut` is stable; it is listed so the rule stays on rather than being
    // silenced, which is how a real missing dependency gets in later.
  }, [beats.done, payOut])

  // Declared *after* the effect above, and that order is the whole of it.
  //
  // React runs layout effects in the order they are written, and the response
  // that tells us a street closed usually also carries the next street's first
  // bets — a poll is 1.2 seconds and the table does not wait. Take the snapshot
  // first and it has already been replaced by the new street's chips by the
  // time the sweep asks where the old ones were, so the money flies in from
  // wherever the *next* bets happen to be standing.
  useLayoutEffect(() => {
    const onFelt = ordered.flatMap((p, i) =>
      betPlacements[i] && p.bet > 0
        ? [{ key: p.id, at: betPlacements[i]!, amount: p.bet }]
        : [],
    )
    if (onFelt.length) lastFelt.current = onFelt
  })

  return (
    <div
      ref={zoneRef}
      className="flex h-full w-full items-center justify-center"
    >
    <div
      ref={tableRef}
      data-baize={baizeOf(view.baize)}
      data-deck={deckOf(view.deck)}
      // One shape, and it fills the room it is given.
      //
      // Sized in pixels from `tableBox` rather than by `aspect-ratio` and a
      // max-width, because the shape is a *range* — see ASPECT_MIN/MAX. The
      // table takes all the height there is and lets the ring's straight sides
      // absorb it, which is the whole reason the ring is a racetrack.
      //
      // This is also the whole of E1. The table used to take its height from
      // its width and let the page scroll when that was more height than the
      // screen had — which meant the bottom of the table, which is *you*, spent
      // its life under the action bar. A player who has to scroll to see the
      // table cannot see the table, and at a poker table that is not cosmetic:
      // it is not knowing who is still in the hand.
      className="relative"
      style={{ width: box.w, height: box.h }}
    >
      {/* The rail, and the cloth inside it. Two boxes rather than a border,
          because wood and felt are different materials and a border can only be
          one colour — and three surfaces rather than two, because the grain, the
          varnish and the cloth are each doing a different job.

          A racetrack, not an ellipse — and the difference is one unit. A
          percentage radius on a 3:4.4 box gives a true ellipse, which is an
          *egg*: it bulges at the waist and tapers at both ends, so the seats at
          the top and bottom sit on a curve that is falling away from them. A
          radius in pixels large enough to clamp gives semicircular ends and
          straight sides, which is the shape a real ten-seat table is, and it
          puts felt where the top and bottom seats actually are. */}
      <div className="rail grain absolute inset-0 rounded-[999px]" aria-hidden />
      {/* Siblings, not nested: the rail's varnish highlight is a pseudo-element
          and pseudo-elements paint after their host's children, so a felt drawn
          *inside* the rail would have the varnish laid over it. */}
      <div className="baize grain absolute inset-[13px] rounded-[999px]" aria-hidden>
        {/* The hairline inlaid a finger's width inside the playing surface.
            Inside the cloth, not on the wood: it marks where the felt stops
            being reachable, and every table has one. */}
        <div
          className="pointer-events-none absolute inset-[15px] rounded-[999px] border"
          style={{
            borderColor: "color-mix(in srgb, var(--inlay) 24%, transparent)",
          }}
        />
      </div>

      {/* Center: pot + board. */}
      {/* 47%, and it has to stay in step with `LAYOUT.BOARD_CY`. */}
      <div
        className="absolute left-1/2 top-[47%] flex w-full -translate-x-1/2 -translate-y-1/2 flex-col items-center px-2"
        style={{ gap: 8 * u }}
      >
        {/* Measured as the reserved middle of the table, so it hugs its
            contents rather than spanning the full width.

            Every gap and floor in here is `* u`, and that is not tidiness:
            `estimateCentreBox` reserves this block's room in scaled units, so
            a gap that stays 8px while the table shrinks makes the model and
            the drawing two different shapes — and the pure test goes on
            passing while the flank seats are sitting on the board. */}
        <div
          ref={centreRef}
          data-piece="centre"
          className="flex w-fit flex-col items-center"
          style={{ gap: 8 * u }}
        >
          {/* What the table would have said out loud, above the pot.
              It sat under the board, which put the one line that changes every
              few seconds at the bottom of a block whose top is the number
              everybody is playing for — so reading "Lucía folds" meant looking
              away from the pot, and reading the pot meant looking past the
              cards. Above, the middle of the table reads downwards in the order
              it happens: who just acted, what that made the pot, what it is
              being played for.

              One region, announced politely, and never two: a screen reader
              given two live regions in the middle of a table reads them in
              whichever order it likes.

              The row is reserved whether or not anything is in it, and
              `estimateCentreBox` reserves the same — a block that changes
              height every time somebody acts is a block everything else on the
              felt was placed against a moment ago. */}
          <div
            role="status"
            aria-live="polite"
            className="flex items-center justify-center"
            style={{ height: SAID_H * u }}
          >
            {said && (
              // The table's own voice, on the cloth rather than in a panel.
              <span
                className="truncate rounded-full border text-center font-bold backdrop-blur-[6px]"
                style={{
                  maxWidth: 200 * u,
                  paddingInline: 9 * u,
                  paddingBlock: 1.5 * u,
                  fontSize: 10.5 * u,
                  background: "rgba(0,0,0,.66)",
                  borderColor: "color-mix(in srgb, var(--inlay) 24%, transparent)",
                  color: "var(--ivory)",
                }}
              >
                {said}
              </span>
            )}
          </div>
          <PotDisplay
            pots={view.pots}
            total={middlePot}
            youId={view.you?.id}
            live={view.phase === "hand"}
            u={u}
          />
          {/* One row per board, and the same gap between two rows as between
              two cards — `estimateCentreBox` reserves exactly this. */}
          <div
            className="flex flex-col items-center"
            style={{ gap: 4 * u }}
          >
            {boards.map((cards, b) => (
              <div key={b} className="flex flex-col items-center">
                <div
                  data-testid={b === 0 ? "board" : `board-${b + 1}`}
                  // Both rows carry this, so a check in a real browser can ask
                  // "is this card on a board" without knowing how many there are.
                  data-board={b}
                  data-cards={cards.length}
                  className="flex flex-wrap items-center justify-center"
                  style={{
                    gap: 4 * u,
                    // A card's height when there are cards, and the height of
                    // the line of text when there are not — the two cases
                    // `estimateCentreBox` reserves for.
                    minHeight: (cards.length > 0 ? BOARD_CARD_H : 20) * u,
                  }}
                >
                  {cards.length > 0 ? (
                    // Small on narrow phones: five cards at the sm size leave
                    // a nine-handed table no room between board and seats.
                    cards.map((c, i) => (
                      <BoardCard
                        key={i}
                        card={c}
                        delay={arriving[b]?.[i] ?? null}
                        u={u}
                        lit={beats.lit(c)}
                        dim={beats.dimming}
                      />
                    ))
                  ) : (
                    <span
                      className="text-muted-foreground/70"
                      style={{ fontSize: 12 * u }}
                    >
                      {view.phase === "hand" ? "Community cards" : "Waiting for next hand"}
                    </span>
                  )}
                </div>
                {/* Who took this one. With two boards the same player usually
                    has two different hands, so the server sends no `handCards`
                    at all and nothing lights up — which leaves the one question
                    the second board exists to answer unanswered on the felt.
                    See `use-showdown`.

                    Under the row and not beside it, and that is a measurement:
                    beside the cards it made the middle 40% wider and the
                    collision matrix failed at every phone width there is. The
                    line is reserved whenever there are two boards, whether or
                    not it has a name in it yet — the name arrives at the end of
                    the run-out, and a middle that grows then is a middle every
                    seat was placed against several seconds ago. */}
                {boardRows > 1 ? (
                  <span
                    data-testid={`board-winner-${b + 1}`}
                    className="truncate font-semibold text-primary"
                    style={{
                      fontSize: 10 * u,
                      // The figure the model reserves — see `BOARD_WINNER_H`.
                      height: BOARD_WINNER_H * u,
                      lineHeight: `${BOARD_WINNER_H * u}px`,
                      maxWidth: BOARD_CARD_W * 5 * u,
                    }}
                  >
                    {beats.done ? boardWinners[b] : ""}
                  </span>
                ) : null}
              </div>
            ))}
          </div>

          {/* The pot, as chips, under the board — where a dealer stacks it.
              The row is reserved whether or not there is anything in it yet
              (`estimateCentreBox`), because a middle that grows a row the first
              time a street closes is a middle that everything else on the felt
              was placed against a moment ago.

              `stacked` and *not* `middlePot`, and that is the difference
              between a pot and a number. The pill above says what the hand is
              worth, live bets included, because that is what everybody at the
              table means by "the pot". These are chips: they are objects, and
              an object cannot be in the middle and in front of Lucía at the
              same time — nor in the middle while it is still on its way there.
              Drawn from the live total, the blinds appeared in the middle the
              instant they were posted; drawn from the collected one, the rake
              landed money that was already stacked. */}
          <div
            ref={pileRef}
            // What is resting here, for the same reason `data-flight` exists:
            // whether the mound grew before or after the chips landed is a
            // question about two moments, and only a real browser has both.
            data-mound={stacked}
            className="flex items-center justify-center"
            style={{
              height: ((potPileTall(total) - 1) * 4 + CHIP_W) * u,
              // Pulled up out of the parent's 8-unit gap to the 2 the model
              // reserves. Chips rest at the foot of the cards; they do not
              // float below them.
              marginTop: -6 * u,
            }}
          >
            <PotPile
              amount={stacked}
              columns={potColumns(stacked, view.bigBlind)}
              tall={potPileTall(total)}
              u={u}
            />
          </div>
        </div>
      </div>


      {/* Chips wagered this street, out on the felt in front of each player. */}
      {ordered.map((p, i) =>
        betPlacements[i] ? (
          <Anchor
            key={`bet-${p.id}`}
            piece="bet"
            at={betPlacements[i]!}
            size={geometry.bets[i] ?? estimateBetSize(p.bet, table)}
            z="z-10"
            innerRef={(el) => {
              betRefs.current[i] = el
            }}
          >
            {/* Held back while its own chips are still crossing the felt —
                otherwise the same bet is on screen twice, once under way and
                once already arrived. Hidden rather than unmounted: the box is
                what everything else on the felt was placed against, and taking
                it out of the layout for four hundred milliseconds would move
                the neighbours and put them back. */}
            <div style={{ opacity: inFlight.has(i) ? 0 : 1 }}>
              <BetChip amount={p.bet} u={u} />
            </div>
          </Anchor>
        ) : null,
      )}

      {/* Chips in transit. Above the bets and below the seats: money crosses
          the cloth, not the players. */}
      {flights.map((flight) => (
        <ChipFlight key={flight.key} flight={flight} u={u} onDone={dropFlight} />
      ))}

      {/* And cards, on their way out of the button. */}
      {pitches.map((pitch) => (
        <DealtCard key={pitch.key} pitch={pitch} u={u} onDone={dropPitch} />
      ))}

      {/* Seats */}
      {ordered.map((p, i) => (
        <Anchor
          key={p.id}
          piece="seat"
          at={seatCentre(i, total, table)}
          size={seatSizes[i] ?? estimateSeatSize({ table, seats: total, revealed })}
          z="z-20"
          innerRef={(el) => {
            seatRefs.current[i] = el
          }}
        >
          <PlayerSeat
            player={p}
            showdown={shownDown[i]}
            holdHand={showdown && !shownDown[i]}
            // The same two questions the board asks, asked of the same place.
            // Three of the winning five are usually on the board and two are in
            // a hand, and lighting only the board half is four lit cards and a
            // winning hand that does not add up.
            lit={beats.lit}
            dim={beats.dimming}
            // What they had, said where a real table says it: out loud, over
            // the seat of the person who just won with it. It sat only in the
            // summary panel, which is the one place nobody is looking at the
            // moment a hand is turned over.
            made={beats.dimming ? handNameOf(view, p.id) : null}
            revealed={revealed}
            compact={crowded(total)}
            secondsLeft={p.isActor ? secondsLeft : null}
            actionSeconds={view.actionSeconds}
            chips={stackHeight(p.chips, view.startingChips, table)}
            chipsShown={p.chips}
            u={u}
          />
        </Anchor>
      ))}
    </div>
    </div>
  )
}
