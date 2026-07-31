'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogIn } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel } from '@/components/ui/field'
import { pokerApi, saveSession } from '@/lib/poker-api'

export function JoinRoomForm({ roomId }: { roomId: string }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim()) return setError('Enter a display name.')
    if (!password.trim()) return setError('Enter the room password.')

    setLoading(true)
    try {
      const session = await pokerApi.joinRoom(
        roomId,
        name.trim(),
        password.trim(),
      )
      saveSession(session)
      router.push(`/room/${session.roomId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join the room.')
      setLoading(false)
    }
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
    </form>
  )
}
