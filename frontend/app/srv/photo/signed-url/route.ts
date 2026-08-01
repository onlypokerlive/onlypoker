import { NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { AVATAR_BUCKET, GUEST_BUCKET, signPhoto } from '@/lib/photos'

/**
 * Mint a fresh signed URL for a stored photo path. Used to refresh a guest's
 * remembered photo (from device storage) or an avatar path. Buckets are
 * private, so all URL minting happens here on the server.
 */
export async function POST(request: NextRequest) {
  let body: { bucket?: string; path?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 })
  }

  const { bucket, path } = body
  if (!path || (bucket !== AVATAR_BUCKET && bucket !== GUEST_BUCKET)) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  // Avatars are owner-scoped: only sign paths that belong to the caller.
  if (bucket === AVATAR_BUCKET) {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user || !path.startsWith(`${user.id}/`)) {
      return NextResponse.json({ error: 'Not allowed.' }, { status: 403 })
    }
  }

  const url = await signPhoto(bucket, path)
  if (!url) {
    return NextResponse.json({ error: 'Could not sign URL.' }, { status: 404 })
  }
  return NextResponse.json({ url })
}
