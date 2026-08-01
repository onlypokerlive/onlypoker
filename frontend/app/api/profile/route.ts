import { NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { AVATAR_BUCKET, signPhoto } from '@/lib/photos'

type ProfileRow = {
  id: string
  full_name: string | null
  nickname: string | null
  avatar_path: string | null
}

async function serialize(row: ProfileRow) {
  return {
    id: row.id,
    fullName: row.full_name,
    nickname: row.nickname,
    avatarPath: row.avatar_path,
    avatarUrl: await signPhoto(AVATAR_BUCKET, row.avatar_path),
  }
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  let { data: row } = await supabase
    .from('profiles')
    .select('id, full_name, nickname, avatar_path')
    .eq('id', user.id)
    .maybeSingle()

  // The signup trigger normally creates this; self-heal if it's missing.
  if (!row) {
    const seedName =
      (user.user_metadata?.full_name as string | undefined) ??
      (user.user_metadata?.name as string | undefined) ??
      null
    const { data: inserted } = await supabase
      .from('profiles')
      .upsert({ id: user.id, full_name: seedName }, { onConflict: 'id' })
      .select('id, full_name, nickname, avatar_path')
      .single()
    row = inserted ?? {
      id: user.id,
      full_name: seedName,
      nickname: null,
      avatar_path: null,
    }
  }

  return NextResponse.json({ profile: await serialize(row) })
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  let body: {
    fullName?: string | null
    nickname?: string | null
    avatarPath?: string | null
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 })
  }

  const update: Record<string, string | null> = {}

  if (body.fullName !== undefined) {
    update.full_name = body.fullName?.toString().trim().slice(0, 120) || null
  }
  if (body.nickname !== undefined) {
    update.nickname = body.nickname?.toString().trim().slice(0, 40) || null
  }
  if (body.avatarPath !== undefined) {
    // Only accept an avatar path that belongs to this user.
    if (body.avatarPath && !body.avatarPath.startsWith(`${user.id}/`)) {
      return NextResponse.json(
        { error: 'Invalid avatar path.' },
        { status: 400 },
      )
    }
    update.avatar_path = body.avatarPath || null
  }

  const { data: row, error } = await supabase
    .from('profiles')
    .update(update)
    .eq('id', user.id)
    .select('id, full_name, nickname, avatar_path')
    .single()

  if (error || !row) {
    return NextResponse.json(
      { error: 'Could not save profile.' },
      { status: 500 },
    )
  }

  return NextResponse.json({ profile: await serialize(row) })
}
