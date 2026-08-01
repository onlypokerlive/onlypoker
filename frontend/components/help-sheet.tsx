"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
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
    title: "Peek or tap to see your cards",
    body: "Press and hold for a private peek, then let go to hide your hand. A quick tap keeps the cards up briefly when you need a second look.",
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
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    closeRef.current?.focus()

    const onKey = (event: KeyboardEvent) => {
      // Reaching for the back gesture instead is how you leave the table by
      // accident, so Escape always closes the sheet first.
      if (event.key === "Escape") {
        event.preventDefault()
        setOpen(false)
        return
      }
      if (event.key !== "Tab") return

      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      )
      if (focusable.length === 0) {
        event.preventDefault()
        panelRef.current?.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = previousOverflow
      previousFocus?.focus()
    }
  }, [open])

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        ref={triggerRef}
        onClick={() => setOpen(true)}
        aria-label="How to play"
        className="text-muted-foreground"
      >
        <HelpCircle />
      </Button>

      {open &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="how-to-play-title"
            className="fixed inset-0 z-50 flex items-end justify-center bg-background/80 p-3 backdrop-blur-sm sm:items-center"
            onClick={() => setOpen(false)}
          >
            <div
              ref={panelRef}
              tabIndex={-1}
              // Stops a tap inside the sheet from closing it on the way out.
              onClick={(e) => e.stopPropagation()}
              className="room-panel flex max-h-[80svh] w-full max-w-md flex-col overflow-y-auto overscroll-contain rounded-2xl p-4 shadow-2xl"
            >
              <div className="mb-2 flex items-center justify-between">
                <h2 id="how-to-play-title" className="font-serif text-lg font-bold text-card-foreground">
                  How to play
                </h2>
                <Button
                  variant="ghost"
                  size="icon"
                  ref={closeRef}
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
          </div>,
          document.body,
        )}
    </>
  )
}
