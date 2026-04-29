import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { RelationOption } from './resource-page-types'

interface ReferenceSelectProps {
  id: string
  value: string
  options: RelationOption[]
  onSelect: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  createLabel?: string
  onCreate?: () => void
  autoOpen?: boolean
  showNoneOption?: boolean
  showSelectedIndicator?: boolean
  borderlessMenu?: boolean
  maxVisibleItems?: number
  editLabel?: string
  onEditSelected?: (value: string) => void
}

export function ReferenceSelect({
  id,
  value,
  options,
  onSelect,
  placeholder = 'Select a reference',
  searchPlaceholder = 'Search...',
  emptyMessage = 'No options available',
  createLabel,
  onCreate,
  autoOpen = false,
  showNoneOption = true,
  showSelectedIndicator = true,
  borderlessMenu = false,
  maxVisibleItems = 6,
  editLabel,
  onEditSelected,
}: ReferenceSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const optionDividerClass = borderlessMenu ? '' : 'border-b'

  useEffect(() => {
    if (autoOpen) {
      setOpen(true)
    }
  }, [autoOpen])

  const selected = options.find(option => option.id === value)
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) {
      return options
    }
    return options.filter(option => option.label.toLowerCase().includes(normalized))
  }, [options, query])
  const menuMaxHeight = `${Math.max(1, maxVisibleItems) * 42}px`

  return (
    <div className="flex items-start gap-2">
      <div className="relative flex-1">
        {open ? (
          <div className="flex h-10 w-full items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Input
              id={id}
              value={query}
              onChange={event => setQuery(event.target.value)}
              className="h-auto border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
              placeholder={searchPlaceholder}
              autoFocus
            />
            <button type="button" className="shrink-0" onClick={() => setOpen(false)}>
              <ChevronDown className="h-4 w-4 rotate-180 text-muted-foreground transition-transform" />
            </button>
          </div>
        ) : (
          <button
            id={id}
            type="button"
            className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-left text-sm shadow-xs"
            onClick={() => setOpen(true)}
          >
            <span className={selected ? 'text-foreground' : 'text-muted-foreground'}>
              {selected?.label ?? placeholder}
            </span>
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform" />
          </button>
        )}

        {open && (
          <div
            className={`mt-2 rounded-xl bg-popover shadow-lg ${borderlessMenu ? '' : 'border border-border/80'}`}
          >
            <div
              className={`overflow-y-auto rounded-lg bg-background ${borderlessMenu ? '' : 'border'}`}
              style={{ maxHeight: menuMaxHeight }}
            >
              {showNoneOption && (
                <button
                  type="button"
                  className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm ${optionDividerClass} ${!value ? 'bg-accent/60 font-medium' : 'hover:bg-muted/60'}`}
                  onClick={() => {
                    onSelect('')
                    setOpen(false)
                  }}
                >
                  <span>None</span>
                  {!value && showSelectedIndicator && (
                    <span className="text-xs text-muted-foreground">Selected</span>
                  )}
                </button>
              )}
              {filtered.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">{emptyMessage}</p>
              ) : (
                filtered.map(option => {
                  const active = option.id === value
                  return (
                    <button
                      key={option.id}
                      type="button"
                      className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm ${optionDividerClass} last:border-b-0 ${active ? 'bg-accent/60 font-medium' : 'hover:bg-muted/60'}`}
                      onClick={() => {
                        onSelect(option.id)
                        setOpen(false)
                      }}
                    >
                      <span className="truncate">{option.label}</span>
                      {active && showSelectedIndicator && (
                        <span className="text-xs text-muted-foreground">Selected</span>
                      )}
                    </button>
                  )
                })
              )}
            </div>

            {onCreate && createLabel && (
              <div className="flex justify-end px-3 py-3">
                <Button type="button" size="sm" variant="outline" onClick={onCreate}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  {createLabel}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {selected && value && onEditSelected && editLabel ? (
        <Button
          type="button"
          variant="outline"
          className="h-10 shrink-0"
          onClick={() => onEditSelected(value)}
        >
          {editLabel}
        </Button>
      ) : null}
    </div>
  )
}
