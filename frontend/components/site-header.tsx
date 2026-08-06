'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { LogOut, Spade } from 'lucide-react'

import { useAuth } from '@/components/auth-provider'
import { PlayerAvatar } from '@/components/player-avatar'
import { Button } from '@/components/ui/button'
import { APP_NAME } from '@/lib/app-name'

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.9 3.4 14.7 2.4 12 2.4 6.9 2.4 2.8 6.5 2.8 11.6S6.9 20.8 12 20.8c5.3 0 8.8-3.7 8.8-9 0-.6-.06-1-.15-1.6z"
      />
    </svg>
  )
}

export function SiteHeader() {
  const { user, profile, loading, signInWithGoogle, signOut } = useAuth()
  const router = useRouter()

  const displayName =
    profile?.nickname || profile?.fullName || user?.email || 'Player'

  return (
    <header className="border-b border-border/50">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
        <Link
          href="/"
          className="inline-flex items-center gap-2 font-serif text-lg font-bold"
        >
          <span className="flex size-7 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Spade className="size-4" />
          </span>
          {APP_NAME}
        </Link>

        {loading ? (
          <div className="size-8 animate-pulse rounded-full bg-muted" />
        ) : user ? (
          <div className="flex items-center gap-1">
            <Link
              href="/profile"
              className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
              aria-label="Go to your profile"
            >
              <PlayerAvatar
                src={profile?.avatarUrl}
                name={displayName}
                size="sm"
              />
              <span className="max-w-32 truncate text-sm font-semibold">
                {displayName}
              </span>
            </Link>
            <Button
              variant="ghost"
              size="icon"
              onClick={async () => {
                await signOut()
                router.refresh()
              }}
              aria-label="Sign out"
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        ) : (
          <Button variant="outline" onClick={() => signInWithGoogle()}>
            <GoogleMark />
            Sign in
          </Button>
        )}
      </div>
    </header>
  )
}
