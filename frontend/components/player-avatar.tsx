import { cn } from '@/lib/utils'

function initialsFrom(name?: string | null) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).slice(0, 2)
  const letters = parts.map((p) => p[0]?.toUpperCase() ?? '').join('')
  return letters || '?'
}

const sizeClasses: Record<string, string> = {
  xs: 'size-6 text-[0.6rem]',
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-16 text-lg',
  xl: 'size-24 text-2xl',
}

export function PlayerAvatar({
  src,
  name,
  size = 'md',
  className,
}: {
  src?: string | null
  name?: string | null
  size?: keyof typeof sizeClasses
  className?: string
}) {
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/60 bg-muted font-semibold text-muted-foreground select-none',
        sizeClasses[size],
        className,
      )}
      aria-hidden={!name}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src || '/placeholder.svg'}
          alt={name ? `${name}'s profile photo` : 'Profile photo'}
          className="size-full object-cover"
          crossOrigin="anonymous"
        />
      ) : (
        <span>{initialsFrom(name)}</span>
      )}
    </span>
  )
}
