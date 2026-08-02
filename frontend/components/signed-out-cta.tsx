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
    <div className="mt-3 flex items-center justify-between gap-3 px-1">
      <p className="text-xs text-muted-foreground">
        <Sparkles className="mb-0.5 mr-1 inline size-3" aria-hidden />
        Save history &amp; nickname across tables
      </p>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 shrink-0 text-xs"
        onClick={() => signInWithGoogle()}
      >
        <GoogleMark />
        Sign in
      </Button>
    </div>
  )
}
