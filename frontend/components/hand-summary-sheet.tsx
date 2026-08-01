"use client"

import { useEffect, useState } from "react"
import { ScrollText, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { HandResults } from "@/components/hand-results"
import type { GameView } from "@/lib/poker-api"

/**
 * The summary of the hand, one tap away and not one pixel closer.
 *
 * This panel has been walked back twice, and both times for the same reason.
 * First it was a full-screen takeover the instant a hand ended — over the board
 * that had just decided it, over the winner's cards, over everybody's stacks at
 * the one moment they had all just changed. Then it moved down into your own
 * band, smaller, which fixed the covering and not the stealing: a panel that
 * appears on its own still moves the eye off the table, and the table is where
 * the hand is being *told* — the winner's plate names what they had, the five
 * cards light up, the pot goes to them in an arc.
 *
 * So it does not appear on its own at all. What is on screen when a hand ends
 * is the hand ending. This is for afterwards, for the argument about who had
 * what, and it opens when somebody asks for it.
 */
export function HandSummarySheet({ view }: { view: GameView }) {
  const [open, setOpen] = useState(false)

  // A new hand takes the old one's summary away. Leaving it up would have
  // somebody reading the results of a hand while the next one is being dealt
  // underneath.
  useEffect(() => setOpen(false), [view.handNumber])

  // Escape closes it. Reaching for the back gesture instead is how you leave
  // the table by accident.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  if (!view.lastResults.length) return null

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        // Small, and on a shared line with sitting out — see the zone in
        // `room-client`. Looking back at the hand that just ended is not what
        // anybody is here for, and it was taking a full row of the one part of
        // the screen the table has to be paid for out of.
        className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
      >
        <ScrollText className="size-3.5" />
        How the hand went
      </Button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="How the hand went"
          className="fixed inset-0 z-50 flex items-end justify-center bg-background/80 p-3 backdrop-blur-sm sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            // Stops a tap inside the sheet from closing it on the way out.
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[80svh] w-full max-w-md flex-col overflow-y-auto rounded-2xl border border-border/60 bg-card p-3 shadow-xl"
          >
            <div className="mb-1 flex items-center justify-end">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <X />
              </Button>
            </div>
            <HandResults view={view} className="max-h-none border-0 bg-transparent p-0" />
          </div>
        </div>
      )}
    </>
  )
}
