'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * A guest's remembered identity, kept on this device only.
 *
 * Sign-up is optional: a guest who adds a nickname and photo once shouldn't
 * have to redo it every time they join a table on the same phone. We store the
 * private storage *path* (not a URL, which expires) and re-sign it on load.
 */
export type GuestIdentity = {
  nickname: string
  photoBucket: string | null
  photoPath: string | null
}

const STORAGE_KEY = 'holdem:guest-identity'

const EMPTY: GuestIdentity = {
  nickname: '',
  photoBucket: null,
  photoPath: null,
}

function read(): GuestIdentity {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw)
    return {
      nickname: typeof parsed.nickname === 'string' ? parsed.nickname : '',
      photoBucket:
        typeof parsed.photoBucket === 'string' ? parsed.photoBucket : null,
      photoPath: typeof parsed.photoPath === 'string' ? parsed.photoPath : null,
    }
  } catch {
    return EMPTY
  }
}

function write(identity: GuestIdentity) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity))
  } catch {
    // Storage may be unavailable (private mode); the identity is best-effort.
  }
}

export function useGuestIdentity() {
  const [identity, setIdentity] = useState<GuestIdentity>(EMPTY)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  // Load the remembered identity, then re-sign its stored photo path so the
  // preview shows the actual image rather than a stale, expired URL.
  useEffect(() => {
    const stored = read()
    setIdentity(stored)
    let active = true

    async function resign() {
      if (!stored.photoPath || !stored.photoBucket) {
        setReady(true)
        return
      }
      try {
        const res = await fetch('/srv/photo/signed-url', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            bucket: stored.photoBucket,
            path: stored.photoPath,
          }),
        })
        if (active && res.ok) {
          const data = await res.json()
          setPhotoUrl(data.url ?? null)
        }
      } catch {
        // Leave the photo empty if it can't be re-signed.
      } finally {
        if (active) setReady(true)
      }
    }

    void resign()
    return () => {
      active = false
    }
  }, [])

  const setNickname = useCallback((nickname: string) => {
    setIdentity((prev) => {
      const next = { ...prev, nickname }
      write(next)
      return next
    })
  }, [])

  const setPhoto = useCallback(
    (photo: { bucket: string; path: string; url: string } | null) => {
      setIdentity((prev) => {
        const next = {
          ...prev,
          photoBucket: photo?.bucket ?? null,
          photoPath: photo?.path ?? null,
        }
        write(next)
        return next
      })
      setPhotoUrl(photo?.url ?? null)
    },
    [],
  )

  return { identity, photoUrl, ready, setNickname, setPhoto }
}
