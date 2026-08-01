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

/**
 * Box, corner index and foot pip, per size.
 *
 * The three type sizes travel together because they are one drawing: shrink the
 * card and leave the rank alone and the corner eats the card; shrink the rank
 * and leave the pip and the card turns into a suit with a number stuck to it.
 * Kept as literal classes rather than computed from a scale so Tailwind can see
 * them.
 */
const SIZES: Record<Size, { box: string; rank: string; suit: string; pip: string }> = {
  xs: { box: 'h-8 w-6 rounded-[3px]', rank: 'text-[8px]', suit: 'text-[5px]', pip: 'text-[10px]' },
  sm: { box: 'h-12 w-9 rounded', rank: 'text-[15px]', suit: 'text-[9px]', pip: 'text-[19px]' },
  md: { box: 'h-16 w-12 rounded-md', rank: 'text-xl', suit: 'text-xs', pip: 'text-2xl' },
  lg: { box: 'h-20 w-14 rounded-md', rank: 'text-2xl', suit: 'text-sm', pip: 'text-3xl' },
}

/**
 * A card.
 *
 * Read at the corner, like a real one — because the corner is the part that
 * shows when cards are held in a fan, and because at seat size a centred glyph
 * is a symbol in a box while a corner index is still a playing card. The suit
 * appears twice: small under the rank, where it disambiguates, and large at the
 * foot, where it gives the card a *shape* you can identify at the edge of
 * vision without reading anything.
 *
 * Everything about how it is printed — paper, ink, fillet, grain, letterform —
 * comes from `[data-deck]` in globals.css. This file decides the anatomy; the
 * deck decides the press.
 */
export function PlayingCard({
  card,
  size = 'md',
  faceDown = false,
  className,
  style,
}: {
  card?: string | null
  size?: Size
  /** Force the back of the card even when its value is known. */
  faceDown?: boolean
  className?: string
  /**
   * An explicit size, for cards drawn on the table.
   *
   * Everything on the felt is a share of the table rather than a fixed size, so
   * the board and the hands peeking out of the seats set their own width,
   * height and type size here. The `size` prop stays the right answer anywhere
   * a card is on the *page* — the lobby, the results panel — where there is no
   * table to be a share of.
   */
  style?: React.CSSProperties
}) {
  const s = SIZES[size]

  if (!card || faceDown) {
    return (
      <div
        className={cn('card-back shrink-0', s.box, className)}
        style={style}
        aria-label="Face-down card"
      />
    )
  }

  const rank = card.slice(0, -1)
  const suit = card.slice(-1).toLowerCase()
  const label = RANK_LABEL[rank] ?? rank
  const symbol = SUIT_SYMBOL[suit] ?? ''

  // Four-colour, always. Two black suits is a convention from a time when
  // printing a third colour cost money, and every hand misread as a flush at a
  // glance is that convention being paid for. Diamonds blue, clubs green.
  const ink =
    suit === 'h'
      ? 'var(--cred)'
      : suit === 'd'
        ? 'var(--cblue)'
        : suit === 'c'
          ? 'var(--cgreen)'
          : 'var(--cink)'

  return (
    <div
      className={cn('card-face relative shrink-0 overflow-hidden font-bold leading-none', s.box, className)}
      style={{ color: ink, ...style }}
      aria-label={`${label} of ${SUIT_NAME[suit] ?? 'cards'}`}
    >
      {/* The corner. Rank over suit, tight — this is the whole of the card at
          the sizes that matter, and the two glyphs have to read as one mark. */}
      <span className="card-ix absolute left-[3px] top-0.5 z-[2] flex flex-col items-center leading-[0.86]">
        <b className={cn('font-black tracking-[-0.06em]', s.rank)}>{label}</b>
        {/* Below about 16px of card width the suit under the rank is a blur
            that only makes the corner heavier, so it goes and the foot pip
            carries the suit alone. */}
        <i className={cn('mt-px not-italic', s.suit, size === 'xs' && 'hidden')} aria-hidden>
          {symbol}
        </i>
      </span>
      {/* The foot pip. Full strength, not a watermark: it is the card's
          silhouette, and a ghosted one gives the face nothing to sit on. */}
      <span
        aria-hidden
        className={cn('card-pip pointer-events-none absolute -bottom-px right-0.5 opacity-95', s.pip)}
      >
        {symbol}
      </span>
    </div>
  )
}
