import { cache } from 'react'

export interface RoomPreview {
  roomId: string
  name: string
  phase: 'lobby' | 'hand' | 'handover' | 'finished'
  playerCount: number
  maxSeats: number
  smallBlind: number
  bigBlind: number
  handNumber: number
}

export type RoomPreviewResult =
  | { status: 'available'; preview: RoomPreview }
  | { status: 'missing' }
  | { status: 'unavailable' }

function apiBase(): string {
  const direct = process.env.POKER_BACKEND_URL
  if (direct) return `${direct.replace(/\/$/, '')}/api`

  const configuredSite = process.env.NEXT_PUBLIC_SITE_URL
  if (configuredSite) return `${configuredSite.replace(/\/$/, '')}/api`

  const vercelHost =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL
  if (vercelHost) {
    const origin = vercelHost.startsWith('http') ? vercelHost : `https://${vercelHost}`
    return `${origin.replace(/\/$/, '')}/api`
  }

  return 'http://127.0.0.1:8000/api'
}

/**
 * Read the deliberately public room projection used by crawlers and share art.
 * A missing backend must degrade to a generic invite instead of delaying the
 * join page or turning a chat unfurl into an error page.
 */
export const getRoomPreviewResult = cache(async (roomId: string): Promise<RoomPreviewResult> => {
  try {
    const response = await fetch(
      `${apiBase()}/rooms/${encodeURIComponent(roomId)}/preview`,
      {
        next: { revalidate: 15 },
        signal: AbortSignal.timeout(2000),
      },
    )
    if (response.status === 404) return { status: 'missing' }
    if (!response.ok) return { status: 'unavailable' }
    return { status: 'available', preview: (await response.json()) as RoomPreview }
  } catch {
    return { status: 'unavailable' }
  }
})

/** Metadata and share art need only the safe projection, not failure details. */
export async function getRoomPreview(roomId: string): Promise<RoomPreview | null> {
  const result = await getRoomPreviewResult(roomId)
  return result.status === 'available' ? result.preview : null
}
