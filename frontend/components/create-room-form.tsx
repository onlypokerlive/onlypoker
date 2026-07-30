'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Spade, ArrowRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { pokerApi, saveSession } from '@/lib/poker-api'

export function CreateRoomForm() {
  const router = useRouter()
  const [roomName, setRoomName] = useState('Friday Night Poker')
  const [hostName, setHostName] = useState('')
  const [startingChips, setStartingChips] = useState('1000')
  const [smallBlind, setSmallBlind] = useState('5')
  const [bigBlind, setBigBlind] = useState('10')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const sb = Number(smallBlind)
    const bb = Number(bigBlind)
    const chips = Number(startingChips)

    if (!hostName.trim()) return setError('Enter your display name.')
    if (!password.trim()) return setError('Set a room password to share.')
    if (bb <= sb) return setError('Big blind must be larger than the small blind.')
    if (chips < bb * 2)
      return setError('Starting chips should be at least twice the big blind.')

    setLoading(true)
    try {
      const session = await pokerApi.createRoom({
        name: roomName.trim(),
        hostName: hostName.trim(),
        startingChips: chips,
        smallBlind: sb,
        bigBlind: bb,
        password: password.trim(),
      })
      saveSession(session)
      router.push(`/room/${session.roomId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="roomName">Table name</FieldLabel>
          <Input
            id="roomName"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            maxLength={40}
            placeholder="Friday Night Poker"
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="hostName">Your name</FieldLabel>
          <Input
            id="hostName"
            value={hostName}
            onChange={(e) => setHostName(e.target.value)}
            maxLength={20}
            placeholder="e.g. Alex"
            autoComplete="off"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field>
            <FieldLabel htmlFor="smallBlind">Small blind</FieldLabel>
            <Input
              id="smallBlind"
              inputMode="numeric"
              value={smallBlind}
              onChange={(e) =>
                setSmallBlind(e.target.value.replace(/[^0-9]/g, ''))
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="bigBlind">Big blind</FieldLabel>
            <Input
              id="bigBlind"
              inputMode="numeric"
              value={bigBlind}
              onChange={(e) => setBigBlind(e.target.value.replace(/[^0-9]/g, ''))}
            />
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor="startingChips">Chips per player</FieldLabel>
          <Input
            id="startingChips"
            inputMode="numeric"
            value={startingChips}
            onChange={(e) =>
              setStartingChips(e.target.value.replace(/[^0-9]/g, ''))
            }
          />
          <FieldDescription>
            Everyone starts each session with this stack.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="password">Room password</FieldLabel>
          <Input
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            maxLength={64}
            placeholder="Share this with your friends"
            autoComplete="off"
          />
          <FieldDescription>
            Friends need this password to join from the invite link.
          </FieldDescription>
        </Field>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" disabled={loading} className="w-full">
          {loading ? (
            <>Creating table…</>
          ) : (
            <>
              <Spade data-icon="inline-start" />
              Create table
              <ArrowRight data-icon="inline-end" />
            </>
          )}
        </Button>
      </FieldGroup>
    </form>
  )
}
