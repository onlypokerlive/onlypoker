"use client"

import { useState } from "react"
import { Check, Eye } from "lucide-react"

import { Button } from "@/components/ui/button"
import { PlayingCard } from "@/components/playing-card"
import { cn } from "@/lib/utils"
import { pokerApi, type GameView, type Session } from "@/lib/poker-api"

/**
 * Turning your own cards face up — and deciding to, from the moment you fold.
 *
 * A pot won by everyone folding is a pot nobody saw, and half the fun of a
 * home game is proving the bluff — or showing exactly one card and letting the
 * table argue about the other.
 *
 * Two moments, one control:
 *
 * - **Folded, hand still running.** The decision is made the second you throw
 *   the cards away, and by the time the pot is pushed it has gone cold. So the
 *   choice is offered there, as a plan: nothing appears on the table until the
 *   hand settles, because a card face up while there is still betting to come
 *   is a card the players still in the hand get to use. Changeable right up to
 *   the end — it has not happened yet, so it can be taken back.
 * - **After the hand.** Final. Once a card is public the table has seen it.
 *
 * Not offered when the hand was shown down: the cards are already public and
 * this would be noise.
 */
export function ShowCards({
  view,
  roomId,
  onShown,
  session,
}: {
  view: GameView
  roomId: string
  onShown: () => void
  session: Session | null
}) {
  const [busy, setBusy] = useState(false)
  /**
   * The cards under your thumb right now, or null while nothing has been
   * touched — which is what makes the plan you already sent the thing on
   * screen rather than a default this component invented.
   */
  const [picked, setPicked] = useState<number[] | null>(null)
  const you = view.you

  const planning = view.phase === "hand"
  if (!you || you.index === null || !you.cards?.length) return null
  // Mid-hand this is for people who are out of it. Anybody still holding a live
  // hand showing a card is passing information to the players deciding what to
  // do about it, which is the one thing showing must never do.
  //
  // Afterwards the question is whether *your* cards are already public, and
  // that is a question about your seat and not about the hand. Two ways to
  // reach the end with a hand nobody has seen: fold early to a pot two others
  // take to the river, or reach the showdown beaten and speaking after the
  // winner, where the rule says you never have to turn it over. This read
  // `wentToShowdown` alone, so both of them — the only two players at the
  // table with anything left to prove — were the ones it never asked.
  const alreadyPublic = !!you.showedDown
  if (planning ? !you.folded : view.phase !== "handover" || alreadyPublic) return null

  const shown = new Set(you.shownIndices ?? [])
  if (shown.size >= you.cards.length) return null

  // Mid-hand, what is on screen is the plan on the server until a thumb says
  // otherwise. After the hand, nothing is picked until you pick it.
  const selected = new Set(picked ?? (planning ? (you.pendingShowIndices ?? []) : []))

  async function send(indices: number[]) {
    setBusy(true)
    try {
      // Stamped with the hand it was meant for: a request that arrives late
      // is about the hand the player was looking at, not the next one.
      await pokerApi.showCards(roomId, you!.id, indices, view.handNumber, session?.token)
      onShown()
    } finally {
      setBusy(false)
    }
  }

  function toggle(i: number) {
    if (shown.has(i)) return
    const next = new Set(selected)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    const list = [...next].sort()
    setPicked(list)
    // A plan is saved as it is made — there is no moment to confirm, because
    // there is nothing to confirm until the hand ends and this can be undone
    // until then. A reveal is not: that one gets its own button.
    if (planning) void send(list)
  }

  const count = selected.size
  return (
    // One row: the cards on the left, what tapping them does on the right.
    //
    // It was a stacked block — a title, the cards, a button under them, three
    // rows and about 120 pixels — sitting in a zone where every pixel is a row
    // of felt, and it was the first thing to be cut off when anything else was
    // on offer at the same time. Read left to right it is the same offer in a
    // third of the height: these two cards, that button.
    <div className="flex shrink-0 items-center gap-2.5 rounded-xl border border-accent/40 bg-accent/10 px-2.5 py-1.5">
      {/* The cards themselves, and not "1st" and "2nd".
          Nobody holds a hand as a numbered list. The choice is between the ace
          and the seven, so what you tap is the ace or the seven — a label that
          makes you look down at your hand, work out which one is on the left
          and then press a word is a translation step in a decision that has
          about four seconds to be made in. */}
      <div className="flex shrink-0 items-center gap-1.5">
        {you.cards.map((card, i) => {
          const already = shown.has(i)
          const on = already || selected.has(i)
          return (
            <button
              key={i}
              type="button"
              aria-pressed={on}
              aria-label={`${already ? "Already showing" : on ? "Showing" : "Show"} ${card ?? "this card"}`}
              disabled={busy || already}
              onClick={() => toggle(i)}
              className={cn(
                "relative rounded transition-transform duration-150",
                on ? "-translate-y-0.5" : "translate-y-0",
              )}
            >
              <PlayingCard
                card={card}
                size="xs"
                className={cn("transition-opacity", on ? "opacity-100" : "opacity-55")}
                style={{
                  boxShadow: on ? "0 0 0 2px var(--accent), 0 4px 10px rgba(0,0,0,.45)" : undefined,
                }}
              />
              {/* Which of the two is already gone. There is no taking it back,
                  so it stops being a choice and becomes a fact. */}
              {already && (
                <span className="absolute -right-1 -top-1 flex size-3.5 items-center justify-center rounded-full bg-accent text-accent-foreground">
                  <Check className="size-2.5" aria-hidden />
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <span className="flex items-center gap-1 truncate text-[12px] font-semibold text-foreground">
          <Eye className="size-3 shrink-0 text-accent" aria-hidden />
          {planning ? "Show at the end?" : "Show what you had?"}
        </span>
        {/* The 7-2 pays on pots won by folding, which is the entire point — the
            prize is for the bluff. But you only collect by proving it. */}
        <span className="truncate text-[10.5px] leading-tight text-muted-foreground">
          {view.sevenDeucePending
            ? "Seven-deuce: show both to collect"
            : planning
              ? count === 0
                ? "Tap a card"
                : count === 1
                  ? "One card, when the hand ends"
                  : "Both, when the hand ends"
              : "Tap a card, then show"}
        </span>
      </div>

      {!planning && (
        <Button
          size="sm"
          className="h-8 shrink-0 px-3"
          disabled={busy || count === 0}
          onClick={() => void send([...selected])}
        >
          {count === 0 ? "Show" : count === 1 ? "Show it" : "Show both"}
        </Button>
      )}
    </div>
  )
}
