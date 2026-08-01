'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, LogIn } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel } from '@/components/ui/field'
import { clearJoinAttempt, loadSession, pokerApi, saveSession } from '@/lib/poker-api'

export function JoinRoomForm({ roomId }: { roomId: string }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function enter(as: 'player' | 'spectator') {
    setError(null)
    if (as === 'player' && !name.trim()) return setError('Enter a display name.')
    if (!password.trim()) return setError('Enter the room password.')

    setLoading(true)
    try {
      const session =
        as === 'player'
          ? await pokerApi.joinRoom(
              roomId,
              name.trim(),
              password.trim(),
              // If this device still holds a credential for this table, it is
              // the same person coming back to it, not a new arrival.
              loadSession(roomId)?.token,
            )
          : await pokerApi.watchRoom(roomId, password.trim())
      saveSession(session)
      // The seat is confirmed and saved, so the attempt is over. Keeping the
      // name would make every later join from this device a "retry" of it.
      clearJoinAttempt(roomId)
      router.push(`/room/${session.roomId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join the room.')
      setLoading(false)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    void enter('player')
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <Field>
        <FieldLabel htmlFor="name">Your name</FieldLabel>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={20}
          placeholder="e.g. Sam"
          autoComplete="off"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="password">Room password</FieldLabel>
        <Input
          id="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          maxLength={64}
          placeholder="From the invite"
          autoComplete="off"
        />
      </Field>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" disabled={loading} className="w-full">
        <LogIn data-icon="inline-start" />
        {loading ? 'Joining…' : 'Take a seat'}
      </Button>

      {/* Turning up once the table is full, or after it has started, used to be
          a dead end. Watching needs no seat and no name — but it still needs
          the password, because the table is private either way. */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={loading}
        onClick={() => enter('spectator')}
        className="text-muted-foreground"
      >
        <Eye data-icon="inline-start" />
        Just watch
      </Button>
    </form>
  )
}
