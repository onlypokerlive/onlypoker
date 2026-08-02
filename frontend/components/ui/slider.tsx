import { Slider as SliderPrimitive } from "@base-ui/react/slider"

import { cn } from "@/lib/utils"

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  "aria-label": ariaLabel,
  "aria-valuetext": ariaValueText,
  ...props
}: SliderPrimitive.Root.Props) {
  const _values = Array.isArray(value)
    ? value
    : typeof value === "number"
      ? [value]
      : Array.isArray(defaultValue)
        ? defaultValue
        : typeof defaultValue === "number"
          ? [defaultValue]
          : [min, max]

  return (
    <SliderPrimitive.Root
      className={cn("data-horizontal:w-full data-vertical:h-full", className)}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
      // Deliberately *not* passed on: `aria-label` and `aria-valuetext` go to
      // the thumb below, and leaving them here as well names the wrapping
      // `role="group"` with the same words, so the control announces itself
      // twice — "Raise amount group, Raise amount slider". A group of one
      // control does not need a name of its own.
      {...props}
    >
      <SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative grow overflow-hidden rounded-full bg-muted select-none data-horizontal:h-1 data-horizontal:w-full data-vertical:h-full data-vertical:w-1"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="bg-primary select-none data-horizontal:h-full data-vertical:w-full"
          />
        </SliderPrimitive.Track>
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            // The thing a screen reader actually reads is the visually hidden
            // `<input type="range">` Base UI renders inside this thumb, and it
            // was reaching it unnamed: `aria-label` and `aria-valuetext` were
            // landing on the root, which is a `role="group"` — a name on a
            // group is a name for the group, and `aria-valuetext` on something
            // that is not a range is ignored outright. So the raise control
            // announced itself as an unlabelled slider reading "20" instead of
            // "Raise amount, 20 chips · 2 BB", which is the whole of what the
            // caller wrote it to say.
            getAriaLabel={ariaLabel ? () => ariaLabel : undefined}
            getAriaValueText={ariaValueText ? () => ariaValueText : undefined}
            className="relative block size-3 shrink-0 rounded-full border border-ring bg-white ring-ring/50 transition-[color,box-shadow] select-none after:absolute after:-inset-4 hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden active:ring-3 disabled:pointer-events-none disabled:opacity-50"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
