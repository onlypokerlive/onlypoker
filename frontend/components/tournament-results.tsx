'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, RotateCcw, Share2 } from 'lucide-react'
import { toast } from 'sonner'

import { TournamentPoster } from '@/components/tournament-poster'
import { Button } from '@/components/ui/button'
import { recordFinishCta, recordResultsShared } from '@/lib/growth'
import type { GameView } from '@/lib/poker-api'
import { shareTournamentPoster } from '@/lib/tournament-poster'

export function rematchHref(view: GameView): string {
  const params = new URLSearchParams({
    source: 'rematch',
    sb: String(view.smallBlind),
    bb: String(view.bigBlind),
    chips: String(view.startingChips),
    level: String(view.levelMinutes),
    action: String(view.actionSeconds),
  })
  return `/?${params.toString()}#create-table`
}

/** Final table, share artifact, and the shortest route into the next night. */
export function TournamentResults({ view }: { view: GameView }) {
  const router = useRouter()
  const [sharing, setSharing] = useState(false)

  if (!view.standings.length) return null

  async function handleShare() {
    if (sharing) return
    setSharing(true)
    try {
      const method = await shareTournamentPoster(view)
      if (method === 'cancelled') return
      recordResultsShared(method, view.standings.length, view.isHost)
      toast.success(
        method === 'native'
          ? 'Final table shared'
          : 'Poster saved — share it with the group',
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not make the poster.')
    } finally {
      setSharing(false)
    }
  }

  function moveToCreation(action: 'create' | 'rematch') {
    recordFinishCta(action, view.isHost)
    router.push(
      action === 'rematch'
        ? rematchHref(view)
        : '/?source=finished-table#create-table',
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-3">
      <TournamentPoster view={view} />

      <Button size="lg" onClick={handleShare} disabled={sharing} className="w-full">
        <Share2 data-icon="inline-start" />
        {sharing ? 'Making the poster…' : 'Share the night'}
      </Button>

      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => moveToCreation('rematch')}>
          <RotateCcw data-icon="inline-start" />
          Play again
        </Button>
        <Button variant="outline" onClick={() => moveToCreation('create')}>
          <Plus data-icon="inline-start" />
          Create your table
        </Button>
      </div>

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
      </details>
    </div>
  )
}
