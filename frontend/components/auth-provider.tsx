'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { User } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/client'

export type PlayerProfile = {
  id: string
  fullName: string | null
  nickname: string | null
  avatarUrl: string | null
}

type AuthContextValue = {
  user: User | null
  profile: PlayerProfile | null
  loading: boolean
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

async function fetchProfile(): Promise<PlayerProfile | null> {
  try {
    const res = await fetch('/srv/profile', { cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json()
    return data.profile ?? null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<PlayerProfile | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshProfile = useCallback(async () => {
    const p = await fetchProfile()
    setProfile(p)
  }, [])

  useEffect(() => {
    const supabase = createClient()
    let active = true

    supabase.auth.getUser().then(async ({ data }) => {
      if (!active) return
      setUser(data.user ?? null)
      if (data.user) await refreshProfile()
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!active) return
      setUser(session?.user ?? null)
      if (session?.user) {
        await refreshProfile()
      } else {
        setProfile(null)
      }
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [refreshProfile])

  const signInWithGoogle = useCallback(async () => {
    const supabase = createClient()
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo:
          process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL ??
          `${window.location.origin}/auth/callback`,
      },
    })
  }, [])

  const signOut = useCallback(async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
  }, [])

  const value = useMemo(
    () => ({
      user,
      profile,
      loading,
      signInWithGoogle,
      signOut,
      refreshProfile,
    }),
    [user, profile, loading, signInWithGoogle, signOut, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
