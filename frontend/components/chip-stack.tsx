import { cn } from '@/lib/utils'
import { chipColumn, chipStack } from '@/lib/chips'

/**
 * The width of a chip, and how much of the one below it stays visible.
 *
 * Discs seen from very slightly above, each sitting three pixels up the one
 * under it — which is what a stack of clay chips looks like from a seat away.
 * The stack used to be drawn edge-on as flat rectangles: arithmetically the
 * same picture, and it read as a barcode, because the thing that makes a chip a
 * chip is the notched rim and edge-on there is no rim to see.
 */
const CHIP = 17
const RISE = 4

/**
 * A wagered amount, as chips.
 *
 * Denominations are mixed because a real stack always is, and the colours carry
 * the same information they carry at a table: you know roughly what is out
 * there before you read anything.
 */
export function ChipStack({
  amount,
  label,
  max = 12,
  exactly,
  u = 1,
  className,
  style,
}: {
  amount: number
  /**
   * The number, drawn beside the stack. Optional because a stack sitting in
   * front of its owner is already labelled by their own chip count, while one
   * out on the felt has to say what it is.
   */
  label?: string
  /**
   * The tallest this stack is allowed to get.
   *
   * Not decoration: `estimateStackSize` and `estimateBetSize` in
   * `table-layout.ts` reserve room for exactly this many discs, and a stack
   * that quietly draws more is a stack standing on something. Whoever places
   * it is the one who knows how much room it was given.
   */
  max?: number
  /**
   * Draw exactly this many discs, coloured by what `amount` is *made of*.
   *
   * For a seat's own stack, where the height says how deep somebody is
   * relative to the table and the colours say what their chips are. Those are
   * two different questions and answering them with one number is what made a
   * chip leader and a short stack look alike — see `chipColumn`.
   *
   * A bet does not want this: a bet is a real handful of chips and its own
   * breakdown is the truth, so it leaves this alone and uses `max`.
   */
  exactly?: number
  /** The scale the table is drawn at. See `tableScale`. */
  u?: number
  className?: string
  style?: React.CSSProperties
}) {
  const discs = exactly != null ? chipColumn(amount, exactly) : chipStack(amount, max)
  if (!discs.length) return null

  // Drawn upwards from the base, so the box is as tall as the whole stack while
  // the discs are positioned from the bottom.
  const chip = CHIP * u
  const rise = RISE * u
  const height = (discs.length - 1) * rise + chip

  return (
    <div className={cn('flex items-end', className)} style={{ gap: 6 * u, ...style }}>
      <div
        className="relative shrink-0"
        style={{ width: chip, height }}
        // The stack is a picture of the number next to it. Reading both aloud
        // says everything twice; reading the picture alone says "image".
        aria-hidden
      >
        {/* The shadow that lands it on the cloth. Under the base and wider than
            the chip — without it the stack hovers. */}
        <span className="chip-foot" style={{ width: chip + 7 * u, height: 7 * u, bottom: -3 * u }} />
        {discs.map((disc, i) => (
          <div
            key={i}
            className="chip absolute left-0"
            style={
              {
                bottom: i * rise,
                width: chip,
                height: chip,
                '--cc': disc.face,
              } as React.CSSProperties
            }
          />
        ))}
      </div>
      {label && (
        // Bare on the felt, with a shadow rather than a plate behind it. A dark
        // pill around the figure turns real chips into a labelled UI element,
        // which is exactly what a table is not.
        <span
          className="font-mono font-extrabold leading-none tracking-tight tabular-nums"
          style={{
            fontSize: 11.5 * u,
            color: 'var(--ivory)',
            textShadow: '0 1px 3px #000, 0 0 7px rgba(0,0,0,.9)',
          }}
        >
          {label}
        </span>
      )}
    </div>
  )
}
