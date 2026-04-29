import { Button } from '@/components/ui/button'

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
}: {
  value: T
  options: Array<SharedTimeRangeOption<T>>
  onChange: (value: T) => void
  isOptionActive?: (value: T, selectedValue: T) => boolean
  ariaLabel?: string
}) {
  return (
    <div className="flex flex-wrap gap-2" aria-label={ariaLabel}>
      {options.map(option => (
        <Button
          key={option.value}
          variant={
            (isOptionActive?.(option.value, value) ?? value === option.value)
              ? 'default'
              : 'outline'
          }
          size="sm"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
}
