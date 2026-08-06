'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Spade } from 'lucide-react'

import { IdentityPhoto } from '@/components/identity-photo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import {
  failureCategory,
  recordCreateAttempt,
  recordCreateFailed,
  recordCreateViewed,
  recordRoomCreated,
  type CreationSource,
  type FailureCategory,
} from '@/lib/growth'
import { pokerApi, saveSession } from '@/lib/poker-api'
import { DEFAULT_RULES, startingChips, type TableRules } from '@/lib/table-rules'
import type { BaizeId, DeckId } from '@/lib/table-style'

/**
 * The first screen asks four things, and none of them is a rule.
 *
 * It used to ask twenty, on the screen where somebody has not yet decided they
 * are even doing this — and the button that does the thing was below the fold
 * on every phone as a result. The night itself is now agreed in the lobby,
 * where the people it applies to can see it. What is left here is what the
 * table cannot exist without: who you are, what it is called, and the password
 * that keeps it yours.
 *
 * The word is "table" throughout. "Room" and "table" were both on this screen
 * at once — "Room password" above "Create table" — and it is the button and
 * the README that win.
 */

export interface CreateRoomPreset {
  roomName?: string
  startingChips?: number
  smallBlind?: number
  bigBlind?: number
  levelMinutes?: number
  actionSeconds?: number
  baize?: BaizeId
  deck?: DeckId
}

type CreateField = 'roomName' | 'hostName' | 'password'

type FormIssue = { field: CreateField | null; message: string }

/**
 * The rules a table starts life with.
 *
 * Nothing on this screen changes them; a rematch inherits the stakes of the
 * night it is repeating, because "same again" is the whole of what that button
 * means and asking the host to rebuild it in the lobby would be the opposite.
 */
function openingRules(preset: CreateRoomPreset): TableRules {
  const bigBlind = preset.bigBlind ?? DEFAULT_RULES.bigBlind
  return {
    ...DEFAULT_RULES,
    smallBlind: preset.smallBlind ?? DEFAULT_RULES.smallBlind,
    bigBlind,
    // Chip for chip. A rematch inherits the stacks of a real night, which are
    // rarely a round number of blinds, and turning those into a blind count
    // and back is how "same again" quietly becomes "nearly the same".
    startingChips: preset.startingChips ?? DEFAULT_RULES.startingChips,
    levelMinutes: preset.levelMinutes ?? DEFAULT_RULES.levelMinutes,
    actionSeconds: preset.actionSeconds ?? DEFAULT_RULES.actionSeconds,
    baize: preset.baize ?? DEFAULT_RULES.baize,
    deck: preset.deck ?? DEFAULT_RULES.deck,
  }
}

