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
}: ReferenceSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

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

  return (
    <div className="relative space-y-2">
      <button
        id={id}
        type="button"
        className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-left text-sm shadow-xs"
        onClick={() => setOpen(prev => !prev)}
      >
        <span className={selected ? 'text-foreground' : 'text-muted-foreground'}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="rounded-xl border border-border/80 bg-popover p-3 shadow-lg">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={event => setQuery(event.target.value)}
              className="pl-9"
              placeholder={searchPlaceholder}
              autoFocus
            />
          </div>

          <div className="mt-3 max-h-52 overflow-y-auto rounded-lg border bg-background">
            <button
              type="button"
              className={`flex w-full items-center justify-between border-b px-3 py-2.5 text-left text-sm ${!value ? 'bg-accent/60 font-medium' : 'hover:bg-muted/60'}`}
              onClick={() => {
                onSelect('')
                setOpen(false)
              }}
            >
              <span>None</span>
              {!value && <span className="text-xs text-muted-foreground">Selected</span>}
            </button>
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted-foreground">{emptyMessage}</p>
            ) : (
              filtered.map(option => {
                const active = option.id === value
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={`flex w-full items-center justify-between border-b px-3 py-2.5 text-left text-sm last:border-b-0 ${active ? 'bg-accent/60 font-medium' : 'hover:bg-muted/60'}`}
                    onClick={() => {
                      onSelect(option.id)
                      setOpen(false)
                    }}
                  >
                    <span className="truncate">{option.label}</span>
                    {active && <span className="text-xs text-muted-foreground">Selected</span>}
                  </button>
                )
              })
            )}
          </div>

          {onCreate && createLabel && (
            <div className="mt-3 flex justify-end">
              <Button type="button" size="sm" variant="outline" onClick={onCreate}>
                <Plus className="mr-1.5 h-4 w-4" />
                {createLabel}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
