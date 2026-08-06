'use client'

import { useId } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * The three shapes every setting in the rules sheet takes.
 *
 * Two or three choices that cover the nights people actually play, and a
 * fourth that opens a free number. The alternative — a bare input for every
 * setting — is what the create form used to be, and it asks somebody who wants
 * "the usual" to type six numbers to get it. The alternative in the other
 * direction, choices only, is the reason half of these settings were hard-coded
 * in the first place: the server accepts 0–600 seconds of time bank and the
 * form offered 60.
 */

function Label({ label, hint }: { label: string; hint?: string }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="text-sm font-semibold text-foreground">{label}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </span>
  )
}

export function Segmented<T extends string | number>({
  label,
  hint,
  value,
  options,
  onChange,
  columns = 3,
}: {
  label: string
  hint?: string
  value: T
  options: { value: T; label: string; sub?: string }[]
  onChange: (next: T) => void
  columns?: 2 | 3 | 4
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label label={label} hint={hint} />
      <div
        role="group"
        aria-label={label}
        className={cn(
          'grid gap-2',
          columns === 2 && 'grid-cols-2',
          columns === 3 && 'grid-cols-3',
          columns === 4 && 'grid-cols-4',
        )}
      >
        {options.map((option) => (
          <Button
            key={String(option.value)}
            type="button"
            variant={option.value === value ? 'secondary' : 'outline'}
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
            className="h-auto flex-col gap-0 whitespace-normal px-2 py-2 text-xs"
          >
            <span className="text-sm font-semibold">{option.label}</span>
            {option.sub ? (
              <span className="text-[10px] font-normal opacity-70">{option.sub}</span>
            ) : null}
          </Button>
        ))}
      </div>
    </div>
  )
}

/**
 * A number with a way out.
 *
 * "Other" is selected by the value not being one of the choices, not by a flag
 * somebody has to remember to keep in step — so a table that arrives holding
 * 150 blinds opens on "Other" with 150 in the box, without anybody storing
 * that it was custom.
 */
export function NumberChoice({
  label,
  hint,
  value,
  choices,
  onChange,
  unit,
  translate,
  min = 0,
  max = 1_000_000,
}: {
  label: string
  hint?: string
  value: number
  choices: { value: number; label: string }[]
  onChange: (next: number) => void
  /** Shown after the free input, e.g. "blinds" or "min". */
  unit?: string
  /** What the free number comes to in the end, e.g. "· 1,500 chips". */
  translate?: (value: number) => string
  min?: number
  max?: number
}) {
  const id = useId()
  const isOther = !choices.some((choice) => choice.value === value)

  return (
    <div className="flex flex-col gap-1.5">
      <Label label={label} hint={hint} />
      <div role="group" aria-label={label} className="grid grid-cols-4 gap-2">
        {choices.map((choice) => (
          <Button
            key={choice.value}
            type="button"
            variant={!isOther && choice.value === value ? 'secondary' : 'outline'}
            aria-pressed={!isOther && choice.value === value}
            onClick={() => onChange(choice.value)}
            className="h-auto whitespace-normal px-1 py-2 text-xs"
          >
            {choice.label}
          </Button>
        ))}
        <Button
          type="button"
          variant={isOther ? 'secondary' : 'outline'}
          aria-pressed={isOther}
          aria-controls={id}
          onClick={() => {
            // Step off the nearest choice rather than opening on an empty box:
            // an input with nothing in it cannot say what it is going to do.
            if (!isOther) onChange(Math.min(max, Math.max(min, value + 1)))
          }}
          className="h-auto whitespace-normal px-1 py-2 text-xs"
        >
          Other
        </Button>
      </div>
      {isOther ? (
        <div className="flex items-center gap-2">
          <Input
            id={id}
            inputMode="numeric"
            autoFocus
            className="w-24"
            value={String(value)}
            aria-label={`${label}, exact value`}
            onChange={(event) => {
              const digits = event.target.value.replace(/[^0-9]/g, '')
              onChange(Math.min(max, Number(digits || 0)))
            }}
          />
          <span className="text-xs text-muted-foreground">
            {unit}
            {translate ? ` ${translate(value)}` : ''}
          </span>
        </div>
      ) : null}
    </div>
  )
}

export function RuleSwitch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <Button
      type="button"
      variant={checked ? 'secondary' : 'outline'}
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className="h-auto min-h-11 justify-start whitespace-normal py-2 text-left"
    >
      <Label label={label} hint={hint} />
    </Button>
  )
}
