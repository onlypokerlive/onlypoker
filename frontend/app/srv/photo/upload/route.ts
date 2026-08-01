import { NextRequest, NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import {
  AVATAR_BUCKET,
  GUEST_BUCKET,
  MAX_UPLOAD_BYTES,
  extForMime,
  signPhoto,
} from '@/lib/photos'

export async function POST(request: NextRequest) {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data.' }, { status: 400 })
  }

  const file = form.get('file')
  const scope = String(form.get('scope') ?? 'guest')

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided.' }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'Empty file.' }, { status: 400 })
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: 'Image is too large (max 8 MB).' },
      { status: 413 },
    )
  }

  const ext = extForMime(file.type)
  if (!ext) {
    return NextResponse.json(
      { error: 'Unsupported image type.' },
      { status: 415 },
    )
  }

  // Avatars require an authenticated owner; guest photos are open.
  let bucket = GUEST_BUCKET
  let path = `guests/${crypto.randomUUID()}.${ext}`

  if (scope === 'avatar') {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
    }
    bucket = AVATAR_BUCKET
    path = `${user.id}/${crypto.randomUUID()}.${ext}`
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const admin = createAdminClient()
  const { error } = await admin.storage.from(bucket).upload(path, bytes, {
    contentType: file.type,
    upsert: false,
  })
  if (error) {
    return NextResponse.json(
      { error: 'Upload failed. Please try again.' },
      { status: 500 },
    )
  }

  const url = await signPhoto(bucket, path)
  return NextResponse.json({ bucket, path, url })
}
