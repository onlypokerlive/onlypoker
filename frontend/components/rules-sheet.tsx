'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, X } from 'lucide-react'
import { toast } from 'sonner'

import { NumberChoice, RuleSwitch, Segmented } from '@/components/rule-controls'
import { PlayingCard } from '@/components/playing-card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel } from '@/components/ui/field'
import { recordCustomizeOpened } from '@/lib/growth'
import { pokerApi, toGameView, type GameView, type Session } from '@/lib/poker-api'
import {
  BLIND_LADDER_CHOICES,
  LEVEL_MINUTE_CHOICES,
  STARTING_BLIND_CHOICES,
  anteLabel,
  blindPreview,
  doorsLabel,
  houseRulesLabel,
  rulesFromView,
  startingChips,
  toRulesPayload,
  type TableRules,
} from '@/lib/table-rules'
import { BAIZES, DECKS } from '@/lib/table-style'
import { cn } from '@/lib/utils'

/**
 * Every rule of the night, one screen down from the format that set them.
 *
 * The four formats answer this whole sheet in one tap, and most nights that is
 * the end of it. This is for the night that wants one thing changed — which is
 * a different job from picking a format, and putting both on the same screen
 * is how the create form ended up with the button below the fold.
 *
 * Nothing here is sent until Save. A sheet that writes as you tap would be
 * publishing half-finished rules to everybody sitting in the lobby.
 */

