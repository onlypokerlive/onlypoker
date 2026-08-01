'use client'

import { useSearchParams } from 'next/navigation'

import {
  CreateRoomForm,
  type CreateRoomPreset,
} from '@/components/create-room-form'
import type { CreationSource } from '@/lib/growth'

function safeNumber(value: string | null, minimum: number, maximum: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : undefined
}

/** Read the finish/rematch handoff without making the public home route dynamic. */
export function CreateRoomEntry() {
  const searchParams = useSearchParams()
  const requestedSource = searchParams.get('source')
  const source: CreationSource =
    requestedSource === 'rematch' || requestedSource === 'finished-table'
      ? requestedSource
      : 'home'
  const preset: CreateRoomPreset =
    source === 'rematch'
      ? {
          roomName: 'The Rematch',
          smallBlind: safeNumber(searchParams.get('sb'), 1, 1_000_000),
          bigBlind: safeNumber(searchParams.get('bb'), 1, 2_000_000),
          startingChips: safeNumber(searchParams.get('chips'), 1, 100_000_000),
          levelMinutes: safeNumber(searchParams.get('level'), 0, 120),
          actionSeconds: safeNumber(searchParams.get('action'), 0, 120),
        }
      : {}

  return <CreateRoomForm source={source} preset={preset} />
}
