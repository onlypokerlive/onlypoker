import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

export const AVATAR_BUCKET = 'avatars'
export const GUEST_BUCKET = 'guest-photos'

// Long-lived so a photo passed to the poker backend survives a full session
// (buckets are private and paths are unguessable UUIDs, so this is safe).
const SIGNED_URL_TTL = 60 * 60 * 24 * 7 // 7 days
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024 // 8 MB

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
}

export function extForMime(mime: string): string | null {
  return EXT_BY_MIME[mime.toLowerCase()] ?? null
}

/** Mint a short-lived signed URL for a private object. Returns null on failure. */
export async function signPhoto(
  bucket: string,
  path: string | null | undefined,
): Promise<string | null> {
  if (!path) return null
  const admin = createAdminClient()
  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_URL_TTL)
  if (error || !data) return null
  return data.signedUrl
}
