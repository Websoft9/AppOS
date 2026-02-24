import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { PrimaryCategory, SecondaryCategory } from '@/lib/store-types'

interface CategoryFilterProps {
  primaryCategories: PrimaryCategory[]
  primaryCounts: Record<string, number>
  secondaryCounts: Record<string, number>
  selectedPrimary: string | null
  selectedSecondary: string | null
  totalCount: number
  onSelectPrimary: (key: string | null) => void
  onSelectSecondary: (key: string | null) => void
}

export function CategoryFilter({
  primaryCategories,
  primaryCounts,
  secondaryCounts,
  selectedPrimary,
  selectedSecondary,
  totalCount,
  onSelectPrimary,
  onSelectSecondary,
}: CategoryFilterProps) {
  const { t } = useTranslation('store')

  const selectedPrimaryCat = primaryCategories.find((c) => c.key === selectedPrimary)
  const secondaryCategories: SecondaryCategory[] =
    selectedPrimaryCat?.linkedFrom?.catalogCollection?.items ?? []

  const handlePrimaryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value || null
    onSelectPrimary(value)
    onSelectSecondary(null)
  }

  return (
    <div className="space-y-3">
      {/* Primary category dropdown */}
      <div className="flex items-center gap-3">
        <select
          className="border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring min-w-[180px]"
          value={selectedPrimary ?? ''}
          onChange={handlePrimaryChange}
          aria-label={t('categories.all')}
        >
          <option value="">
            {t('categories.all')} ({totalCount})
          </option>
          {primaryCategories.map((cat) => (
            <option key={cat.key} value={cat.key}>
              {cat.title} ({primaryCounts[cat.key] ?? 0})
            </option>
          ))}
        </select>
      </div>

      {/* Secondary category chips — hidden when "All" is selected */}
      {selectedPrimary && secondaryCategories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {secondaryCategories.map((sec) => {
            const count = secondaryCounts[sec.key] ?? 0
            const isActive = selectedSecondary === sec.key
            return (
              <button
                key={sec.key}
                onClick={() => onSelectSecondary(isActive ? null : sec.key)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
                )}
                aria-pressed={isActive}
              >
                {sec.title}
                <Badge
                  variant={isActive ? 'outline' : 'secondary'}
                  className="text-[10px] px-1.5 py-0 h-4 min-w-[20px] flex items-center justify-center"
                >
                  {count}
                </Badge>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
