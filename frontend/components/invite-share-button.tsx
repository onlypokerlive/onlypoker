'use client'

import { useState } from 'react'
import { Check, Share2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  recordInviteAttempt,
  recordInviteOutcome,
  recordInviteShared,
  type ShareSurface,
} from '@/lib/growth'
import { shareInvite } from '@/lib/sharing'

export function InviteShareButton({
  roomId,
  roomName,
  phase,
  isHost,
  playerCount,
  surface,
  compact = false,
  emphasis = false,
  size = 'lg',
}: {
  roomId: string
  roomName: string
  phase: 'lobby' | 'hand' | 'handover'
  isHost: boolean
  playerCount: number
  surface: Exclude<ShareSurface, 'results'>
  compact?: boolean
  emphasis?: boolean
  /**
   * How loud the button is where it stands.
   *
   * In the lobby it is the quiet one under the empty seats, because the loud
   * one on that screen is the button that deals the cards. `sm` is still 44px
   * tall here — this repo floors every button at the tap target and only
   * changes the type and the padding.
   */
  size?: 'sm' | 'lg'
}) {
  const [shared, setShared] = useState(false)
  const [busy, setBusy] = useState(false)

  async function handleShare() {
    if (busy) return
    setBusy(true)
    recordInviteAttempt({ surface, phase, isHost })
    try {
      const method = await shareInvite({ roomId, roomName })
      if (method === 'cancelled') {
        recordInviteOutcome({ outcome: 'cancelled', surface, phase, isHost })
        return
      }

      recordInviteOutcome({ outcome: method, surface, phase, isHost })
      recordInviteShared({ method, surface, phase, isHost, playerCount })
      setShared(true)
      toast.success(method === 'native' ? 'Invite shared' : 'Invite link copied')
      window.setTimeout(() => setShared(false), 1500)
    } catch (error) {
      recordInviteOutcome({ outcome: 'error', surface, phase, isHost })
      toast.error(error instanceof Error ? error.message : 'Could not share the invite.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant={emphasis ? 'default' : 'outline'}
        size={compact ? 'icon-lg' : size}
        onClick={handleShare}
        disabled={busy}
        aria-label={compact ? (busy ? 'Opening share options' : 'Invite players') : undefined}
        className={compact ? 'text-muted-foreground' : 'w-full'}
      >
        {shared ? <Check data-icon="inline-start" /> : <Share2 data-icon="inline-start" />}
        {compact
          ? null
          : busy
            ? 'Opening share options…'
            : shared
              ? 'Invite ready'
              : 'Invite players'}
      </Button>
      {busy || shared ? (
        <span className="sr-only" role="status" aria-live="polite">
          {busy ? 'Opening share options' : 'Invite ready'}
        </span>
      ) : null}
    </>
  )
}
