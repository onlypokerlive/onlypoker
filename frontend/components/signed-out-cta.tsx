'use client'

import Link from 'next/link'
import { History, Sparkles } from 'lucide-react'

import { useAuth } from '@/components/auth-provider'
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

export function SignedOutCta() {
  const { user, profile, loading, signInWithGoogle } = useAuth()

  if (loading) return null

  if (user) {
    return (
      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-muted/30 px-4 py-3">
        <p className="text-sm text-muted-foreground">
          Signed in as{' '}
          <span className="font-medium text-foreground">
            {profile?.nickname || profile?.fullName || user.email}
          </span>
        </p>
        <Button render={<Link href="/history" />} variant="ghost" size="sm">
          <History className="size-4" />
          History
        </Button>
      </div>
    )
  }

  return (
    <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 px-4 py-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Sparkles className="size-4" />
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold">Save your games (optional)</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Sign in to keep a nickname and photo across tables and review your
            game history. You can always keep playing as a guest.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => signInWithGoogle()}
          >
            <GoogleMark />
            Sign in with Google
          </Button>
        </div>
      </div>
    </div>
  )
}
