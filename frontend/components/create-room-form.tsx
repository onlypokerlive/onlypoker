'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, ChevronDown, SlidersHorizontal, Spade } from 'lucide-react'

import { IdentityPhoto } from '@/components/identity-photo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PlayingCard } from '@/components/playing-card'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import {
  failureCategory,
  recordCreateAttempt,
  recordCreateFailed,
  recordCreateViewed,
  recordCustomizeOpened,
  recordRoomCreated,
  type CreationSource,
  type FailureCategory,
} from '@/lib/growth'
import { BLIND_STRUCTURES, pokerApi, saveSession } from '@/lib/poker-api'
import {
  BAIZES,
  DECKS,
  DEFAULT_BAIZE,
  DEFAULT_DECK,
  type BaizeId,
  type DeckId,
} from '@/lib/table-style'
import { cn } from '@/lib/utils'

const ANTE_MODES = [
  { id: 'off', label: 'None', blurb: 'No ante. Blinds only.' },
  {
    id: 'bb',
    label: 'Big blind',
    blurb: 'The big blind posts one extra blind for the whole table.',
  },
  {
    id: 'all',
    label: 'Everyone',
    blurb: 'Every player chips in a small ante each hand.',
  },
] as const

const BOMB_POT_CHOICES = [0, 10, 20] as const
const BREAK_CHOICES = [0, 3, 5] as const
const WINDOW_CHOICES = [
  { levels: 0, label: 'No' },
  { levels: 4, label: 'First 4 levels' },
  { levels: 99, label: 'Any time' },
] as const

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

type CreateField =
  | 'roomName'
  | 'hostName'
  | 'password'
  | 'startingChips'
  | 'smallBlind'
  | 'bigBlind'
  | 'levelMinutes'
  | 'actionSeconds'

type FormIssue = { field: CreateField | null; message: string }

