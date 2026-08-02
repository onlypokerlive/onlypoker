'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { Pencil } from 'lucide-react'

import { useAuth } from '@/components/auth-provider'
import { PhotoUpload } from '@/components/photo-upload'
import { PlayerAvatar } from '@/components/player-avatar'
import { useGuestIdentity } from '@/hooks/use-guest-identity'

/**
 * The photo + name prefill shared by the create and join forms.
 *
 * Signed-in players see their profile photo (managed on the profile page) and
 * their nickname is suggested as the display name. Guests get a photo control
 * — upload or live selfie — remembered on the device so they don't redo it
 * every visit. Either way the resolved avatar URL is reported to the parent so
 * it can be sent to the table.
 */
export function IdentityPhoto({
  name,
  onNameChange,
  onAvatarUrlChange,
  onRememberGuestNickname,
}: {
  name: string
  onNameChange: (value: string) => void
  onAvatarUrlChange: (url: string | null) => void
  /** Lets the parent stash the guest's chosen name on submit. */
  onRememberGuestNickname?: (setter: (nickname: string) => void) => void
}) {
  const { user, profile, loading } = useAuth()
  const guest = useGuestIdentity()
  // Don't switch to the signed-in variant until auth has fully resolved.
  // While loading is true, user is null even when the session exists, which
  // causes a guest→signed-in layout jump on every authenticated page load.
  const signedIn = !loading && !!user
  const prefilled = useRef(false)

  const avatarUrl = signedIn ? profile?.avatarUrl ?? null : guest.photoUrl

  // Report the resolved avatar URL upward whenever it settles.
  useEffect(() => {
    onAvatarUrlChange(avatarUrl)
  }, [avatarUrl, onAvatarUrlChange])

  // Suggest a display name once, without clobbering anything already typed.
  useEffect(() => {
    if (prefilled.current || name.trim()) return
    if (signedIn) {
      const suggested = profile?.nickname || profile?.fullName || ''
      if (suggested) {
        onNameChange(suggested)
        prefilled.current = true
      }
    } else if (guest.ready && guest.identity.nickname) {
      onNameChange(guest.identity.nickname)
      prefilled.current = true
    }
  }, [signedIn, profile, guest.ready, guest.identity.nickname, name, onNameChange])

  // Hand the parent a way to remember the guest's nickname on submit.
  useEffect(() => {
    if (!signedIn) onRememberGuestNickname?.(guest.setNickname)
  }, [signedIn, guest.setNickname, onRememberGuestNickname])

  // Signed-in: show profile avatar in the same PhotoUpload-sized slot so the
  // form dimensions are identical regardless of auth state.
  if (signedIn) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <PlayerAvatar
            src={avatarUrl}
            name={profile?.nickname || profile?.fullName || name}
            size="lg"
          />
          <Link
            href="/profile"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Pencil className="size-3" />
            Edit profile photo
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <PhotoUpload
        scope="guest"
        size="lg"
        name={name}
        currentUrl={guest.photoUrl}
        onUploaded={(photo) => guest.setPhoto(photo)}
        onCleared={() => guest.setPhoto(null)}
      />
      <p className="text-xs text-muted-foreground">
        Optional — add a photo, or{' '}
        <Link href="/profile" className="underline hover:text-foreground">
          sign in
        </Link>{' '}
        to save a profile and your game history.
      </p>
    </div>
  )
}
