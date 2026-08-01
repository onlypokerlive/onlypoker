'use client'

import { useState } from 'react'
import { Check, Share2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { recordInviteShared, type ShareSurface } from '@/lib/growth'
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
}: {
  roomId: string
  roomName: string
  phase: 'lobby' | 'hand' | 'handover'
  isHost: boolean
  playerCount: number
  surface: Exclude<ShareSurface, 'results'>
  compact?: boolean
  emphasis?: boolean
}) {
  const [shared, setShared] = useState(false)
  const [busy, setBusy] = useState(false)

  async function handleShare() {
    if (busy) return
    setBusy(true)
    try {
      const method = await shareInvite({ roomId, roomName })
      if (method === 'cancelled') return

      recordInviteShared({ method, surface, phase, isHost, playerCount })
      setShared(true)
      toast.success(method === 'native' ? 'Invite shared' : 'Invite link copied')
      window.setTimeout(() => setShared(false), 1500)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not share the invite.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      type="button"
      variant={emphasis ? 'default' : 'outline'}
      size={compact ? 'icon' : 'lg'}
      onClick={handleShare}
      disabled={busy}
      aria-label={compact ? 'Invite players' : undefined}
      className={compact ? 'text-muted-foreground' : 'w-full'}
    >
      {shared ? <Check data-icon="inline-start" /> : <Share2 data-icon="inline-start" />}
      {compact ? null : shared ? 'Invite ready' : 'Invite players'}
    </Button>
  )
}
