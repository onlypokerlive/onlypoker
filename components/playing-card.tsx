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

type Size = 'sm' | 'md' | 'lg'

const SIZES: Record<Size, string> = {
  sm: 'h-11 w-8 text-sm rounded-md',
  md: 'h-16 w-12 text-lg rounded-lg',
  lg: 'h-20 w-14 text-xl rounded-lg',
}

const PIP_SIZES: Record<Size, string> = {
  sm: 'text-base',
  md: 'text-2xl',
  lg: 'text-3xl',
}

export function PlayingCard({
  card,
  size = 'md',
  className,
}: {
  card?: string | null
  size?: Size
  className?: string
}) {
  // Face-down card
  if (!card) {
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

  return (
    <div
      className={cn(
        'relative flex flex-col justify-between border border-black/10 bg-white p-1 font-serif font-bold leading-none shadow-md',
        SIZES[size],
        isRed ? 'text-red-600' : 'text-neutral-900',
        className,
      )}
      aria-label={`${label} of ${
        { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' }[suit]
      }`}
    >
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