export function CreateRoomForm({
  source = 'home',
  preset = {},
}: {
  source?: CreationSource
  preset?: CreateRoomPreset
}) {
  const router = useRouter()
  const [roomName, setRoomName] = useState(
    preset.roomName ?? (source === 'rematch' ? 'The Rematch' : 'Poker Night'),
  )
  const [hostName, setHostName] = useState('')
  const [hostAvatarUrl, setHostAvatarUrl] = useState<string | null>(null)
  const rememberGuestNickname = useRef<((n: string) => void) | null>(null)
  const [password, setPassword] = useState('')
  const [issue, setIssue] = useState<FormIssue | null>(null)
  const [loading, setLoading] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const formErrorRef = useRef<HTMLParagraphElement>(null)
  const submitRef = useRef<HTMLButtonElement>(null)
  // Inherited, not edited. Held in a ref so it cannot become a render loop.
  const rules = useRef(openingRules(preset))

  useEffect(() => {
    formRef.current?.setAttribute('data-ready', 'true')
    const frame = window.requestAnimationFrame(() => {
      const rect = submitRef.current?.getBoundingClientRect()
      recordCreateViewed(Boolean(rect && rect.top >= 0 && rect.bottom <= window.innerHeight))
    })
    return () => window.cancelAnimationFrame(frame)
  }, [])

  function clearIssue(field: CreateField) {
    if (issue?.field === field) setIssue(null)
  }

  function showIssue(
    field: CreateField | null,
    message: string,
    stage: 'validation' | 'api' = 'validation',
    category: FailureCategory = 'validation',
  ) {
    setIssue({ field, message })
    recordCreateFailed({ source, stage, field: field ?? 'form', category })
    window.requestAnimationFrame(() => {
      if (field) document.getElementById(field)?.focus()
      else formErrorRef.current?.focus()
    })
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setIssue(null)
    // The rules are no longer set here, so there are no controls to count.
    // A rematch is the one table that arrives already shaped by a decision.
    recordCreateAttempt({
      source,
      customized: source === 'rematch',
      changedControls: 0,
    })

    if (!roomName.trim()) return showIssue('roomName', 'Give the table a name.')
    if (!hostName.trim()) return showIssue('hostName', 'Enter your display name.')
    if (password.trim().length < 4)
      return showIssue('password', 'Use at least 4 characters for the table password.')

    rememberGuestNickname.current?.(hostName.trim())

    const opening = rules.current
    setLoading(true)
    try {
      const session = await pokerApi.createRoom({
        name: roomName.trim(),
        hostName: hostName.trim(),
        hostAvatarUrl,
        password: password.trim(),
        startingChips: startingChips(opening),
        smallBlind: opening.smallBlind,
        bigBlind: opening.bigBlind,
        levelMinutes: opening.levelMinutes,
        blindLadder: opening.blindLadder,
        actionSeconds: opening.actionSeconds,
        timeBankSeconds: opening.timeBankSeconds,
        anteMode: opening.anteMode,
        straddle: opening.straddle,
        bombPotEvery: opening.bombPotEvery,
        sevenDeuce: opening.sevenDeuce,
        runItTwice: opening.runItTwice,
        breakEveryLevels: opening.breakEveryLevels,
        breakMinutes: opening.breakMinutes,
        lateEntryLevels: opening.lateEntryLevels,
        lateEntryChips: opening.lateEntryChips,
        allowLeaving: opening.allowLeaving,
        rebuyLevels: opening.rebuyLevels,
        rebuysPerPlayer: opening.rebuysPerPlayer,
        rebuyChips: opening.rebuyChips,
        addOn: opening.addOn,
        baize: opening.baize,
        deck: opening.deck,
      })
      saveSession(session)
      recordRoomCreated({ source, customized: source === 'rematch' })
      router.push(`/room/${session.roomId}`)
    } catch (caught) {
      showIssue(
        null,
        caught instanceof Error ? caught.message : 'Something went wrong.',
        'api',
        failureCategory(caught),
      )
      setLoading(false)
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} aria-busy={loading} noValidate>
      <FieldGroup className="gap-2">
        <Field className="gap-1.5" data-invalid={issue?.field === 'hostName'}>
          <FieldLabel className="text-[12.5px]" htmlFor="hostName">
            Your profile{' '}
            <span className="font-medium text-primary/85">· you’re the host</span>
          </FieldLabel>
          {/* The photo goes in the line, not above it. As a block it cost
              sixty pixels of height; as the disc in front of the name it costs
              none, and those sixty are what the button needs to stay in
              sight. */}
          <div className="flex items-center gap-2">
            <IdentityPhoto
              layout="disc"
              name={hostName}
              onNameChange={setHostName}
              onAvatarUrlChange={setHostAvatarUrl}
              onRememberGuestNickname={(setter) => {
                rememberGuestNickname.current = setter
              }}
            />
            <Input
              id="hostName"
              className="min-w-0 flex-1"
              value={hostName}
              onChange={(event) => {
                setHostName(event.target.value)
                clearIssue('hostName')
              }}
              maxLength={20}
              placeholder="e.g. Alex"
              autoComplete="nickname"
              aria-invalid={issue?.field === 'hostName'}
              aria-describedby={issue?.field === 'hostName' ? 'hostName-error' : undefined}
            />
          </div>
          {issue?.field === 'hostName' ? (
            <FieldError id="hostName-error">{issue.message}</FieldError>
          ) : null}
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field className="gap-1.5" data-invalid={issue?.field === 'roomName'}>
            <FieldLabel className="text-[12.5px]" htmlFor="roomName">Table name</FieldLabel>
            <Input
              id="roomName"
              value={roomName}
              onChange={(event) => {
                setRoomName(event.target.value)
                clearIssue('roomName')
              }}
              maxLength={40}
              placeholder="Poker Night"
              aria-invalid={issue?.field === 'roomName'}
              aria-describedby={issue?.field === 'roomName' ? 'roomName-error' : undefined}
            />
            {issue?.field === 'roomName' ? (
              <FieldError id="roomName-error">{issue.message}</FieldError>
            ) : null}
          </Field>
          <Field className="gap-1.5" data-invalid={issue?.field === 'password'}>
            <FieldLabel className="text-[12.5px]" htmlFor="password">Password</FieldLabel>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                clearIssue('password')
              }}
              minLength={4}
              maxLength={64}
              placeholder="For your friends"
              autoComplete="new-password"
              aria-invalid={issue?.field === 'password'}
              aria-describedby={issue?.field === 'password' ? 'password-error' : undefined}
            />
            {issue?.field === 'password' ? (
              <FieldError id="password-error">{issue.message}</FieldError>
            ) : null}
          </Field>
        </div>

        {issue?.field === null ? (
          <p
            ref={formErrorRef}
            tabIndex={-1}
            className="text-sm text-destructive outline-none"
            role="alert"
          >
            {issue.message}
          </p>
        ) : null}

        <Button ref={submitRef} type="submit" size="lg" disabled={loading} className="w-full">
          {loading ? (
            <>Opening the table…</>
          ) : (
            <>
              <Spade data-icon="inline-start" />
              {source === 'rematch' ? 'Create rematch' : 'Create table'}
              <ArrowRight data-icon="inline-end" />
            </>
          )}
        </Button>
        {/* One line, and the three things that are actually different about
            this. "You set the rules on the next screen" went: the button says
            where it goes, and the two lines it took were two lines the table
            above needed to keep its shape on a 568px phone. */}
        <p className="text-center text-[11px] leading-snug text-muted-foreground">
          No account, no download, no real money.
        </p>
      </FieldGroup>
    </form>
  )
}
