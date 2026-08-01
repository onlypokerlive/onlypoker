'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Eye, KeyRound, LogIn } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { clearJoinAttempt, loadSession, pokerApi, saveSession } from '@/lib/poker-api'
import {
  failureCategory,
  recordHostContinuity,
  recordInvitationViewed,
  recordJoinAttempt,
  recordJoinFailed,
  recordRoomJoined,
  type PreviewStatus,
} from '@/lib/growth'

export function JoinRoomForm({
  roomId,
  previewStatus = 'available',
}: {
  roomId: string
  previewStatus?: Exclude<PreviewStatus, 'missing'>
}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [issue, setIssue] = useState<{
    field: 'name' | 'password' | 'recoveryCode' | null
    message: string
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const formErrorRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => recordInvitationViewed(previewStatus), [previewStatus])

  function showIssue(field: 'name' | 'password' | 'recoveryCode' | null, message: string) {
    setIssue({ field, message })
    window.requestAnimationFrame(() => {
      if (field) document.getElementById(field)?.focus()
      else formErrorRef.current?.focus()
    })
  }

  async function enter(as: 'player' | 'spectator') {
    setIssue(null)
    recordJoinAttempt(as, previewStatus)
    if (as === 'player' && !name.trim()) {
      recordJoinFailed(as, 'validation')
      return showIssue('name', 'Enter a display name.')
    }
    if (!password.trim()) {
      recordJoinFailed(as, 'validation')
      return showIssue('password', 'Enter the room password.')
    }

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
      // A host reopening their own invitation is returning, not an acquired
      // guest. Keep both the join count and guest-to-host attribution honest.
      if (!session.isHost) recordRoomJoined(roomId, as)
      // The seat is confirmed and saved, so the attempt is over. Keeping the
      // name would make every later join from this device a "retry" of it.
      clearJoinAttempt(roomId)
      router.push(`/room/${session.roomId}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not join the room.'
      recordJoinFailed(as, failureCategory(err))
      showIssue(message.toLowerCase().includes('password') ? 'password' : null, message)
      setLoading(false)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    void enter('player')
  }

  async function recoverHost() {
    setIssue(null)
    recordHostContinuity('recover', 'attempted')
    if (!password.trim()) {
      recordHostContinuity('recover', 'failed', 'validation')
      return showIssue('password', 'Enter the room password.')
    }
    if (!recoveryCode.trim()) {
      recordHostContinuity('recover', 'failed', 'validation')
      return showIssue('recoveryCode', 'Enter the host backup code.')
    }
    setLoading(true)
    try {
      const recovered = await pokerApi.recoverHost(
        roomId,
        password.trim(),
        recoveryCode.trim(),
      )
      saveSession(recovered)
      clearJoinAttempt(roomId)
      recordHostContinuity('recover', 'succeeded')
      router.push(`/room/${recovered.roomId}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not recover host access.'
      recordHostContinuity('recover', 'failed', failureCategory(error))
      // The server intentionally does not reveal which of the two secrets was
      // wrong. Keep that neutral here too instead of pointing at one field.
      showIssue(null, message)
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" aria-busy={loading} noValidate>
      <Field data-invalid={issue?.field === 'name'}>
        <FieldLabel htmlFor="name">Your name (for a seat)</FieldLabel>
        <Input
          id="name"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            if (issue?.field === 'name') setIssue(null)
          }}
          maxLength={20}
          placeholder="e.g. Sam"
          autoComplete="off"
          aria-invalid={issue?.field === 'name'}
          aria-describedby={`name-hint${issue?.field === 'name' ? ' name-error' : ''}`}
        />
        <FieldDescription id="name-hint">Only needed when you take a seat.</FieldDescription>
        {issue?.field === 'name' ? <FieldError id="name-error">{issue.message}</FieldError> : null}
      </Field>
      <Field data-invalid={issue?.field === 'password'}>
        <FieldLabel htmlFor="password">Room password</FieldLabel>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            if (issue?.field === 'password') setIssue(null)
          }}
          maxLength={64}
          placeholder="From the invite"
          autoComplete="off"
          aria-invalid={issue?.field === 'password'}
          aria-describedby={issue?.field === 'password' ? 'join-password-error' : undefined}
        />
        {issue?.field === 'password' ? <FieldError id="join-password-error">{issue.message}</FieldError> : null}
      </Field>

      {issue?.field === null && (
        <p ref={formErrorRef} tabIndex={-1} className="text-sm text-destructive outline-none" role="alert">
          {issue.message}
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

      <details className="group rounded-xl border border-border/55 bg-muted/15 px-3">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-sm text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2">
            <KeyRound className="size-4 text-primary/70" aria-hidden />
            Host on a new device?
          </span>
          <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="flex flex-col gap-3 border-t border-border/45 pb-3 pt-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Use the one-time backup code saved from Host controls. Recovery signs the old host device out.
          </p>
          <Field data-invalid={issue?.field === 'recoveryCode'}>
            <FieldLabel htmlFor="recoveryCode">Host backup code</FieldLabel>
            <Input
              id="recoveryCode"
              value={recoveryCode}
              onChange={(event) => {
                setRecoveryCode(event.target.value)
                if (issue?.field === 'recoveryCode') setIssue(null)
              }}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={issue?.field === 'recoveryCode'}
              aria-describedby={issue?.field === 'recoveryCode' ? 'recoveryCode-error' : undefined}
            />
            {issue?.field === 'recoveryCode' ? (
              <FieldError id="recoveryCode-error">{issue.message}</FieldError>
            ) : null}
          </Field>
          <Button type="button" variant="outline" size="lg" disabled={loading} onClick={recoverHost}>
            <KeyRound data-icon="inline-start" />
            Recover host access
          </Button>
        </div>
      </details>
    </form>
  )
}
