import { cn } from '@/lib/utils'
import { chipStack } from '@/lib/chips'

/**
 * How much of the chip's own height is visible once the next one sits on it.
 *
 * This is the whole illusion. Too much and it is a column of coins seen edge
 * on; too little and it is a smear. Three pixels is what a stack of clay chips
 * looks like from a seat away.
 */
const RISE = 3

/**
 * A wagered amount, as chips.
 *
 * Replaces a dot in a pill — which said the number but not the size, and a
 * poker table is read by size. Denominations are mixed because a real stack
 * always is, and the colours carry the same information they carry at a table:
 * you know roughly what is out there before you read anything.
 */
export function ChipStack({
  amount,
  label,
  className,
}: {
  amount: number
  /**
   * The number, drawn beside the stack. Optional because a stack sitting in
   * front of its owner is already labelled by their own chip count, while one
   * out on the felt has to say what it is.
   */
  label?: string
  className?: string
}) {
  const discs = chipStack(amount)
  if (!discs.length) return null

  // The stack is drawn upwards from its base, so the box has to be as tall as
  // the whole thing while the discs are positioned from the bottom.
  const height = (discs.length - 1) * RISE + 8

  return (
    <div className={cn('flex items-end gap-1', className)}>
      <div
        className="chip-shadow relative w-[15px] shrink-0"
        style={{ height }}
        // The stack is a picture of the number next to it. Reading both aloud
        // says everything twice; reading the picture alone says "image".
        aria-hidden
      >
        {discs.map((disc, i) => (
          <div
            key={i}
            className="absolute left-0 h-2 w-[15px] rounded-[3px]"
            style={{
              bottom: i * RISE,
              background: `linear-gradient(180deg, ${disc.face} 0%, ${disc.face} 55%, ${disc.edge} 100%)`,
              // The rim, and the two dashes of the edge spot pattern that
              // every clay chip has. At this size they are two pixels of
              // lighter colour, and they are what stops the stack reading as
              // stacked rectangles.
              boxShadow: `inset 0 0 0 0.5px ${disc.edge}, inset 3px 0 0 -2px oklch(1 0 0 / 0.55), inset -3px 0 0 -2px oklch(1 0 0 / 0.55)`,
            }}
          />
        ))}
      </div>
      {label && (
        <span className="font-mono text-[11px] font-bold leading-none tabular-nums text-primary">
          {label}
        </span>
      )}
    </div>
  )
}
