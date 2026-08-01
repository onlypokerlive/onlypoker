'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { useAuth } from '@/components/auth-provider'
import { PhotoUpload } from '@/components/photo-upload'
import { SiteHeader } from '@/components/site-header'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'

type FullProfile = {
  id: string
  fullName: string | null
  nickname: string | null
  avatarPath: string | null
  avatarUrl: string | null
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="currentColor"
        d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.9 3.4 14.7 2.4 12 2.4 6.9 2.4 2.8 6.5 2.8 11.6S6.9 20.8 12 20.8c5.3 0 8.8-3.7 8.8-9 0-.6-.06-1-.15-1.6z"
      />
    </svg>
  )
}

export default function ProfilePage() {
  const { user, loading: authLoading, refreshProfile, signInWithGoogle } = useAuth()

  const [profile, setProfile] = useState<FullProfile | null>(null)
  const [fullName, setFullName] = useState('')
  const [nickname, setNickname] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      setLoading(false)
      return
    }
    let active = true
    fetch('/api/profile', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (!active || !data.profile) return
        const p = data.profile as FullProfile
        setProfile(p)
        setFullName(p.fullName ?? '')
        setNickname(p.nickname ?? '')
      })
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [authLoading, user])

  async function persist(patch: Record<string, unknown>, quiet = false) {
    setSaving(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Could not save.')
      setProfile(data.profile)
      await refreshProfile()
      if (!quiet) toast.success('Profile saved.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  if (authLoading || loading) {
    return (
      <main className="min-h-dvh">
        <SiteHeader />
        <div className="flex items-center justify-center py-24">
          <Spinner className="size-6" />
        </div>
      </main>
    )
  }

  if (!user) {
    return (
      <main className="min-h-dvh">
        <SiteHeader />
        <div className="mx-auto max-w-md px-5 py-20">
          <Card className="border-primary/15 shadow-xl">
            <CardHeader>
              <CardTitle className="font-serif text-2xl">
                Create your profile
              </CardTitle>
              <CardDescription>
                Sign in with Google to set a nickname and photo, and to keep a
                history of every game you play. Signing in is optional — you can
                still join and host tables as a guest.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => signInWithGoogle()} className="w-full">
                <GoogleMark />
                Continue with Google
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    )
  }

  const displayName = nickname || fullName || user?.email || 'Player'

  return (
    <main className="min-h-dvh">
      <SiteHeader />
      <div className="mx-auto max-w-lg px-5 py-10">
        <Card className="border-primary/15 shadow-xl">
          <CardHeader>
            <CardTitle className="font-serif text-2xl">Your profile</CardTitle>
            <CardDescription>
              Your nickname and photo are used when you join or host a table.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <Label>Profile photo</Label>
              <PhotoUpload
                scope="avatar"
                currentUrl={profile?.avatarUrl}
                name={displayName}
                onUploaded={(photo) =>
                  persist({ avatarPath: photo.path }, true).then(() =>
                    toast.success('Photo updated.'),
                  )
                }
                onCleared={() => persist({ avatarPath: null }, true)}
              />
            </div>

            <form
              className="flex flex-col gap-5"
              onSubmit={(e) => {
                e.preventDefault()
                persist({ fullName, nickname })
              }}
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="fullName">Full name</Label>
                <Input
                  id="fullName"
                  value={fullName}
                  maxLength={120}
                  placeholder="Jane Doe"
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="nickname">Nickname</Label>
                <Input
                  id="nickname"
                  value={nickname}
                  maxLength={40}
                  placeholder="The Closer"
                  onChange={(e) => setNickname(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Shown at the table. Defaults to your full name if left empty.
                </p>
              </div>

              <Button type="submit" disabled={saving} className="self-start">
                {saving && <Spinner className="size-4" />}
                Save changes
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
