"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      /**
       * At the top, and on a phone that is not a taste decision.
       *
       * Sonner puts these at the bottom by default, and on a phone the bottom
       * is the whole width of the screen — which at this table is the peek
       * band, the slider and the three buttons. So every refusal the app makes
       * landed on top of the controls that had just been used, at the exact
       * moment somebody was reaching for them again: "it is not your turn"
       * covering the thing you press when it is. A notice is something you
       * read; the bottom of the screen is where you act, and the two must not
       * share a space.
       *
       * Offset clears the header, so it reads as a line the room put up rather
       * than as something sitting on the blind clock.
       */
      position="top-center"
      offset={{ top: 52 }}
      mobileOffset={{ top: 48, left: 12, right: 12 }}
      // Two, not three. Three of these is most of a phone's table, and the
      // third one is never the one anybody needed to read.
      visibleToasts={2}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          // Small, because it is over the table now. At sonner's default size
          // a two-line notice is a third of a 320px phone's felt, and a notice
          // that hides the thing it is about is not much better than one that
          // hides the buttons.
          toast: "cn-toast !gap-2 !px-3 !py-2 !text-[12.5px] !leading-snug",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
