'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, ChevronDown, SlidersHorizontal, Spade } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { recordRoomCreated, type CreationSource } from '@/lib/growth'
import { BLIND_STRUCTURES, pokerApi, saveSession } from '@/lib/poker-api'

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
}

function SettingHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/80">
      {children}
    </h3>
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
  const [password, setPassword] = useState('')
  const [customized, setCustomized] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    const sb = Number(smallBlind)
    const bb = Number(bigBlind)
    const chips = Number(startingChips)
    const minutes = Number(levelMinutes)
    const seconds = Number(actionSeconds)

    if (!roomName.trim()) return setError('Give the table a name.')
    if (!hostName.trim()) return setError('Enter your display name.')
    if (!password.trim()) return setError('Set a room password to share.')
    if (!sb || !bb || bb <= sb)
      return setError('Big blind must be larger than the small blind.')
    if (!chips || chips < bb * 2)
      return setError('Starting chips should be at least twice the big blind.')
    if (minutes > 120) return setError('Blind levels can last at most 120 minutes.')
    if (seconds > 120) return setError('A decision can take at most 120 seconds.')

    setLoading(true)
    try {
      const session = await pokerApi.createRoom({
        name: roomName.trim(),
        hostName: hostName.trim(),
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
      })
      saveSession(session)
      recordRoomCreated({ source, customized })
      router.push(`/room/${session.roomId}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong.')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel htmlFor="roomName">Table name</FieldLabel>
          <Input
            id="roomName"
            value={roomName}
            onChange={(event) => setRoomName(event.target.value)}
            maxLength={40}
            placeholder="Friday Night Poker"
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="hostName">Your name</FieldLabel>
            <Input
              id="hostName"
              value={hostName}
              onChange={(event) => setHostName(event.target.value)}
              maxLength={20}
              placeholder="e.g. Alex"
              autoComplete="nickname"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">Room password</FieldLabel>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              maxLength={64}
              placeholder="For your friends"
              autoComplete="new-password"
            />
          </Field>
        </div>

        <div
          aria-label="Table setup"
          className="rounded-lg border border-primary/15 bg-primary/5 px-3 py-2.5"
        >
          <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
            {smallBlind || '—'}/{bigBlind || '—'} blinds ·{' '}
            {Number(startingChips || 0).toLocaleString()} chips ·{' '}
            {levelMinutes === '0' ? 'fixed blinds' : `${levelMinutes} min levels`} ·{' '}
            {actionSeconds === '0' ? 'no action clock' : `${actionSeconds} sec clock`}
          </p>
        </div>

        <details
          className="group rounded-lg border border-border bg-muted/20"
          onToggle={(event) => {
            if (event.currentTarget.open) setCustomized(true)
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

          <div className="flex flex-col gap-6 border-t border-border/70 px-3 pb-4 pt-5">
            <section className="flex flex-col gap-3">
              <SettingHeading>Stakes</SettingHeading>
              <Field>
                <FieldLabel htmlFor="startingChips">Chips per player</FieldLabel>
                <Input
                  id="startingChips"
                  inputMode="numeric"
                  value={startingChips}
                  onChange={(event) =>
                    setStartingChips(event.target.value.replace(/[^0-9]/g, ''))
                  }
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor="smallBlind">Small blind</FieldLabel>
                  <Input
                    id="smallBlind"
                    inputMode="numeric"
                    value={smallBlind}
                    onChange={(event) =>
                      setSmallBlind(event.target.value.replace(/[^0-9]/g, ''))
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="bigBlind">Big blind</FieldLabel>
                  <Input
                    id="bigBlind"
                    inputMode="numeric"
                    value={bigBlind}
                    onChange={(event) =>
                      setBigBlind(event.target.value.replace(/[^0-9]/g, ''))
                    }
                  />
                </Field>
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <SettingHeading>Pace</SettingHeading>
              <div className="grid grid-cols-3 gap-2">
                {BLIND_STRUCTURES.map((structure) => (
                  <Button
                    key={structure.id}
                    type="button"
                    variant={levelMinutes === String(structure.minutes) ? 'secondary' : 'outline'}
                    onClick={() => setLevelMinutes(String(structure.minutes))}
                    aria-pressed={levelMinutes === String(structure.minutes)}
                    className="flex h-auto flex-col gap-0 py-2"
                  >
                    <span className="text-sm font-semibold">{structure.label}</span>
                    <span className="text-[10px] font-normal opacity-70">{structure.minutes} min</span>
                  </Button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor="levelMinutes">Blinds up every</FieldLabel>
                  <Input
                    id="levelMinutes"
                    inputMode="numeric"
                    value={levelMinutes}
                    onChange={(event) =>
                      setLevelMinutes(event.target.value.replace(/[^0-9]/g, ''))
                    }
                  />
                  <FieldDescription>Minutes. 0 keeps them fixed.</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="actionSeconds">Time to act</FieldLabel>
                  <Input
                    id="actionSeconds"
                    inputMode="numeric"
                    value={actionSeconds}
                    onChange={(event) =>
                      setActionSeconds(event.target.value.replace(/[^0-9]/g, ''))
                    }
                  />
                  <FieldDescription>Seconds. 0 removes the clock.</FieldDescription>
                </Field>
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <SettingHeading>Antes & breaks</SettingHeading>
              <Field>
                <FieldLabel>Ante</FieldLabel>
                <div className="grid grid-cols-3 gap-2">
                  {ANTE_MODES.map((ante) => (
                    <Button
                      key={ante.id}
                      type="button"
                      variant={anteMode === ante.id ? 'secondary' : 'outline'}
                      onClick={() => setAnteMode(ante.id)}
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
                      onClick={() => setBreakEveryLevels(choice)}
                      aria-pressed={breakEveryLevels === choice}
                      className="h-auto whitespace-normal px-2 py-2 text-xs"
                    >
                      {choice === 0 ? 'None' : `Every ${choice} levels`}
                    </Button>
                  ))}
                </div>
              </Field>
            </section>

            <section className="flex flex-col gap-3">
              <SettingHeading>House rules</SettingHeading>
              {[
                {
                  label: 'Straddle',
                  blurb: 'UTG posts two big blinds and acts last preflop.',
                  selected: straddle,
                  toggle: () => setStraddle((value) => !value),
                },
                {
                  label: 'The 7-2 game',
                  blurb: 'Win with seven-deuce offsuit and collect two big blinds each.',
                  selected: !!sevenDeuce,
                  toggle: () => setSevenDeuce((value) => (value ? 0 : 2)),
                },
                {
                  label: 'Run it twice',
                  blurb: 'All remaining players can agree to deal two boards.',
                  selected: runItTwice,
                  toggle: () => setRunItTwice((value) => !value),
                },
              ].map((rule) => (
                <Button
                  key={rule.label}
                  type="button"
                  variant={rule.selected ? 'secondary' : 'outline'}
                  onClick={rule.toggle}
                  aria-pressed={rule.selected}
                  className="h-auto justify-start py-2 text-left"
                >
                  <span className="flex flex-col">
                    <span className="text-sm font-semibold">{rule.label}</span>
                    <span className="text-[11px] font-normal opacity-70">{rule.blurb}</span>
                  </span>
                </Button>
              ))}
              <Field>
                <FieldLabel>Bomb pots</FieldLabel>
                <div className="grid grid-cols-3 gap-2">
                  {BOMB_POT_CHOICES.map((choice) => (
                    <Button
                      key={choice}
                      type="button"
                      variant={bombPotEvery === choice ? 'secondary' : 'outline'}
                      onClick={() => setBombPotEvery(choice)}
                      aria-pressed={bombPotEvery === choice}
                    >
                      {choice === 0 ? 'Off' : `Every ${choice}`}
                    </Button>
                  ))}
                </div>
              </Field>
            </section>

            <section className="flex flex-col gap-3">
              <SettingHeading>Doors & second chances</SettingHeading>
              <Field>
                <FieldLabel>Turning up late</FieldLabel>
                <div className="grid grid-cols-3 gap-2">
                  {WINDOW_CHOICES.map((choice) => (
                    <Button
                      key={choice.levels}
                      type="button"
                      variant={lateEntryLevels === choice.levels ? 'secondary' : 'outline'}
                      onClick={() => setLateEntryLevels(choice.levels)}
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
                      onClick={() => setRebuyLevels(choice.levels)}
                      aria-pressed={rebuyLevels === choice.levels}
                      className="h-auto whitespace-normal px-2 py-2 text-xs"
                    >
                      {choice.label}
                    </Button>
                  ))}
                </div>
              </Field>
            </section>
          </div>
        </details>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <Button type="submit" size="lg" disabled={loading} className="w-full">
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
      </FieldGroup>
    </form>
  )
}
