'use client'

import { useState } from 'react'
import { Settings2 } from 'lucide-react'
import { toast } from 'sonner'

import { RulesSheet } from '@/components/rules-sheet'
import { Button } from '@/components/ui/button'
import { pokerApi, toGameView, type GameView, type Session } from '@/lib/poker-api'
import {
  FORMATS,
  houseSummary,
  matchFormat,
  rulesFromView,
  toRulesPayload,
  type TableFormat,
} from '@/lib/table-rules'
import { cn } from '@/lib/utils'

/**
 * The rules of the night, agreed in the lobby with the people they apply to.
 *
 * They used to be twenty controls on the home screen, answered before the host
 * knew who was coming and before they had decided they were doing this at all.
 * Here there is a room, there are names in it, and "we've got two hours" is a
 * thing somebody has just said out loud.
 *
 * Four formats and a sheet. The formats are not presets in the settings sense
 * — they are the four nights this group plays, and picking one is expected to
 * be the whole interaction.
 */
export function NightRules({
  view,
  roomId,
  session,
  onSaved,
}: {
  view: GameView
  roomId: string
  session: Session | null
  onSaved: (next: GameView) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const rules = rulesFromView(view)
  const current = matchFormat(rules)
  const summary = houseSummary(rules)

  async function pick(format: TableFormat) {
    if (!session || !view.you) return
    setBusy(true)
    try {
      const raw = await pokerApi.setRules(
        roomId,
        view.you.id,
        // The format decides the rules; it does not rename the table. Somebody
        // who called it "Marta's leaving do" and then taps Chaos should still
        // have Marta's leaving do.
        toRulesPayload(
          { ...format.rules, baize: rules.baize, deck: rules.deck },
          view.roomName,
        ),
        session.token,
      )
      onSaved(toGameView(raw, view.you.id))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not set the format.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex flex-col gap-2.5 rounded-xl border border-border/50 bg-background/30 p-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">The rules of the night</h3>
        <p className="text-xs text-muted-foreground">
          {view.isHost
            ? 'You set them. Pick a format and adjust it below.'
            : 'The host sets them before the first hand.'}
        </p>
      </div>

      {view.isHost ? (
        <div className="grid grid-cols-2 gap-2">
          {FORMATS.map((format) => (
            <Button
              key={format.id}
              type="button"
              variant={current === format.id ? 'secondary' : 'outline'}
              aria-pressed={current === format.id}
              disabled={busy}
              onClick={() => pick(format)}
              className="h-auto flex-col items-start gap-0 whitespace-normal px-2.5 py-2 text-left"
            >
              <span className="flex w-full items-baseline justify-between gap-1">
                <span className="text-sm font-semibold">{format.label}</span>
                <span className="font-mono text-[10px] font-normal opacity-70">
                  {format.duration}
                </span>
              </span>
              <span className="text-[10px] font-normal leading-snug opacity-70">
                {format.blurb}
              </span>
            </Button>
          ))}
        </div>
      ) : null}

      {/* Read back in full, and every line always says something — including
          "No extras". A row that vanishes when its rule is off reads as a row
          that failed to load, and this list is what somebody scans to check
          they got the night they meant. */}
      <dl
        className={cn(
          'grid gap-x-3 gap-y-1 rounded-lg border border-primary/15 bg-primary/5 px-2.5 py-2',
          'grid-cols-[auto_minmax(0,1fr)]',
        )}
      >
        {summary.map((line) => (
          <div key={line.label} className="contents">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {line.label}
            </dt>
            <dd className="min-w-0 truncate text-xs text-card-foreground">{line.value}</dd>
          </div>
        ))}
      </dl>

      {view.isHost ? (
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start"
          onClick={() => setOpen(true)}
        >
          <Settings2 data-icon="inline-start" />
          Adjust the detail
        </Button>
      ) : null}

      <RulesSheet
        view={view}
        roomId={roomId}
        session={session}
        open={open}
        onClose={() => setOpen(false)}
        onSaved={onSaved}
      />
    </section>
  )
}
