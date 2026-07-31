"use client"

import { useEffect, useState } from "react"
import { HelpCircle, X } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * The cheat sheet, permanently one tap away.
 *
 * There is deliberately no onboarding: a tutorial in front of the first hand
 * is a tax on the nine times out of ten that nobody needs it. A question mark
 * that is always there costs nothing and is the thing people actually reach
 * for — mid-hand, when they have forgotten what the clock does.
 */
const ENTRIES: { title: string; body: string }[] = [
  {
    title: "Hold to see your cards",
    body: "Your hand only shows while a thumb is on it. Let go and it drops back onto the felt — so the person next to you never gets a look.",
  },
  {
    title: "Bet sizes",
    body: "The row above the buttons is the sizes you actually use. Preflop they are multiples of the big blind; after the flop they are fractions of the pot. Use + and − to nudge by one big blind.",
  },
  {
    title: "The clock",
    body: "When it runs out it checks for you if checking is free, and folds you if it is not. Miss three in a row and you are sat out until you come back.",
  },
  {
    title: "Sitting out",
    body: "You keep your seat and your chips, and the blinds stop reaching you. Not available heads-up — there would be nobody left to play.",
  },
  {
    title: "After the hand",
    body: "Won without a showdown? You can turn over one card or both. Folded and still curious? Ask what would have come.",
  },
]

export function HelpSheet() {
  const [open, setOpen] = useState(false)

  // Escape closes it. Reaching for the back gesture instead is how you leave
  // the table by accident.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label="How to play"
        className="text-muted-foreground"
      >
        <HelpCircle />
      </Button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="How to play"
          className="fixed inset-0 z-50 flex items-end justify-center bg-background/80 p-3 backdrop-blur-sm sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            // Stops a tap inside the sheet from closing it on the way out.
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[80svh] w-full max-w-md flex-col overflow-y-auto rounded-2xl border border-border/60 bg-card p-4 shadow-xl"
          >
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-serif text-lg font-bold text-card-foreground">How to play</h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <X />
              </Button>
            </div>
            <dl className="flex flex-col gap-3">
              {ENTRIES.map((e) => (
                <div key={e.title}>
                  <dt className="text-sm font-semibold text-card-foreground">{e.title}</dt>
                  <dd className="text-sm text-muted-foreground">{e.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </>
  )
}
