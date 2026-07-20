import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type SharedTimeRangeOption<T extends string> = {
  value: T
  label: string
}

export function SharedTimeRangeSelector<T extends string>({
  value,
  options,
  onChange,
  isOptionActive,
  ariaLabel,
  className,
  buttonClassName,
  buttonSize = 'sm',
}: {
  value: T
  options: Array<SharedTimeRangeOption<T>>
  onChange: (value: T) => void
  isOptionActive?: (value: T, selectedValue: T) => boolean
  ariaLabel?: string
  className?: string
  buttonClassName?: string
  buttonSize?: 'xs' | 'sm'
}) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)} aria-label={ariaLabel}>
      {options.map(option => (
        <Button
          key={option.value}
          variant={
            (isOptionActive?.(option.value, value) ?? value === option.value)
              ? 'default'
              : 'outline'
          }
          size={buttonSize}
          className={buttonClassName}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
}
