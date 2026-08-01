'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Spade, ArrowRight } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { BLIND_STRUCTURES, pokerApi, saveSession } from '@/lib/poker-api'
import {
  BAIZES,
  DECKS,
  DEFAULT_BAIZE,
  DEFAULT_DECK,
  type BaizeId,
  type DeckId,
} from '@/lib/table-style'

/** Dead money each hand. The amount follows the big blind, so it climbs on
 *  its own and the host has one fewer number to pick. */
const ANTE_MODES = [
  { id: 'off', label: 'None', blurb: 'No ante. Blinds only.' },
  { id: 'bb', label: 'Big blind', blurb: 'The big blind posts one extra blind for the whole table — the modern structure, and the quickest.' },
  { id: 'all', label: 'Everyone', blurb: 'Every player chips in a small ante each hand. The classic version.' },
] as const

/** How often to blow a hand up. Kept to a few sane choices. */
const BOMB_POT_CHOICES = [0, 10, 20] as const

/** How often the table stops, in blind levels. */
const BREAK_CHOICES = [0, 3, 5] as const

/** How long the doors stay open, in blind levels. 99 is "all night". */
const WINDOW_CHOICES = [
  { levels: 0, label: 'No' },
  { levels: 4, label: 'First 4 levels' },
  { levels: 99, label: 'Any time' },
] as const

