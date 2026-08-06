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
          // Read fresh from the poll, so this only fails if the table moved
          // between the last poll and the tap — which is the case worth
          // failing on.
          view.room.rulesVersion ?? 0,
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
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-[10.5px] font-bold uppercase tracking-[0.13em] text-muted-foreground">
          The rules of the night
        </h3>
        <p className="text-[11.5px] leading-snug text-muted-foreground">
          {view.isHost
            ? 'You set them. Pick a preset and adjust it below to taste.'
            : 'The host sets them before the first hand.'}
        </p>
      </div>

      {view.isHost ? (
        <div className="grid grid-cols-2 gap-[7px]">
          {FORMATS.map((format) => (
            <Button
              key={format.id}
              type="button"
              variant={current === format.id ? 'secondary' : 'outline'}
              aria-pressed={current === format.id}
              disabled={busy}
              onClick={() => pick(format)}
              className={cn(
                'h-auto flex-col items-start gap-0.5 whitespace-normal rounded-[13px] px-2.5 py-2 text-left',
                current === format.id ? 'border-primary/60' : '',
              )}
            >
              {/* Name, how long a night of it runs, and what it is. Stacked
                  rather than name-and-duration on one line: the duration is
                  the number that decides which of the four you tap, and on a
                  narrow phone it was being squeezed against the name. */}
              <span className="text-[13.5px] font-bold leading-tight">{format.label}</span>
              <span className="font-mono text-[10.5px] font-normal leading-none text-primary">
                {format.duration}
              </span>
              <span className="text-[10.5px] font-normal leading-snug opacity-70">
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
      <div className="flex flex-col gap-[7px] rounded-[14px] border border-primary/30 bg-primary/[0.07] px-3 py-2.5">
        <h4 className="font-serif text-[14.5px] font-bold leading-none text-foreground">
          The house plays like this
        </h4>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-[3px]">
          {summary.map((line) => (
            <div key={line.label} className="contents">
              <dt className="text-[11.5px] text-muted-foreground">{line.label}</dt>
              {/* Wraps rather than truncating. Chaos has four extras on and the
                  one line worth reading was ending in an ellipsis. */}
              <dd className="min-w-0 text-right font-mono text-[11.5px] tabular-nums text-card-foreground">
                {line.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {view.isHost ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
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