function CustomSection({
  title,
  summary,
  children,
}: {
  title: string
  summary: string
  children: React.ReactNode
}) {
  return (
    <details className="group/section rounded-lg border border-border/55 bg-background/25 px-3">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-foreground">{title}</span>
          <span className="block truncate text-xs text-muted-foreground">{summary}</span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open/section:rotate-180" aria-hidden />
      </summary>
      <div className="flex flex-col gap-3 border-t border-border/45 pb-3 pt-3">
        {children}
      </div>
    </details>
  )
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
    preset.roomName ?? (source === 'rematch' ? 'The Rematch' : 'Friday Night Poker'),
  )
  const [hostName, setHostName] = useState('')
  const [hostAvatarUrl, setHostAvatarUrl] = useState<string | null>(null)
  // Set by IdentityPhoto for guests, so we can remember their name on submit.
  const rememberGuestNickname = useRef<((n: string) => void) | null>(null)
  const [startingChips, setStartingChips] = useState(String(preset.startingChips ?? 1000))
  const [smallBlind, setSmallBlind] = useState(String(preset.smallBlind ?? 5))
  const [bigBlind, setBigBlind] = useState(String(preset.bigBlind ?? 10))
  const [levelMinutes, setLevelMinutes] = useState(String(preset.levelMinutes ?? 10))
  const [actionSeconds, setActionSeconds] = useState(String(preset.actionSeconds ?? 20))
  const [anteMode, setAnteMode] = useState<(typeof ANTE_MODES)[number]['id']>('off')
  const [straddle, setStraddle] = useState(false)
  const [bombPotEvery, setBombPotEvery] = useState(0)
  const [sevenDeuce, setSevenDeuce] = useState(0)
  const [breakEveryLevels, setBreakEveryLevels] = useState(0)
  const [lateEntryLevels, setLateEntryLevels] = useState(4)
  const [rebuyLevels, setRebuyLevels] = useState(0)
  const [runItTwice, setRunItTwice] = useState(false)
  const [baize, setBaize] = useState<BaizeId>(preset.baize ?? DEFAULT_BAIZE)
  const [deck, setDeck] = useState<DeckId>(preset.deck ?? DEFAULT_DECK)
  const [password, setPassword] = useState('')
  const [customized, setCustomized] = useState(false)
  const [issue, setIssue] = useState<FormIssue | null>(null)
  const [loading, setLoading] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const formErrorRef = useRef<HTMLParagraphElement>(null)
  const submitRef = useRef<HTMLButtonElement>(null)
  const changedControlsRef = useRef(new Set<string>())
  const customizeRecordedRef = useRef(false)

  useEffect(() => {
    formRef.current?.setAttribute('data-ready', 'true')
    const frame = window.requestAnimationFrame(() => {
      const rect = submitRef.current?.getBoundingClientRect()
      recordCreateViewed(Boolean(rect && rect.top >= 0 && rect.bottom <= window.innerHeight))
    })
    return () => window.cancelAnimationFrame(frame)
  }, [])

  function markAdvanced(control: string) {
    changedControlsRef.current.add(control)
  }

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
    recordCreateAttempt({
      source,
      customized,
      changedControls: changedControlsRef.current.size,
    })

    const sb = Number(smallBlind)
    const bb = Number(bigBlind)
    const chips = Number(startingChips)
    const minutes = Number(levelMinutes)
    const seconds = Number(actionSeconds)

    if (!roomName.trim()) return showIssue('roomName', 'Give the table a name.')
    if (!hostName.trim()) return showIssue('hostName', 'Enter your display name.')
    if (password.trim().length < 4)
      return showIssue('password', 'Use at least 4 characters for the room password.')
    if (!sb || !bb || bb <= sb)
      return showIssue('bigBlind', 'Big blind must be larger than the small blind.')
    if (!chips || chips < bb * 2)
      return showIssue('startingChips', 'Starting chips should be at least twice the big blind.')
    if (minutes > 120)
      return showIssue('levelMinutes', 'Blind levels can last at most 120 minutes.')
    if (seconds > 120)
      return showIssue('actionSeconds', 'A decision can take at most 120 seconds.')

    rememberGuestNickname.current?.(hostName.trim())

    setLoading(true)
    try {
      const session = await pokerApi.createRoom({
        name: roomName.trim(),
        hostName: hostName.trim(),
        hostAvatarUrl,
        startingChips: chips,
        smallBlind: sb,
        bigBlind: bb,
        password: password.trim(),
        levelMinutes: minutes,
        actionSeconds: seconds,
        anteMode,
        straddle,
        bombPotEvery,
        sevenDeuce,
        breakEveryLevels,
        breakMinutes: 5,
        lateEntryLevels,
        lateEntryChips: 'start',
        allowLeaving: true,
        rebuyLevels,
        rebuysPerPlayer: 2,
        addOn: rebuyLevels > 0,
        timeBankSeconds: seconds ? 60 : 0,
        runItTwice,
        baize,
        deck,
      })
      saveSession(session)
      recordRoomCreated({ source, customized })
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
      <FieldGroup className="gap-3">
        <Field data-invalid={issue?.field === 'roomName'}>
          <FieldLabel htmlFor="roomName">Table name</FieldLabel>
          <Input
            id="roomName"
            value={roomName}
            onChange={(event) => {
              setRoomName(event.target.value)
              clearIssue('roomName')
            }}
            maxLength={40}
            placeholder="Friday Night Poker"
            aria-invalid={issue?.field === 'roomName'}
            aria-describedby={issue?.field === 'roomName' ? 'roomName-error' : undefined}
          />
          {issue?.field === 'roomName' ? <FieldError id="roomName-error">{issue.message}</FieldError> : null}
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field data-invalid={issue?.field === 'hostName'}>
            <FieldLabel htmlFor="hostName">Your name</FieldLabel>
            <Input
              id="hostName"
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
            {issue?.field === 'hostName' ? <FieldError id="hostName-error">{issue.message}</FieldError> : null}
          </Field>
          <Field data-invalid={issue?.field === 'password'}>
            <FieldLabel htmlFor="password">Room password</FieldLabel>
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
              aria-describedby={`password-hint${issue?.field === 'password' ? ' password-error' : ''}`}
            />
            <FieldDescription id="password-hint">
              Use 4+ characters. Only people with the password can enter or watch.
            </FieldDescription>
            {issue?.field === 'password' ? <FieldError id="password-error">{issue.message}</FieldError> : null}
          </Field>
        </div>

        <Field>
          <FieldLabel>Your photo <span className="text-muted-foreground font-normal">(optional)</span></FieldLabel>
          <IdentityPhoto
            name={hostName}
            onNameChange={setHostName}
            onAvatarUrlChange={setHostAvatarUrl}
            onRememberGuestNickname={(setter) => {
              rememberGuestNickname.current = setter
            }}
          />
        </Field>

        {issue?.field === null ? (
          <p ref={formErrorRef} tabIndex={-1} className="text-sm text-destructive outline-none" role="alert">
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
        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          Private by default. No account, download, or real-money chips.
        </p>

        <div
          aria-label="Table setup"
          className="rounded-lg border border-primary/15 bg-primary/5 px-3 py-2.5"
        >
          <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
            {smallBlind || '—'}/{bigBlind || '—'} blinds ·{' '}
            {Number(startingChips || 0).toLocaleString()} chips ·{' '}
            {levelMinutes === '0' ? 'fixed blinds' : `${levelMinutes} min levels`} ·{' '}
            {actionSeconds === '0'
              ? 'no action clock'
              : `${actionSeconds} sec clock + 60 sec time bank`}
          </p>
        </div>

        <details
          className="group rounded-lg border border-border bg-muted/20"
          onToggle={(event) => {
            if (event.currentTarget.open) {
              setCustomized(true)
              if (!customizeRecordedRef.current) {
                customizeRecordedRef.current = true
                recordCustomizeOpened()
              }
            }
          }}
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-[inherit] px-3 py-1.5 transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            <span className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
              <SlidersHorizontal className="size-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-foreground">Customize the night</span>
              <span className="block truncate text-xs text-muted-foreground">
                Stakes, pace, breaks and house rules
              </span>
            </span>
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
          </summary>

          <div className="flex flex-col gap-2 border-t border-border/70 px-3 pb-4 pt-3">
            <CustomSection title="Stakes" summary="Starting stack and opening blinds">
              <Field data-invalid={issue?.field === 'startingChips'}>
                <FieldLabel htmlFor="startingChips">Chips per player</FieldLabel>
                <Input
                  id="startingChips"
                  inputMode="numeric"
                  value={startingChips}
                  onChange={(event) => {
                    setStartingChips(event.target.value.replace(/[^0-9]/g, ''))
                    clearIssue('startingChips')
                    markAdvanced('starting-chips')
                  }}
                  aria-invalid={issue?.field === 'startingChips'}
                  aria-describedby={issue?.field === 'startingChips' ? 'startingChips-error' : undefined}
                />
                {issue?.field === 'startingChips' ? <FieldError id="startingChips-error">{issue.message}</FieldError> : null}
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field data-invalid={issue?.field === 'smallBlind'}>
                  <FieldLabel htmlFor="smallBlind">Small blind</FieldLabel>
                  <Input
                    id="smallBlind"
                    inputMode="numeric"
                    value={smallBlind}
                    onChange={(event) => {
                      setSmallBlind(event.target.value.replace(/[^0-9]/g, ''))
                      clearIssue('smallBlind')
                      markAdvanced('small-blind')
                    }}
                  />
                </Field>
                <Field data-invalid={issue?.field === 'bigBlind'}>
                  <FieldLabel htmlFor="bigBlind">Big blind</FieldLabel>
                  <Input
                    id="bigBlind"
                    inputMode="numeric"
                    value={bigBlind}
                    onChange={(event) => {
                      setBigBlind(event.target.value.replace(/[^0-9]/g, ''))
                      clearIssue('bigBlind')
                      markAdvanced('big-blind')
                    }}
                    aria-invalid={issue?.field === 'bigBlind'}
                    aria-describedby={issue?.field === 'bigBlind' ? 'bigBlind-error' : undefined}
                  />
                  {issue?.field === 'bigBlind' ? <FieldError id="bigBlind-error">{issue.message}</FieldError> : null}
                </Field>
              </div>
            </CustomSection>

            <CustomSection title="Pace" summary="Blind levels, action clock and time bank">
              <div className="grid grid-cols-3 gap-2">
                {BLIND_STRUCTURES.map((structure) => (
                  <Button
                    key={structure.id}
                    type="button"
                    variant={levelMinutes === String(structure.minutes) ? 'secondary' : 'outline'}
                    onClick={() => {
                      setLevelMinutes(String(structure.minutes))
                      markAdvanced('level-minutes')
                    }}
                    aria-pressed={levelMinutes === String(structure.minutes)}
                    className="flex h-auto flex-col gap-0 py-2"
                  >
                    <span className="text-sm font-semibold">{structure.label}</span>
                    <span className="text-[10px] font-normal opacity-70">{structure.minutes} min</span>
                  </Button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field data-invalid={issue?.field === 'levelMinutes'}>
                  <FieldLabel htmlFor="levelMinutes">Blinds up every</FieldLabel>
                  <Input
                    id="levelMinutes"
                    inputMode="numeric"
                    value={levelMinutes}
                    onChange={(event) => {
                      setLevelMinutes(event.target.value.replace(/[^0-9]/g, ''))
                      clearIssue('levelMinutes')
                      markAdvanced('level-minutes')
                    }}
                    aria-invalid={issue?.field === 'levelMinutes'}
                    aria-describedby={`levelMinutes-hint${issue?.field === 'levelMinutes' ? ' levelMinutes-error' : ''}`}
                  />
                  <FieldDescription id="levelMinutes-hint">Minutes. 0 keeps them fixed.</FieldDescription>
                  {issue?.field === 'levelMinutes' ? <FieldError id="levelMinutes-error">{issue.message}</FieldError> : null}
                </Field>
                <Field data-invalid={issue?.field === 'actionSeconds'}>
                  <FieldLabel htmlFor="actionSeconds">Time to act</FieldLabel>
                  <Input
                    id="actionSeconds"
                    inputMode="numeric"
                    value={actionSeconds}
                    onChange={(event) => {
                      setActionSeconds(event.target.value.replace(/[^0-9]/g, ''))
                      clearIssue('actionSeconds')
                      markAdvanced('action-seconds')
                    }}
                    aria-invalid={issue?.field === 'actionSeconds'}
                    aria-describedby={`actionSeconds-hint${issue?.field === 'actionSeconds' ? ' actionSeconds-error' : ''}`}
                  />
                  <FieldDescription id="actionSeconds-hint">
                    Seconds. 0 removes the clock; timed tables include a 60-second bank.
                  </FieldDescription>
                  {issue?.field === 'actionSeconds' ? <FieldError id="actionSeconds-error">{issue.message}</FieldError> : null}
                </Field>
              </div>
            </CustomSection>

            <CustomSection title="Antes & breaks" summary="Dead money and planned pauses">
              <Field>
                <FieldLabel>Ante</FieldLabel>
                <div className="grid grid-cols-3 gap-2">
                  {ANTE_MODES.map((ante) => (
                    <Button
                      key={ante.id}
                      type="button"
                      variant={anteMode === ante.id ? 'secondary' : 'outline'}
                      onClick={() => {
                        setAnteMode(ante.id)
                        markAdvanced('ante')
                      }}
                      aria-pressed={anteMode === ante.id}
                    >
                      {ante.label}
                    </Button>
                  ))}
                </div>
                <FieldDescription>
                  {ANTE_MODES.find((ante) => ante.id === anteMode)?.blurb}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel>Breaks</FieldLabel>
                <div className="grid grid-cols-3 gap-2">
                  {BREAK_CHOICES.map((choice) => (
                    <Button
                      key={choice}
                      type="button"
                      variant={breakEveryLevels === choice ? 'secondary' : 'outline'}
                      onClick={() => {
                        setBreakEveryLevels(choice)
                        markAdvanced('breaks')
                      }}
                      aria-pressed={breakEveryLevels === choice}
                      className="h-auto whitespace-normal px-2 py-2 text-xs"
                    >
                      {choice === 0 ? 'None' : `Every ${choice} levels`}
                    </Button>
                  ))}
                </div>
              </Field>
            </CustomSection>

            <CustomSection title="House rules" summary="Straddle, 7-2, run it twice and bomb pots">
              <Button
                type="button"
                variant={straddle ? 'secondary' : 'outline'}
                onClick={() => {
                  setStraddle((value) => !value)
                  markAdvanced('straddle')
                }}
                aria-pressed={straddle}
                className="h-auto justify-start py-2 text-left"
              >
                <span className="flex flex-col">
                  <span className="text-sm font-semibold">Straddle</span>
                  <span className="text-[11px] font-normal opacity-70">
                    UTG posts two big blinds and acts last preflop.
                  </span>
                </span>
              </Button>
              <Button
                type="button"
                variant={sevenDeuce ? 'secondary' : 'outline'}
                onClick={() => {
                  setSevenDeuce((value) => (value ? 0 : 2))
                  markAdvanced('seven-deuce')
                }}
                aria-pressed={Boolean(sevenDeuce)}
                className="h-auto justify-start py-2 text-left"
              >
                <span className="flex flex-col">
                  <span className="text-sm font-semibold">The 7-2 game</span>
                  <span className="text-[11px] font-normal opacity-70">
                    Win with seven-deuce offsuit and collect two big blinds each.
                  </span>
                </span>
              </Button>
              <Button
                type="button"
                variant={runItTwice ? 'secondary' : 'outline'}
                onClick={() => {
                  setRunItTwice((value) => !value)
                  markAdvanced('run-it-twice')
                }}
                aria-pressed={runItTwice}
                className="h-auto justify-start py-2 text-left"
              >
                <span className="flex flex-col">
                  <span className="text-sm font-semibold">Run it twice</span>
                  <span className="text-[11px] font-normal opacity-70">
                    All remaining players can agree to deal two boards.
                  </span>
                </span>
              </Button>
              <Field>
                <FieldLabel>Bomb pots</FieldLabel>
                <div className="grid grid-cols-3 gap-2">
                  {BOMB_POT_CHOICES.map((choice) => (
                    <Button
                      key={choice}
                      type="button"
                      variant={bombPotEvery === choice ? 'secondary' : 'outline'}
                      onClick={() => {
                        setBombPotEvery(choice)
                        markAdvanced('bomb-pots')
                      }}
                      aria-pressed={bombPotEvery === choice}
                    >
                      {choice === 0 ? 'Off' : `Every ${choice}`}
                    </Button>
                  ))}
                </div>
              </Field>
            </CustomSection>

            <CustomSection title="Doors & second chances" summary="Late entry and buying back in">
              <Field>
                <FieldLabel>Turning up late</FieldLabel>
                <div className="grid grid-cols-3 gap-2">
                  {WINDOW_CHOICES.map((choice) => (
                    <Button
                      key={choice.levels}
                      type="button"
                      variant={lateEntryLevels === choice.levels ? 'secondary' : 'outline'}
                      onClick={() => {
                        setLateEntryLevels(choice.levels)
                        markAdvanced('late-entry')
                      }}
                      aria-pressed={lateEntryLevels === choice.levels}
                      className="h-auto whitespace-normal px-2 py-2 text-xs"
                    >
                      {choice.label}
                    </Button>
                  ))}
                </div>
              </Field>
              <Field>
                <FieldLabel>Buying back in</FieldLabel>
                <div className="grid grid-cols-3 gap-2">
                  {WINDOW_CHOICES.map((choice) => (
                    <Button
                      key={choice.levels}
                      type="button"
                      variant={rebuyLevels === choice.levels ? 'secondary' : 'outline'}
                      onClick={() => {
                        setRebuyLevels(choice.levels)
                        markAdvanced('rebuys')
                      }}
                      aria-pressed={rebuyLevels === choice.levels}
                      className="h-auto whitespace-normal px-2 py-2 text-xs"
                    >
                      {choice.label}
                    </Button>
                  ))}
                </div>
              </Field>
            </CustomSection>

            <CustomSection title="Table look" summary="Cloth and deck shared by everyone">
              <Field>
                <FieldLabel>Table cloth</FieldLabel>
                <div className="grid grid-cols-4 gap-2">
                  {BAIZES.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      data-baize={option.id}
                      onClick={() => {
                        setBaize(option.id)
                        markAdvanced('baize')
                      }}
                      aria-pressed={baize === option.id}
                      title={option.blurb}
                      className={cn(
                        'tactile flex min-h-11 flex-col items-center gap-1 rounded-lg border p-1.5',
                        baize === option.id ? 'border-primary' : 'border-border/60',
                      )}
                    >
                      <span className="baize h-7 w-full rounded" aria-hidden />
                      <span className="text-[10px] text-muted-foreground">{option.label}</span>
                    </button>
                  ))}
                </div>
                <FieldDescription>The cloth every player sees at this table.</FieldDescription>
              </Field>

              <Field>
                <FieldLabel>Deck</FieldLabel>
                <div className="grid grid-cols-4 gap-2">
                  {DECKS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      data-deck={option.id}
                      onClick={() => {
                        setDeck(option.id)
                        markAdvanced('deck')
                      }}
                      aria-pressed={deck === option.id}
                      title={option.blurb}
                      className={cn(
                        'tactile flex min-h-11 flex-col items-center gap-1 rounded-lg border p-1.5',
                        deck === option.id ? 'border-primary' : 'border-border/60',
                      )}
                    >
                      <span
                        className="flex w-full items-center justify-center gap-0.5 rounded px-1 py-1.5"
                        style={{
                          background:
                            'radial-gradient(ellipse at 50% 30%, #17604B, #08281D 88%)',
                          boxShadow:
                            'inset 0 0 0 1px rgba(0,0,0,.4), inset 0 2px 8px rgba(0,0,0,.5)',
                        }}
                        aria-hidden
                      >
                        <PlayingCard card="Ah" size="xs" />
                        <PlayingCard card="Kd" size="xs" />
                        <PlayingCard card={null} faceDown size="xs" />
                      </span>
                      <span className="text-[10px] text-muted-foreground">{option.label}</span>
                    </button>
                  ))}
                </div>
                <FieldDescription>The card faces and backs used all night.</FieldDescription>
              </Field>
            </CustomSection>
          </div>
        </details>

      </FieldGroup>
    </form>
  )
}
