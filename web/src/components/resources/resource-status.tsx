import { Power, PowerOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Column } from './resource-page-types'

type ResolveEnabled = (value: unknown) => boolean

type EnabledStatusColumnOptions = {
  label: string
  enabledLabel: string
  disabledLabel: string
  enableTitle: string
  disableTitle: string
  resolveEnabled: ResolveEnabled
  onToggle: (item: Record<string, unknown>) => void | Promise<void>
  filterValueKey?: string
  rawValueKey?: string
  stopPropagation?: boolean
}

type RenderEnabledChoiceFieldOptions = {
  inputId?: string
  label: string
  value: unknown
  setValue: (value: boolean) => void
  enabledLabel: string
  disabledLabel: string
}

type RenderBooleanSwitchFieldOptions = {
  inputId?: string
  label: string
  value: unknown
  setValue: (value: boolean) => void
  enabledLabel?: string
  disabledLabel?: string
}

export function renderBooleanSwitchField({
  inputId,
  label,
  value,
  setValue,
  enabledLabel,
  disabledLabel,
}: RenderBooleanSwitchFieldOptions) {
  const currentValue = Boolean(value)
  const labelId = inputId ? `${inputId}-label` : undefined

  return (
    <div className="space-y-3">
      <div className="min-w-0">
        <div id={labelId} className="text-sm font-medium text-foreground">
          {label}
        </div>
      </div>
      <button
        type="button"
        id={inputId}
        role="switch"
        aria-checked={currentValue}
        aria-label={label}
        aria-labelledby={labelId}
        className={cn(
          'inline-flex w-fit items-center gap-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          currentValue ? 'text-emerald-900' : 'text-muted-foreground'
        )}
        onClick={() => setValue(!currentValue)}
      >
        <span
          className={cn(
            'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
            currentValue ? 'bg-emerald-600' : 'bg-muted-foreground/30'
          )}
        >
          <span
            className={cn(
              'pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-sm transition-transform',
              currentValue ? 'translate-x-5' : 'translate-x-0.5'
            )}
          />
        </span>
        {enabledLabel && disabledLabel ? (
          <span className="text-sm font-medium text-foreground">
            {currentValue ? enabledLabel : disabledLabel}
          </span>
        ) : null}
      </button>
    </div>
  )
}

export function renderEnabledChoiceField({
  inputId,
  label,
  value,
  setValue,
  enabledLabel,
  disabledLabel,
}: RenderEnabledChoiceFieldOptions) {
  return renderBooleanSwitchField({
    inputId,
    label,
    value,
    setValue,
    enabledLabel,
    disabledLabel,
  })
}

export function buildEnabledStatusColumn({
  label,
  enabledLabel,
  disabledLabel,
  enableTitle,
  disableTitle,
  resolveEnabled,
  onToggle,
  filterValueKey = 'enabled_status',
  rawValueKey = 'is_enabled',
  stopPropagation = true,
}: EnabledStatusColumnOptions): Column {
  return {
    key: filterValueKey,
    label,
    sortable: true,
    filterOptions: [
      { label: enabledLabel, value: 'Enabled' },
      { label: disabledLabel, value: 'Disabled' },
    ],
    filterValue: row => String(row[filterValueKey] ?? ''),
    render: (_value, row) => {
      const enabled = resolveEnabled(row[rawValueKey])
      return (
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1 text-sm cursor-pointer',
            enabled
              ? 'text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300'
              : 'text-muted-foreground hover:text-foreground'
          )}
          onClick={event => {
            if (stopPropagation) {
              event.stopPropagation()
            }
            void onToggle(row)
          }}
          title={enabled ? disableTitle : enableTitle}
        >
          {enabled ? <Power className="h-3.5 w-3.5" /> : <PowerOff className="h-3.5 w-3.5" />}
          {enabled ? enabledLabel : disabledLabel}
        </button>
      )
    },
  }
}