export function CreateRoomForm() {
  const router = useRouter()
  const [roomName, setRoomName] = useState('Friday Night Poker')
  const [hostName, setHostName] = useState('')
  const [startingChips, setStartingChips] = useState('1000')
  const [smallBlind, setSmallBlind] = useState('5')
  const [bigBlind, setBigBlind] = useState('10')
  const [levelMinutes, setLevelMinutes] = useState('10')
  const [actionSeconds, setActionSeconds] = useState('20')
  const [anteMode, setAnteMode] = useState<(typeof ANTE_MODES)[number]['id']>('off')
  const [straddle, setStraddle] = useState(false)
  const [bombPotEvery, setBombPotEvery] = useState(0)
  const [sevenDeuce, setSevenDeuce] = useState(0)
  const [breakEveryLevels, setBreakEveryLevels] = useState(0)
  const [lateEntryLevels, setLateEntryLevels] = useState(4)
  const [rebuyLevels, setRebuyLevels] = useState(0)
  const [runItTwice, setRunItTwice] = useState(false)
  const [baize, setBaize] = useState<BaizeId>(DEFAULT_BAIZE)
  const [deck, setDeck] = useState<DeckId>(DEFAULT_DECK)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const sb = Number(smallBlind)
    const bb = Number(bigBlind)
    const chips = Number(startingChips)
    const minutes = Number(levelMinutes)
    const seconds = Number(actionSeconds)

    if (!hostName.trim()) return setError('Enter your display name.')
    if (!password.trim()) return setError('Set a room password to share.')
    if (bb <= sb) return setError('Big blind must be larger than the small blind.')
    if (chips < bb * 2)
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
        timeBankSeconds: Number(actionSeconds) ? 60 : 0,
        runItTwice,
        baize,
        deck,
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
          <FieldLabel>Structure</FieldLabel>
          {/* The host is choosing how long the night is, not a number of
              minutes. The number stays underneath for anyone who wants it. */}
          <div className="grid grid-cols-3 gap-2">
            {BLIND_STRUCTURES.map((s) => (
              <Button
                key={s.id}
                type="button"
                variant={levelMinutes === String(s.minutes) ? 'secondary' : 'outline'}
                onClick={() => setLevelMinutes(String(s.minutes))}
                className="flex h-auto flex-col gap-0 py-2"
              >
                <span className="text-sm font-semibold">{s.label}</span>
                <span className="text-[10px] font-normal opacity-70">{s.minutes} min</span>
              </Button>
            ))}
          </div>
          <FieldDescription>
            {BLIND_STRUCTURES.find((s) => String(s.minutes) === levelMinutes)?.blurb ??
              'Custom level length.'}
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel>Ante</FieldLabel>
          <div className="grid grid-cols-3 gap-2">
            {ANTE_MODES.map((a) => (
              <Button
                key={a.id}
                type="button"
                variant={anteMode === a.id ? 'secondary' : 'outline'}
                onClick={() => setAnteMode(a.id)}
                className="flex h-auto flex-col gap-0 py-2"
              >
                <span className="text-sm font-semibold">{a.label}</span>
              </Button>
            ))}
          </div>
          <FieldDescription>
            {ANTE_MODES.find((a) => a.id === anteMode)?.blurb}
          </FieldDescription>
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field>
            <FieldLabel htmlFor="levelMinutes">Blinds up every</FieldLabel>
            <Input
              id="levelMinutes"
              inputMode="numeric"
              value={levelMinutes}
              onChange={(e) =>
                setLevelMinutes(e.target.value.replace(/[^0-9]/g, ''))
              }
            />
            <FieldDescription>
              Minutes per level. 0 keeps the blinds where they start.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="actionSeconds">Time to act</FieldLabel>
            <Input
              id="actionSeconds"
              inputMode="numeric"
              value={actionSeconds}
              onChange={(e) =>
                setActionSeconds(e.target.value.replace(/[^0-9]/g, ''))
              }
            />
            <FieldDescription>
              Seconds per decision. Running out checks, or folds. 0 removes the
              clock.
            </FieldDescription>
          </Field>
        </div>

        <Field>
          <FieldLabel>Breaks</FieldLabel>
          {/* The blinds stop climbing while the table is stopped, which is the
              only thing that makes a break a break. Said out loud on the
              screen where the host decides it. */}
          <div className="flex items-center gap-2">
            {BREAK_CHOICES.map((n) => (
              <Button
                key={n}
                type="button"
                variant={breakEveryLevels === n ? 'secondary' : 'outline'}
                onClick={() => setBreakEveryLevels(n)}
                className="flex-1"
              >
                {n === 0 ? 'No breaks' : `Every ${n} levels`}
              </Button>
            ))}
          </div>
          <FieldDescription>
            {breakEveryLevels
              ? `Five minutes off every ${breakEveryLevels} levels. The blinds stay where they are until everyone is back.`
              : 'You can still stop the table whenever you like.'}
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel>House rules</FieldLabel>
          {/* Decided up front, by the host, and never mid-game — these change
              how a hand is dealt, so they cannot be argued about at the table
              once the cards are out. */}
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant={straddle ? 'secondary' : 'outline'}
              onClick={() => setStraddle(!straddle)}
              className="h-auto justify-start py-2 text-left"
            >
              <span className="flex flex-col">
                <span className="text-sm font-semibold">Straddle</span>
                <span className="text-[11px] font-normal opacity-70">
                  Under the gun pays two big blinds and gets the last word before the flop.
                </span>
              </span>
            </Button>
            <Button
              type="button"
              variant={sevenDeuce ? 'secondary' : 'outline'}
              onClick={() => setSevenDeuce(sevenDeuce ? 0 : 2)}
              className="h-auto justify-start py-2 text-left"
            >
              <span className="flex flex-col">
                <span className="text-sm font-semibold">The 7-2 game</span>
                <span className="text-[11px] font-normal opacity-70">
                  Win a pot with seven-deuce offsuit and everyone pays you two big blinds.
                  Counts on pots won by folding too — but you have to show it.
                </span>
              </span>
            </Button>
            <Button
              type="button"
              variant={runItTwice ? 'secondary' : 'outline'}
              onClick={() => setRunItTwice(!runItTwice)}
              className="h-auto justify-start py-2 text-left"
            >
              <span className="flex flex-col">
                <span className="text-sm font-semibold">Run it twice</span>
                <span className="text-[11px] font-normal opacity-70">
                  All-in with cards to come? The rest of the board can be dealt twice,
                  for half the pot each — if everybody still in agrees.
                </span>
              </span>
            </Button>
            <div className="flex items-center gap-2">
              {BOMB_POT_CHOICES.map((n) => (
                <Button
                  key={n}
                  type="button"
                  variant={bombPotEvery === n ? 'secondary' : 'outline'}
                  onClick={() => setBombPotEvery(n)}
                  className="flex-1"
                >
                  {n === 0 ? 'No bomb pots' : `Every ${n}`}
                </Button>
              ))}
            </div>
          </div>
          <FieldDescription>
            {bombPotEvery
              ? `Every ${bombPotEvery} hands nobody gets a preflop: everyone antes and the flop comes straight out.`
              : 'Bomb pots are off.'}
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel>Turning up late</FieldLabel>
          {/* Coming and going is the host's call, decided here rather than
              argued about at midnight when somebody's flatmate walks in. */}
          <div className="flex items-center gap-2">
            {WINDOW_CHOICES.map((c) => (
              <Button
                key={c.levels}
                type="button"
                variant={lateEntryLevels === c.levels ? 'secondary' : 'outline'}
                onClick={() => setLateEntryLevels(c.levels)}
                className="flex-1"
              >
                {c.label}
              </Button>
            ))}
          </div>
          <FieldDescription>
            {lateEntryLevels
              ? 'Someone arriving takes an empty chair and plays from the next deal.'
              : 'The table locks when the first hand is dealt.'}
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel>Buying back in</FieldLabel>
          <div className="flex items-center gap-2">
            {WINDOW_CHOICES.map((c) => (
              <Button
                key={c.levels}
                type="button"
                variant={rebuyLevels === c.levels ? 'secondary' : 'outline'}
                onClick={() => setRebuyLevels(c.levels)}
                className="flex-1"
              >
                {c.label}
              </Button>
            ))}
          </div>
          <FieldDescription>
            {rebuyLevels
              ? 'Two rebuys each after busting, plus one top-up for anybody still in. Nobody is knocked out for good while the window is open.'
              : 'Bust once and you are out. The classic.'}
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel>The table itself</FieldLabel>
          {/* Cosmetic, and the whole point. A group having their own table is
              half of why they play at the same one every week — and unlike
              every other choice on this screen, this one is visible from the
              first second. */}
          <div className="grid grid-cols-4 gap-2">
            {BAIZES.map((b) => (
              <button
                key={b.id}
                type="button"
                data-baize={b.id}
                onClick={() => setBaize(b.id)}
                aria-pressed={baize === b.id}
                title={b.blurb}
                className={cn(
                  'tactile flex flex-col items-center gap-1 rounded-lg border p-1.5',
                  baize === b.id ? 'border-primary' : 'border-border/60',
                )}
              >
                <span className="baize h-7 w-full rounded" />
                <span className="text-[10px] text-muted-foreground">{b.label}</span>
              </button>
            ))}
          </div>
          <FieldDescription>The cloth everybody at this table plays on.</FieldDescription>
        </Field>

        <Field>
          <FieldLabel>The deck</FieldLabel>
          <div className="grid grid-cols-4 gap-2">
            {DECKS.map((d) => (
              <button
                key={d.id}
                type="button"
                data-deck={d.id}
                onClick={() => setDeck(d.id)}
                aria-pressed={deck === d.id}
                title={d.blurb}
                className={cn(
                  'tactile flex flex-col items-center gap-1 rounded-lg border p-1.5',
                  deck === d.id ? 'border-primary' : 'border-border/60',
                )}
              >
                <span className="card-back h-7 w-full rounded border border-black/25 p-[2px]" />
                <span className="text-[10px] text-muted-foreground">{d.label}</span>
              </button>
            ))}
          </div>
          <FieldDescription>What the backs look like when they land.</FieldDescription>
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
