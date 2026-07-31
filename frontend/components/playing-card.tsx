import { cn } from '@/lib/utils'

const SUIT_SYMBOL: Record<string, string> = {
  s: '\u2660', // spade
  h: '\u2665', // heart
  d: '\u2666', // diamond
  c: '\u2663', // club
}

const RANK_LABEL: Record<string, string> = {
  T: '10',
}

type Size = 'xs' | 'sm' | 'md' | 'lg'

const SIZES: Record<Size, string> = {
  xs: 'h-8 w-6 text-[9px] rounded',
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
          'flex items-center justify-center border border-primary/25 bg-[repeating-linear-gradient(45deg,oklch(0.32_0.04_260),oklch(0.32_0.04_260)_6px,oklch(0.28_0.05_265)_6px,oklch(0.28_0.05_265)_12px)] shadow-md',
          SIZES[size],
          className,
        )}
        aria-label="Face-down card"
      >
        <span className="text-primary/40">{'\u2666'}</span>
      </div>
    )
  }

  const rank = card.slice(0, -1)
  const suit = card.slice(-1).toLowerCase()
  const isRed = suit === 'h' || suit === 'd'
  const label = RANK_LABEL[rank] ?? rank
  const symbol = SUIT_SYMBOL[suit] ?? ''

  const ariaLabel = `${label} of ${
    { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' }[suit]
  }`
  const face = cn(
    'relative overflow-hidden border border-black/10 bg-white font-serif font-bold leading-none shadow-md',
    SIZES[size],
    isRed ? 'text-red-600' : 'text-neutral-900',
    className,
  )

  // At the smallest size the three-band face has nowhere to go and clips, so
  // it drops to rank over suit — still unmistakable in a five-card row.
  if (size === 'xs') {
    return (
      <div
        className={cn(face, 'flex flex-col items-center justify-center gap-px')}
        aria-label={ariaLabel}
      >
        <span>{label}</span>
        <span className="text-[1.1em]">{symbol}</span>
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
