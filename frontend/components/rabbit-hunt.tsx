"use client"

import { useEffect, useState } from "react"
import { Rabbit } from "lucide-react"

import { Button } from "@/components/ui/button"
import { PlayingCard } from "@/components/playing-card"
import { pokerApi, type Session } from "@/lib/poker-api"

const STREET_LABEL: Record<string, string> = {
  flop: "Flop",
  turn: "Turn",
  river: "River",
}

/**
 * "What would have come?"
 *
 * Nothing about the hand changes and no chips move — which is exactly why it
 * works. The whole point of folding is not knowing, so being shown afterwards
 * is the cheapest drama in the game.
 *
 * Asked for rather than shown: it is only interesting when somebody wonders,
 * and a table that volunteers it every hand turns a treat into noise.
 */
export function RabbitHunt({
  roomId,
  handNumber,
  boardLength,
  session,
}: {
  roomId: string
  handNumber: number
  boardLength: number
  session: Session | null
}) {
  const [streets, setStreets] = useState<{ street: string; cards: string[] }[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A new hand is a new question. Whatever was on screen belongs to the old one.
  useEffect(() => {
    setStreets(null)
    setError(null)
  }, [handNumber])

  // There is nothing left to wonder about once the whole board is out.
  if (boardLength >= 5) return null

  async function look() {
    setLoading(true)
    try {
      const res = await pokerApi.rabbitHunt(roomId, session?.token)
      setStreets(res.streets)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not look")
    } finally {
      setLoading(false)
    }
  }

  if (!streets) {
    return (
      <div className="flex flex-col items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={look}
          disabled={loading}
          className="text-muted-foreground"
        >
          <Rabbit data-icon="inline-start" />
          {loading ? "Looking…" : "What would have come?"}
        </Button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-border/60 px-3 py-2">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Would have come
      </span>
      <div className="flex flex-wrap items-end justify-center gap-3">
        {streets.map((s) => (
          <div key={s.street} className="flex flex-col items-center gap-1">
            <div className="flex gap-1">
              {s.cards.map((c, i) => (
                // Dimmed on purpose: this is information, not a result. It
                // should never read as part of the hand that was played.
                <PlayingCard key={i} card={c} size="xs" className="opacity-60" />
              ))}
            </div>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {STREET_LABEL[s.street] ?? s.street}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
