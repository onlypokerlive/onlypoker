'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { History, LogOut, Spade, User } from 'lucide-react'

import { useAuth } from '@/components/auth-provider'
import { PlayerAvatar } from '@/components/player-avatar'
import { Button } from '@/components/ui/button'

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
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    if (!menuOpen) return
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    window.addEventListener('mousedown', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

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
          OnlyPoker
        </Link>

        {loading ? (
          <div className="size-8 animate-pulse rounded-full bg-muted" />
        ) : user ? (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className="flex items-center gap-2 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Account menu"
            >
              <PlayerAvatar
                src={profile?.avatarUrl}
                name={displayName}
                size="sm"
              />
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-xl border border-border/60 bg-card p-1 shadow-xl"
              >
                <div className="px-3 py-2">
                  <p className="truncate text-sm font-semibold text-card-foreground">
                    {displayName}
                  </p>
                  {user.email && (
                    <p className="truncate text-xs text-muted-foreground">
                      {user.email}
                    </p>
                  )}
                </div>
                <div className="my-1 h-px bg-border/60" />
                <Link
                  href="/profile"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-card-foreground hover:bg-muted"
                >
                  <User className="size-4" />
                  My profile
                </Link>
                <Link
                  href="/history"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-card-foreground hover:bg-muted"
                >
                  <History className="size-4" />
                  Game history
                </Link>
                <div className="my-1 h-px bg-border/60" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={async () => {
                    setMenuOpen(false)
                    await signOut()
                    router.refresh()
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-card-foreground hover:bg-muted"
                >
                  <LogOut className="size-4" />
                  Sign out
                </button>
              </div>
            )}
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
