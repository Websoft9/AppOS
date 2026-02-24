import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, X, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AppIcon } from './AppIcon'
import {
  getSearchSuggestions,
  getSearchHistory,
  addSearchHistory,
  clearSearchHistory,
} from '@/lib/store-api'
import type { Product, PrimaryCategory } from '@/lib/store-types'

interface SearchAutocompleteProps {
  value: string
  products: Product[]
  primaryCategories: PrimaryCategory[]
  onChange: (value: string) => void
  onCommit?: (value: string) => void
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export function SearchAutocomplete({
  value,
  products,
  primaryCategories,
  onChange,
  onCommit,
}: SearchAutocompleteProps) {
  const { t } = useTranslation('store')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [history, setHistory] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const debouncedValue = useDebounce(value, 300)

  // Compute suggestions
  const suggestions = debouncedValue.trim()
    ? getSearchSuggestions(products, debouncedValue)
    : []

  // Get primary category title for suggestion
  const getPrimaryTitle = (product: Product): string => {
    const catalogItems = product.catalogCollection?.items ?? []
    const primaryKey = catalogItems[0]?.catalogCollection?.items?.[0]?.key
    if (!primaryKey) return ''
    return primaryCategories.find((c) => c.key === primaryKey)?.title ?? ''
  }

  // Refresh history when dropdown opens with empty query
  useEffect(() => {
    if (open && !value.trim()) {
      setHistory(getSearchHistory())
    }
  }, [open, value])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setActiveIndex(-1)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const commit = useCallback(
    (term: string) => {
      addSearchHistory(term)
      onChange(term)
      onCommit?.(term)
      setOpen(false)
      setActiveIndex(-1)
      inputRef.current?.blur()
    },
    [onChange, onCommit],
  )

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const items = debouncedValue.trim()
      ? suggestions
      : history.map((h) => ({ trademark: h } as Product))

    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        setOpen(true)
      }
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (activeIndex >= 0 && items[activeIndex]) {
        commit(items[activeIndex].trademark)
      } else if (value.trim()) {
        commit(value.trim())
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
      setActiveIndex(-1)
    }
  }

  const showHistory = open && !debouncedValue.trim() && history.length > 0
  const showSuggestions = open && debouncedValue.trim().length > 0

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      {/* Input */}
      <div className="relative flex items-center">
        <Search className="absolute left-3 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="search"
          value={value}
          placeholder={t('search.placeholder')}
          className="w-full pl-9 pr-9 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
            setActiveIndex(-1)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-haspopup="listbox"
          role="combobox"
        />
        {value && (
          <button
            className="absolute right-3 text-muted-foreground hover:text-foreground"
            onClick={() => {
              onChange('')
              setOpen(false)
              inputRef.current?.focus()
            }}
            tabIndex={-1}
            aria-label="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Dropdown */}
      {(showHistory || showSuggestions) && (
        <div
          className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg overflow-hidden"
          role="listbox"
        >
          {/* Recent searches */}
          {showHistory && (
            <>
              <div className="flex items-center justify-between px-3 py-2 border-b">
                <span className="text-xs font-medium text-muted-foreground">
                  {t('search.recentSearches')}
                </span>
                <button
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    clearSearchHistory()
                    setHistory([])
                  }}
                >
                  {t('search.clearHistory')}
                </button>
              </div>
              {history.map((term, idx) => (
                <button
                  key={term}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent text-left',
                    activeIndex === idx && 'bg-accent',
                  )}
                  role="option"
                  aria-selected={activeIndex === idx}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => commit(term)}
                >
                  <Clock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  {term}
                </button>
              ))}
            </>
          )}

          {/* App suggestions */}
          {showSuggestions && suggestions.length > 0 && (
            <>
              {suggestions.map((product, idx) => (
                <button
                  key={product.key}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2 hover:bg-accent text-left',
                    activeIndex === idx && 'bg-accent',
                  )}
                  role="option"
                  aria-selected={activeIndex === idx}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => commit(product.trademark)}
                >
                  <AppIcon
                    appKey={product.key}
                    trademark={product.trademark}
                    size="sm"
                    className="flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{product.trademark}</div>
                    {getPrimaryTitle(product) && (
                      <div className="text-xs text-muted-foreground truncate">
                        {getPrimaryTitle(product)}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </>
          )}

          {/* No results */}
          {showSuggestions && suggestions.length === 0 && (
            <div className="px-3 py-4 text-sm text-muted-foreground text-center">
              {t('search.noResults')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
