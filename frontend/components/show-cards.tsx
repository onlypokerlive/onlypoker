"use client"

import { useState } from "react"
import { Eye } from "lucide-react"

import { Button } from "@/components/ui/button"
import { pokerApi, type GameView } from "@/lib/poker-api"

/**
 * Turning your own cards face up after the hand.
 *
 * A pot won by everyone folding is a pot nobody saw, and half the fun of a
 * home game is proving the bluff — or showing exactly one card and letting the
 * table argue about the other.
 *
 * Offered only when the hand did not go to showdown: any other time the cards
 * are already public and this would be noise.
 */
export function ShowCards({
  view,
  roomId,
  onShown,
}: {
  view: GameView
  roomId: string
  onShown: () => void
}) {
  const [busy, setBusy] = useState(false)
  const you = view.you

  // Nothing to reveal: either it was shown down, or you were not dealt in.
  if (view.wentToShowdown || !you || you.index === null || !you.cards?.length) return null

  const shown = new Set(you.shownIndices ?? [])
  if (shown.size >= you.cards.length) return null

  async function reveal(indices: number[]) {
    setBusy(true)
    try {
      await pokerApi.showCards(roomId, you!.id, indices)
      onShown()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-1">
      {/* The 7-2 pays on pots won by folding, which is the entire point — the
          prize is for the bluff. But you only collect by proving it. */}
      {view.sevenDeucePending && (
        <span className="text-xs font-semibold text-accent">
          You won with seven-deuce. Show both cards to collect.
        </span>
      )}
      <div className="flex items-center justify-center gap-1.5">
      <span className="mr-1 text-xs text-muted-foreground">
        <Eye className="inline size-3" aria-hidden /> Show
      </span>
      {/* One card at a time is the interesting move, so it gets its own
          buttons rather than hiding behind a "pick your cards" dialog. */}
      {you.cards.map((_, i) => (
        <Button
          key={i}
          variant="outline"
          size="sm"
          disabled={busy || shown.has(i)}
          onClick={() => reveal([i])}
        >
          {i === 0 ? "1st" : "2nd"}
        </Button>
      ))}
      {shown.size === 0 && (
        <Button variant="outline" size="sm" disabled={busy} onClick={() => reveal([0, 1])}>
          Both
        </Button>
      )}
      </div>
    </div>
  )
}