function Section({
  title,
  summary,
  children,
  defaultOpen = false,
}: {
  title: string
  summary: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  return (
    <details
      open={defaultOpen}
      className="group/section rounded-xl border border-border/55 bg-background/25 px-3"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-foreground">{title}</span>
          <span className="block truncate text-xs text-muted-foreground">{summary}</span>
        </span>
        <ChevronDown
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open/section:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="flex flex-col gap-3 border-t border-border/45 pb-3 pt-3">{children}</div>
    </details>
  )
}

export function RulesSheet({
  view,
  roomId,
  session,
  open,
  onClose,
  onSaved,
}: {
  view: GameView
  roomId: string
  session: Session | null
  open: boolean
  onClose: () => void
  onSaved: (next: GameView) => void
}) {
  const [name, setName] = useState(view.roomName)
  const [rules, setRules] = useState<TableRules>(() => rulesFromView(view))
  const [saving, setSaving] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const opened = useRef(false)

  // Re-read the table each time it opens. Between two openings the host may
  // have tapped a format, and a sheet showing what the rules were before that
  // would silently undo it on Save.
  useEffect(() => {
    if (!open) return
    setName(view.roomName)
    setRules(rulesFromView(view))
    if (!opened.current) {
      opened.current = true
      recordCustomizeOpened()
    }
    // Deliberately keyed on `open` alone: re-syncing on every poll would throw
    // away what the host is in the middle of typing, 1.2 seconds after they
    // started typing it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      previousFocus?.focus()
    }
  }, [open, onClose])

  const set = <K extends keyof TableRules>(key: K, value: TableRules[K]) =>
    setRules((current) => ({ ...current, [key]: value }))

  const ladders = view.room.blindLadders
  const preview = useMemo(
    () => blindPreview(ladders, rules.blindLadder, rules),
    [ladders, rules],
  )

  async function save() {
    if (!session || !view.you) return
    setSaving(true)
    try {
      const raw = await pokerApi.setRules(
        roomId,
        view.you.id,
        toRulesPayload(rules, name.trim() || view.roomName),
        session.token,
      )
      onSaved(toGameView(raw, view.you.id))
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the rules.')
    } finally {
      setSaving(false)
    }
  }

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rules-sheet-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-background/80 p-3 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        onClick={(event) => event.stopPropagation()}
        className="room-panel flex max-h-[86svh] w-full max-w-md flex-col rounded-2xl shadow-2xl"
      >
        <div className="flex items-center justify-between gap-2 px-4 pt-3">
          <h2
            id="rules-sheet-title"
            className="font-serif text-lg font-bold text-card-foreground"
          >
            Adjust the detail
          </h2>
          <Button
            ref={closeRef}
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close"
          >
            <X />
          </Button>
        </div>

        <div className="flex flex-col gap-2 overflow-y-auto overscroll-contain px-4 pb-3 pt-1">
          <Field>
            <FieldLabel htmlFor="rules-name">Table name</FieldLabel>
            <Input
              id="rules-name"
              value={name}
              maxLength={40}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>

          <Section
            title="Chips and blinds"
            summary={`${startingChips(rules).toLocaleString()} chips · ${rules.smallBlind}/${rules.bigBlind}`}
            defaultOpen
          >
            {/* The stack is asked for in blinds and not in chips, because
                "1000" says nothing without the blinds beside it: a hundred
                blinds at 5/10 is a tournament, and five at 100/200 is a coin
                flip. The chips are shown live underneath. */}
            <NumberChoice
              label="What everybody starts with"
              hint="In big blinds — the only unit that means the same thing at every stake"
              value={rules.startingBlinds}
              choices={STARTING_BLIND_CHOICES.map((n) => ({ value: n, label: `${n} blinds` }))}
              // Not clamped on the way in: a minimum enforced per keystroke
              // fights whoever is typing, because clearing the box to type 150
              // passes through 0 first and comes back as the minimum. The
              // floor that matters — two big blinds, which the server refuses
              // below — lives in `startingChips`.
              onChange={(next) => set('startingBlinds', next)}
              unit="blinds"
              translate={() => `· ${startingChips(rules).toLocaleString()} chips`}
              min={1}
            />
            <p className="text-xs text-muted-foreground">
              {startingChips(rules).toLocaleString()} chips at {rules.smallBlind}/
              {rules.bigBlind}.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="rules-sb">Small blind</FieldLabel>
                <Input
                  id="rules-sb"
                  inputMode="numeric"
                  value={String(rules.smallBlind)}
                  onChange={(event) =>
                    set('smallBlind', Number(event.target.value.replace(/[^0-9]/g, '') || 0))
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="rules-bb">Big blind</FieldLabel>
                <Input
                  id="rules-bb"
                  inputMode="numeric"
                  value={String(rules.bigBlind)}
                  onChange={(event) =>
                    set('bigBlind', Number(event.target.value.replace(/[^0-9]/g, '') || 0))
                  }
                />
              </Field>
            </div>
          </Section>

          <Section
            title="Pace"
            summary={
              rules.levelMinutes > 0
                ? `Up every ${rules.levelMinutes} min · ${rules.blindLadder}`
                : 'Blinds stay put'
            }
          >
            <NumberChoice
              label="How often the blinds go up"
              hint="Minutes. 0 keeps them where they started."
              value={rules.levelMinutes}
              choices={LEVEL_MINUTE_CHOICES.map((n) => ({ value: n, label: `${n} min` }))}
              onChange={(next) => set('levelMinutes', next)}
              unit="min"
              max={120}
            />
            {/* How far they move, which is a different question from how often
                and was never askable: every table climbed the same ladder, so
                a short night and a long one differed only by the clock. */}
            <Segmented
              label="How far they go up"
              hint="Same clock, three different nights"
              value={rules.blindLadder}
              options={BLIND_LADDER_CHOICES.map((l) => ({
                value: l.id,
                label: l.label,
                sub: l.blurb,
              }))}
              onChange={(next) => set('blindLadder', next)}
            />
            {preview ? (
              <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
                {preview}…
              </p>
            ) : null}
          </Section>

          <Section
            title="Clock and time bank"
            summary={
              rules.actionSeconds > 0
                ? `${rules.actionSeconds}s · ${rules.timeBankSeconds}s bank`
                : 'No clock'
            }
          >
            <NumberChoice
              label="Time to act"
              hint="Seconds. 0 takes the clock off the table."
              value={rules.actionSeconds}
              choices={[
                { value: 0, label: 'None' },
                { value: 15, label: '15s' },
                { value: 20, label: '20s' },
              ]}
              onChange={(next) => set('actionSeconds', next)}
              unit="sec"
              max={120}
            />
            {rules.actionSeconds > 0 ? (
              <NumberChoice
                label="Time bank"
                hint="Extra seconds for the whole night, for the decisions that deserve them"
                value={rules.timeBankSeconds}
                choices={[
                  { value: 0, label: 'None' },
                  { value: 60, label: '60s' },
                  { value: 120, label: '120s' },
                ]}
                onChange={(next) => set('timeBankSeconds', next)}
                unit="sec"
                max={600}
              />
            ) : null}
          </Section>

          <Section title="Antes and breaks" summary={anteLabel(rules)}>
            <Segmented
              label="Ante"
              hint="Dead money in the middle before a card is dealt"
              value={rules.anteMode}
              options={[
                { value: 'off', label: 'None' },
                { value: 'bb', label: 'Big blind' },
                { value: 'all', label: 'Everyone' },
              ]}
              onChange={(next) => set('anteMode', next)}
            />
            <NumberChoice
              label="Break every"
              hint="Blind levels. 0 means only when somebody asks."
              value={rules.breakEveryLevels}
              choices={[
                { value: 0, label: 'None' },
                { value: 3, label: '3 levels' },
                { value: 5, label: '5 levels' },
              ]}
              onChange={(next) => set('breakEveryLevels', next)}
              unit="levels"
              max={20}
            />
            {rules.breakEveryLevels > 0 ? (
              <NumberChoice
                label="How long a break lasts"
                value={rules.breakMinutes}
                choices={[
                  { value: 5, label: '5 min' },
                  { value: 10, label: '10 min' },
                  { value: 15, label: '15 min' },
                ]}
                onChange={(next) => set('breakMinutes', Math.max(1, next))}
                unit="min"
                min={1}
                max={60}
              />
            ) : null}
          </Section>

          <Section title="House rules" summary={houseRulesLabel(rules)}>
            {/* Five big blinds and not two, because at two almost nobody goes
                for it and the whole rule exists so that somebody tries. */}
            <NumberChoice
              label="What the 7-2 pays"
              hint="Big blinds every other player owes whoever wins with seven-deuce offsuit"
              value={rules.sevenDeuce}
              choices={[
                { value: 0, label: 'Off' },
                { value: 2, label: '2 blinds' },
                { value: 5, label: '5 blinds' },
              ]}
              onChange={(next) => set('sevenDeuce', next)}
              unit="blinds"
              max={20}
            />
            <NumberChoice
              label="Bomb pots"
              hint="Everybody antes and the hand starts on the flop"
              value={rules.bombPotEvery}
              choices={[
                { value: 0, label: 'Off' },
                { value: 8, label: 'Every 8' },
                { value: 20, label: 'Every 20' },
              ]}
              onChange={(next) => set('bombPotEvery', next)}
              unit="hands"
              max={50}
            />
            <RuleSwitch
              label="Straddle"
              hint="Under the gun posts two big blinds and acts last preflop."
              checked={rules.straddle}
              onChange={(next) => set('straddle', next)}
            />
            <RuleSwitch
              label="Run it twice"
              hint="All-in with somebody who agrees, and the rest of the board is dealt twice for half the pot each."
              checked={rules.runItTwice}
              onChange={(next) => set('runItTwice', next)}
            />
          </Section>

          <Section title="Doors and rebuys" summary={doorsLabel(rules)}>
            <NumberChoice
              label="Turning up late"
              hint="Blind levels the door stays open for. 0 shuts it on the first hand."
              value={rules.lateEntryLevels}
              choices={[
                { value: 0, label: 'Closed' },
                { value: 4, label: '4 levels' },
                { value: 99, label: 'Any time' },
              ]}
              onChange={(next) => set('lateEntryLevels', next)}
              unit="levels"
              max={99}
            />
            {rules.lateEntryLevels > 0 ? (
              <Segmented
                label="What a latecomer sits down behind"
                value={rules.lateEntryChips}
                options={[
                  { value: 'start', label: 'The opening stack' },
                  { value: 'average', label: 'The table average' },
                ]}
                onChange={(next) => set('lateEntryChips', next)}
                columns={2}
              />
            ) : null}
            <NumberChoice
              label="Buying back in"
              hint="Blind levels somebody who busts can still return within"
              value={rules.rebuyLevels}
              choices={[
                { value: 0, label: 'No' },
                { value: 4, label: '4 levels' },
                { value: 99, label: 'Any time' },
              ]}
              onChange={(next) => set('rebuyLevels', next)}
              unit="levels"
              max={99}
            />
            {rules.rebuyLevels > 0 ? (
              <>
                <NumberChoice
                  label="How many each"
                  value={rules.rebuysPerPlayer}
                  choices={[
                    { value: 1, label: 'One' },
                    { value: 2, label: 'Two' },
                    { value: 0, label: 'No limit' },
                  ]}
                  onChange={(next) => set('rebuysPerPlayer', next)}
                  unit="rebuys"
                  max={10}
                />
                {/* The one thing on this sheet the engine could not do: a rebuy
                    always paid the opening stack, which by level nine is four
                    big blinds and a rebuy nobody takes. */}
                <Segmented
                  label="What a rebuy pays"
                  value={rules.rebuyChips}
                  options={[
                    { value: 'start', label: 'Opening stack' },
                    { value: 'average', label: 'Table average' },
                    { value: 'fixed', label: 'Set amount' },
                  ]}
                  onChange={(next) => set('rebuyChips', next)}
                />
                {rules.rebuyChips === 'fixed' ? (
                  <Field>
                    <FieldLabel htmlFor="rules-rebuy-chips">Chips per rebuy</FieldLabel>
                    <Input
                      id="rules-rebuy-chips"
                      inputMode="numeric"
                      value={String(rules.rebuyChipsFixed || startingChips(rules))}
                      onChange={(event) =>
                        set(
                          'rebuyChipsFixed',
                          Number(event.target.value.replace(/[^0-9]/g, '') || 0),
                        )
                      }
                    />
                  </Field>
                ) : null}
                <RuleSwitch
                  label="Add-on"
                  hint="One extra top-up each, inside the same window, for anybody who still has chips."
                  checked={rules.addOn}
                  onChange={(next) => set('addOn', next)}
                />
              </>
            ) : null}
            <RuleSwitch
              label="Leaving early"
              hint="Anybody can take their chips off the table and go home."
              checked={rules.allowLeaving}
              onChange={(next) => set('allowLeaving', next)}
            />
          </Section>

          <Section
            title="The look of the table"
            summary={
              BAIZES.find((b) => b.id === rules.baize)?.label ?? 'Emerald'
            }
          >
            <div className="grid grid-cols-4 gap-2">
              {BAIZES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  data-baize={option.id}
                  onClick={() => set('baize', option.id)}
                  aria-pressed={rules.baize === option.id}
                  title={option.blurb}
                  className={cn(
                    'tactile flex min-h-11 flex-col items-center gap-1 rounded-lg border p-1.5',
                    rules.baize === option.id ? 'border-primary' : 'border-border/60',
                  )}
                >
                  <span className="baize h-7 w-full rounded" aria-hidden />
                  <span className="text-[10px] text-muted-foreground">{option.label}</span>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {DECKS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  data-deck={option.id}
                  onClick={() => set('deck', option.id)}
                  aria-pressed={rules.deck === option.id}
                  title={option.blurb}
                  className={cn(
                    'tactile flex min-h-11 flex-col items-center gap-1 rounded-lg border p-1.5',
                    rules.deck === option.id ? 'border-primary' : 'border-border/60',
                  )}
                >
                  <span
                    className="flex w-full items-center justify-center gap-0.5 rounded px-1 py-1.5"
                    style={{
                      background: 'radial-gradient(ellipse at 50% 30%, #17604B, #08281D 88%)',
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
          </Section>
        </div>

        <div className="border-t border-border/50 p-3">
          <Button size="lg" className="w-full" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
