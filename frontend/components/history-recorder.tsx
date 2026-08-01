'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Check, History, LogIn } from 'lucide-react'

import { useAuth } from '@/components/auth-provider'
import type { GameView, Session } from '@/lib/poker-api'

type Status = 'idle' | 'saving' | 'saved' | 'exists' | 'error' | 'signed-out'

/**
 * When a tournament ends, save it to the signed-in player's history — once.
 *
 * We build the record entirely from the finished-table view the client already
 * has (final standings, the last hand, the blinds), find the viewer's own
 * finishing place by their seat id, and POST it to a server route that upserts
 * idempotently on (user, room). Guests see a gentle nudge to sign in instead.
 */
export function HistoryRecorder({
  view,
  session,
}: {
  view: GameView
  session: Session | null
}) {
  const { user, loading } = useAuth()
  const [status, setStatus] = useState<Status>('idle')
  const attempted = useRef(false)

  useEffect(() => {
    if (loading || attempted.current) return
    if (view.phase !== 'finished') return

    if (!user) {
      setStatus('signed-out')
      return
    }
    // Spectators have no seat, so there's no result of theirs to save.
    if (!session || session.spectator) {
      attempted.current = true
      return
    }

    attempted.current = true
    setStatus('saving')

    const mine = view.standings.find((s) => s.playerId === session.playerId)
    const payload = {
      roomId: view.roomId,
      roomName: view.roomName,
      position: mine?.place ?? null,
      totalPlayers: view.standings.length,
      finishedAt: new Date().toISOString(),
      stakes: {
        smallBlind: view.smallBlind,
        bigBlind: view.bigBlind,
        ante: view.ante,
        hands: view.handNumber,
      },
      // The final hand, exactly as the table showed it.
      lastHand: {
        board: view.board,
        boards: view.boards,
        boardResults: view.boardResults,
        results: view.lastResults,
        wentToShowdown: view.wentToShowdown,
      },
      // Everyone who took part, with where they finished.
      participants: view.standings.map((s) => ({
        name: s.name,
        place: s.place,
      })),
    }

    async function save() {
      try {
        const res = await fetch('/srv/history/record', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error('save failed')
        setStatus('saved')
      } catch {
        setStatus('error')
      }
    }

    void save()
  }, [loading, user, session, view])

  if (status === 'idle' || status === 'saving') {
    return null
  }

  if (status === 'signed-out') {
    return (
      <p className="flex flex-wrap items-center justify-center gap-1 text-center text-sm text-muted-foreground">
        <LogIn className="size-4" />
        <Link href="/profile" className="underline hover:text-foreground">
          Sign in
        </Link>{' '}
        to save this game to your history.
      </p>
    )
  }

  if (status === 'error') {
    return (
      <p className="text-center text-sm text-muted-foreground">
        Couldn&apos;t save this game to your history.
      </p>
    )
  }

  // saved or already-exists
  return (
    <p className="flex flex-wrap items-center justify-center gap-1 text-center text-sm text-muted-foreground">
      <Check className="size-4 text-primary" />
      Saved to your history.
      <Link
        href="/history"
        className="inline-flex items-center gap-1 underline hover:text-foreground"
      >
        <History className="size-3.5" />
        View
      </Link>
    </p>
  )
}
