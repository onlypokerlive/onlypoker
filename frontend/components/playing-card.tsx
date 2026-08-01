import { cn } from '@/lib/utils'

const SUIT_SYMBOL: Record<string, string> = {
  s: '♠', // spade
  h: '♥', // heart
  d: '♦', // diamond
  c: '♣', // club
}

const RANK_LABEL: Record<string, string> = {
  T: '10',
}

const SUIT_NAME: Record<string, string> = {
  s: 'spades',
  h: 'hearts',
  d: 'diamonds',
  c: 'clubs',
}

type Size = 'xs' | 'sm' | 'md' | 'lg'

const SIZES: Record<Size, string> = {
  xs: 'h-8 w-6 text-[9px] rounded-[3px]',
  sm: 'h-12 w-9 text-xs rounded-md',
  md: 'h-16 w-12 text-lg rounded-lg',
  lg: 'h-20 w-14 text-xl rounded-lg',
}

const PIP_SIZES: Record<Size, string> = {
  xs: 'text-[10px]',
  sm: 'text-sm',
  md: 'text-2xl',
  lg: 'text-3xl',
}

export function PlayingCard({
  card,
  size = 'md',
  faceDown = false,
  className,
}: {
  card?: string | null
  size?: Size
  /** Force the back of the card even when its value is known. */
  faceDown?: boolean
  className?: string
}) {
  // Face-down card
  if (!card || faceDown) {
    return (
      <div
        className={cn(
          // The lattice and the colours come from the deck the host chose —
          // see `.card-back` and `[data-deck]` in globals.css. The padding is
          // load-bearing: it is what `background-clip: content-box` clips the
          // pattern to, which is how a printed back stops short of its edge.
          'card-back border border-black/25 p-[2px] shadow-md',
          SIZES[size],
          className,
        )}
        aria-label="Face-down card"
      />
    )
  }

  const rank = card.slice(0, -1)
  const suit = card.slice(-1).toLowerCase()
  const isRed = suit === 'h' || suit === 'd'
  const label = RANK_LABEL[rank] ?? rank
  const symbol = SUIT_SYMBOL[suit] ?? ''

  const ariaLabel = `${label} of ${SUIT_NAME[suit] ?? 'cards'}`
  const face = cn(
    // `.card-face` is the paper and the edge; the border is the card's own
    // thickness where it meets the felt.
    'card-face relative overflow-hidden border border-black/15 font-serif font-bold leading-none',
    SIZES[size],
    isRed ? 'text-red-600' : 'text-neutral-900',
    className,
  )

  // At the smallest size the three-band face has nowhere to go. It used to
  // centre the rank, which is the one arrangement that stops being a playing
  // card: a real card is read at the corner, because that is the part that
  // shows when they are held in a fan, and at 24px the corner is still legible
  // while a centred glyph is just a symbol in a box.
  if (size === 'xs') {
    return (
      <div className={cn(face, 'flex flex-col items-start p-px')} aria-label={ariaLabel}>
        <span className="leading-none">{label}</span>
        <span className="-mt-px text-[0.95em] leading-none">{symbol}</span>
        {/* The suit again, low and to the right, so a card is identifiable by
            its shape at the edge of vision without reading the corner. Behind
            the index in the stacking order and faint enough not to compete. */}
        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-px -right-px text-[11px] leading-none opacity-[0.16]"
        >
          {symbol}
        </span>
      </div>
    )
  }

  return (
    <div className={cn(face, 'flex flex-col justify-between p-1')} aria-label={ariaLabel}>
      <div className="flex flex-col items-start">
        <span>{label}</span>
        <span className="-mt-0.5 text-[0.7em]">{symbol}</span>
      </div>
      <div className={cn('self-center', PIP_SIZES[size])}>{symbol}</div>
      <div className="flex rotate-180 flex-col items-start">
        <span>{label}</span>
        <span className="-mt-0.5 text-[0.7em]">{symbol}</span>
      </div>
    </div>
  )
}
