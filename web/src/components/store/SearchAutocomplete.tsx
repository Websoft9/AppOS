import { useRef, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, X } from 'lucide-react'
import type { Product, PrimaryCategory } from '@/lib/store-types'

interface SearchAutocompleteProps {
  value: string
  products: Product[]
  primaryCategories: PrimaryCategory[]
  onChange: (value: string) => void
  onCommit?: (value: string) => void
}

export function SearchAutocomplete({
  value,
  products: _products,
  primaryCategories: _primaryCategories,
  onChange,
  onCommit,
}: SearchAutocompleteProps) {
  const { t } = useTranslation('store')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && value.trim()) {
      e.preventDefault()
      onCommit?.(value.trim())
    }
  }

  return (
    <div className="relative w-full max-w-md">
      <div className="relative flex items-center">
        <Search className="absolute left-3 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="search"
          value={value}
          placeholder={t('search.placeholder')}
          className="w-full pl-9 pr-9 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          onChange={e => {
            onChange(e.target.value)
          }}
          onKeyDown={handleKeyDown}
          role="searchbox"
        />
        {value && (
          <button
            className="absolute right-3 text-muted-foreground hover:text-foreground"
            onClick={() => {
              onChange('')
              inputRef.current?.focus()
            }}
            tabIndex={-1}
            aria-label="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}
