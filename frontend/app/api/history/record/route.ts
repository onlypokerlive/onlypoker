import { NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'

type RecordBody = {
  roomId?: string
  roomName?: string | null
  position?: number | null
  totalPlayers?: number | null
  finishedAt?: string | null
  stakes?: unknown
  lastHand?: unknown
  participants?: unknown
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  let body: RecordBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 })
  }

  if (!body.roomId || typeof body.roomId !== 'string') {
    return NextResponse.json({ error: 'Missing roomId.' }, { status: 400 })
  }

  const row = {
    user_id: user.id,
    room_id: body.roomId,
    room_name: body.roomName ?? null,
    position:
      typeof body.position === 'number' ? Math.trunc(body.position) : null,
    total_players:
      typeof body.totalPlayers === 'number'
        ? Math.trunc(body.totalPlayers)
        : null,
    finished_at: body.finishedAt ?? new Date().toISOString(),
    stakes: body.stakes ?? null,
    last_hand: body.lastHand ?? null,
    participants: body.participants ?? null,
  }

  // Idempotent: first record for a (user, room) wins; replays are ignored.
  const { error } = await supabase
    .from('games')
    .upsert(row, { onConflict: 'user_id,room_id', ignoreDuplicates: true })

  if (error) {
    return NextResponse.json(
      { error: 'Could not save game.' },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true })
}
