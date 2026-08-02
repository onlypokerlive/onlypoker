'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, RotateCcw, Share2 } from 'lucide-react'
import { toast } from 'sonner'

import { TournamentPoster } from '@/components/tournament-poster'
import { Button } from '@/components/ui/button'
import {
  recordFinishCta,
  recordFinishCtaImpression,
  recordResultsShareAttempt,
  recordResultsShareOutcome,
  recordResultsShared,
} from '@/lib/growth'
import type { GameView } from '@/lib/poker-api'
import { shareTournamentPoster } from '@/lib/tournament-poster'

/** Keep the current group at the current table for the fastest next game. */
export function PlayAgain({
  onPlayAgain,
  busy = false,
}: {
  onPlayAgain?: () => void
  busy?: boolean
}) {
  if (!onPlayAgain) {
    return (
      <p className="text-center text-xs text-muted-foreground">
        Stay where you are — the host can deal another.
      </p>
    )
  }

  return (
    <Button
      size="lg"
      onClick={() => {
        recordFinishCta('rematch', true)
        onPlayAgain()
      }}
      disabled={busy}
      className="w-full max-w-md"
    >
      <RotateCcw data-icon="inline-start" />
      Play again
    </Button>
  )
}

/** Final table, share artifact, and the shortest route into the next night. */
export function TournamentResults({ view }: { view: GameView }) {
  const router = useRouter()
  const [sharing, setSharing] = useState(false)
  const actionsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!view.standings.length) return
    const frame = window.requestAnimationFrame(() => {
      const rect = actionsRef.current?.getBoundingClientRect()
      recordFinishCtaImpression(
        view.roomId,
        view.tournamentNumber,
        view.isHost,
        Boolean(rect && rect.top >= 0 && rect.bottom <= window.innerHeight),
      )
    })
    return () => window.cancelAnimationFrame(frame)
  }, [view.roomId, view.tournamentNumber, view.isHost, view.standings.length])

  if (!view.standings.length) return null
  const tiedStacks = view.standings.some(
    (standing, index) =>
      index > 0 && standing.chips === view.standings[index - 1]?.chips,
  )

  async function handleShare() {
    if (sharing) return
    setSharing(true)
    recordResultsShareAttempt(view.isHost)
    try {
      const method = await shareTournamentPoster(view)
      if (method === 'cancelled') {
        recordResultsShareOutcome('cancelled', view.isHost)
        return
      }
      recordResultsShareOutcome(method, view.isHost)
      recordResultsShared(method, view.standings.length, view.isHost)
      toast.success(
        method === 'native'
          ? 'Final table shared'
          : 'Poster saved — share it with the group',
      )
    } catch (error) {
      recordResultsShareOutcome('error', view.isHost)
      toast.error(error instanceof Error ? error.message : 'Could not make the poster.')
    } finally {
      setSharing(false)
    }
  }

  function moveToCreation() {
    recordFinishCta('create', view.isHost)
    router.push('/?source=finished-table#create-table')
  }

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-3 md:grid-cols-[minmax(0,1fr)_minmax(17rem,0.78fr)] md:items-start md:gap-4">
      <div className="min-w-0">
        <TournamentPoster view={view} />
      </div>

      <div ref={actionsRef} className="flex min-w-0 flex-col gap-3 md:sticky md:top-4">
        <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5">
          <h3 className="font-serif text-lg font-semibold text-foreground">Keep the night going</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Share the final table or open a fresh one of your own.
          </p>
        </div>

        <Button size="lg" onClick={handleShare} disabled={sharing} className="w-full">
          <Share2 data-icon="inline-start" />
          {sharing ? 'Making the poster…' : 'Share the night'}
        </Button>

        <Button size="lg" variant="outline" onClick={moveToCreation}>
          <Plus data-icon="inline-start" />
          Create your table
        </Button>

        <details className="rounded-xl border border-border/50 bg-card/50 px-3 py-2">
          <summary className="cursor-pointer text-center text-xs font-medium text-muted-foreground">
            Full standings
          </summary>
          <ol className="mt-2 flex flex-col gap-1 border-t border-border/40 pt-2">
            {view.standings.map((standing) => (
              <li
                key={standing.playerId}
                className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm"
              >
                <span className="min-w-0 truncate text-card-foreground">
                  <span className="mr-2 font-mono text-xs text-primary">#{standing.place}</span>
                  {standing.name}
                </span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {standing.chips.toLocaleString()}
                </span>
              </li>
            ))}
          </ol>
          {tiedStacks ? (
            <p className="mt-2 border-t border-border/40 pt-2 text-xs leading-relaxed text-muted-foreground">
              Equal stacks keep the table’s seat order as the final tie-break.
            </p>
          ) : null}
        </details>
      </div>
    </div>
  )
}
