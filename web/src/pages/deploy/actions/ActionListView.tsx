import { useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Filter,
  Search,
  Settings2,
  Trash2,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  DropdownMenuCheckboxItem,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { actionDurationLabel, actionStatusLabel } from '@/pages/deploy/actions/action-utils'
import type { ActiveFilterChip } from '@/pages/deploy/actions/action-types'

type SortField = 'compose_project_name' | 'created' | 'started_at' | 'finished_at'
type SortDir = 'asc' | 'desc'

type ActionListItem = {
  id: string
  compose_project_name: string
  source: string
  status: string
  server_id: string
  created?: string
  started_at?: string
  finished_at?: string
  pipeline?: {
    started_at?: string
    finished_at?: string
  }
}

type FilterOption = {
  value: string
  label: string
}

type ActionListViewProps<TOperation extends ActionListItem> = {
  search: string
  onSearchChange: (value: string) => void
  loading: boolean
  pagedItems: TOperation[]
  page: number
  totalPages: number
  pageSize: number
  pageSizeOptions: readonly number[]
  onPageSizeChange: (value: number) => void
  onPreviousPage: () => void
  onNextPage: () => void
  summary: {
    total: number
    active: number
    completed: number
    failed: number
  }
  sortField: SortField | null
  sortDir: SortDir
  onSort: (field: SortField) => void
  filterOptions: {
    status: FilterOption[]
    source: FilterOption[]
    server: FilterOption[]
  }
  excludeStatus: Set<string>
  excludeSource: Set<string>
  excludeServer: Set<string>
  onStatusFilterChange: (next: Set<string>) => void
  onSourceFilterChange: (next: Set<string>) => void
  onServerFilterChange: (next: Set<string>) => void
  activeFilterChips: ActiveFilterChip[]
  onRemoveFilterChip: (chipKey: string) => void
  onClearAllFilters: () => void
  getUserLabel: (item: TOperation) => string
  getServerLabel: (item: TOperation) => string
  formatTime: (value?: string) => string
  statusVariant: (status: string) => 'default' | 'secondary' | 'destructive' | 'outline'
  selectedIds: Set<string>
  selectedCount: number
  selectedActiveCount: number
  onToggleOperationSelection: (id: string, checked: boolean) => void
  onTogglePageSelection: (checked: boolean) => void
  allPageSelected: boolean
  somePageSelected: boolean
  onDeleteSelected: () => void
  onOpenOperation: (id: string) => void
  renderActionMenu: (item: TOperation) => React.ReactNode
}

function SortableHeader({
  label,
  field,
  current,
  dir,
  onSort,
}: {
  label: string
  field: SortField
  current: SortField | null
  dir: SortDir
  onSort: (field: SortField) => void
}) {
  const active = current === field
  return (
    <button
      type="button"
      className="flex items-center gap-1 hover:text-foreground"
      onClick={() => onSort(field)}
    >
      {label}
      {active ? (
        dir === 'asc' ? (
          <ArrowUp className="h-3.5 w-3.5" />
        ) : (
          <ArrowDown className="h-3.5 w-3.5" />
        )
      ) : (
        <ArrowUp className="h-3.5 w-3.5 opacity-40" />
      )}
    </button>
  )
}

function FilterHeader({
  label,
  options,
  excluded,
  onChange,
}: {
  label: string
  options: FilterOption[]
  excluded: Set<string>
  onChange: (next: Set<string>) => void
}) {
  const active = excluded.size > 0
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex items-center gap-1 hover:text-foreground">
          {label}
          <Filter className={cn('h-3.5 w-3.5', active ? 'text-primary' : 'opacity-40')} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[150px] space-y-1 p-2">
        {options.map(option => (
          <label
            key={option.value}
            className="flex cursor-pointer items-center gap-2 px-1 py-0.5 text-sm"
          >
            <input
              type="checkbox"
              checked={!excluded.has(option.value)}
              onChange={event => {
                const next = new Set(excluded)
                if (event.target.checked) next.delete(option.value)
                else next.add(option.value)
                onChange(next)
              }}
            />
            {option.label}
          </label>
        ))}
        {active ? (
          <button
            type="button"
            className="mt-1 w-full text-center text-xs text-muted-foreground hover:text-foreground"
            onClick={() => onChange(new Set())}
          >
            Reset
          </button>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ActionListView<TOperation extends ActionListItem>({
  search,
  onSearchChange,
  loading,
  pagedItems,
  page,
  totalPages,
  pageSize,
  pageSizeOptions,
  onPageSizeChange,
  onPreviousPage,
  onNextPage,
  summary,
  sortField,
  sortDir,
  onSort,
  filterOptions,
  excludeStatus,
  excludeSource,
  excludeServer,
  onStatusFilterChange,
  onSourceFilterChange,
  onServerFilterChange,
  activeFilterChips,
  onRemoveFilterChip,
  onClearAllFilters,
  getUserLabel,
  getServerLabel,
  formatTime,
  statusVariant,
  selectedIds,
  selectedCount,
  selectedActiveCount,
  onToggleOperationSelection,
  onTogglePageSelection,
  allPageSelected,
  somePageSelected,
  onDeleteSelected,
  onOpenOperation,
  renderActionMenu,
}: ActionListViewProps<TOperation>) {
  const { t } = useTranslation('deploy')
  const [showCreatedColumn, setShowCreatedColumn] = useState(false)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center">
          <div className="text-sm text-muted-foreground">
            {t('list.summary', {
              defaultValue:
                'Total: {{total}}, Active ({{active}}), Completed ({{completed}}), Failed ({{failed}})',
              total: summary.total,
              active: summary.active,
              completed: summary.completed,
              failed: summary.failed,
            })}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={event => onSearchChange(event.target.value)}
              placeholder={t('list.searchPlaceholder', { defaultValue: 'Search activity...' })}
              className="w-full min-w-[220px] pl-9 lg:w-[280px]"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 self-start lg:self-auto">
          <div className="inline-flex items-center gap-0.5 px-1 py-0.5 text-sm text-muted-foreground">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full"
              disabled={page <= 1}
              onClick={onPreviousPage}
              aria-label={t('list.previousPage', { defaultValue: 'Previous page' })}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-0.5 text-center font-mono text-xs text-foreground">
              {page}/{totalPages}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full"
              disabled={page >= totalPages}
              onClick={onNextPage}
              aria-label={t('list.nextPage', { defaultValue: 'Next page' })}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full"
                aria-label={t('list.settings', { defaultValue: 'List settings' })}
              >
                <Settings2 className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuLabel>
                {t('list.columns', { defaultValue: 'Columns' })}
              </DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                checked={showCreatedColumn}
                onCheckedChange={checked => setShowCreatedColumn(Boolean(checked))}
              >
                {t('list.created', { defaultValue: 'Created' })}
              </DropdownMenuCheckboxItem>
              <DropdownMenuLabel>
                {t('list.itemsPerPage', { defaultValue: 'Items per page' })}
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={String(pageSize)}
                onValueChange={value => onPageSizeChange(Number(value))}
              >
                {pageSizeOptions.map(option => (
                  <DropdownMenuRadioItem key={option} value={String(option)}>
                    {t('list.perPage', { defaultValue: '{{count}} / page', count: option })}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {selectedCount > 0 ? (
            <Button
              variant="destructive"
              size="sm"
              disabled={selectedActiveCount > 0}
              onClick={onDeleteSelected}
            >
              <Trash2 className="h-4 w-4" />
              {t('list.deleteSelected', {
                defaultValue: 'Delete Selected ({{count}})',
                count: selectedCount,
              })}
            </Button>
          ) : null}
          {selectedActiveCount > 0 ? (
            <span className="text-xs text-muted-foreground">
              {t('list.activeNotDeletable', {
                defaultValue: 'Executing activity items cannot be deleted.',
              })}
            </span>
          ) : null}
        </div>
      </div>

      {activeFilterChips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {activeFilterChips.map(chip => (
            <Badge key={chip.key} variant="outline" className="gap-1 rounded-full px-3 py-1">
              {chip.label}
              <button
                type="button"
                className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={`Remove ${chip.label}`}
                onClick={() => onRemoveFilterChip(chip.key)}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <Button variant="ghost" size="sm" onClick={onClearAllFilters}>
            {t('list.clearFilters', { defaultValue: 'Clear filters' })}
          </Button>
        </div>
      ) : null}

      {selectedCount > 0 ? (
        <div className="text-sm text-muted-foreground">
          {selectedCount === 1
            ? t('list.selected', {
                defaultValue: '{{count}} action selected.',
                count: selectedCount,
              })
            : t('list.selectedPlural', {
                defaultValue: '{{count}} actions selected.',
                count: selectedCount,
              })}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allPageSelected ? true : somePageSelected ? 'indeterminate' : false}
                  aria-label={t('list.selectVisible', {
                    defaultValue: 'Select visible activity items',
                  })}
                  onCheckedChange={checked => onTogglePageSelection(Boolean(checked))}
                />
              </TableHead>
              <TableHead>
                <SortableHeader
                  label={t('list.headers.appName', { defaultValue: 'App Name' })}
                  field="compose_project_name"
                  current={sortField}
                  dir={sortDir}
                  onSort={onSort}
                />
              </TableHead>
              <TableHead>
                <FilterHeader
                  label={t('list.headers.source', { defaultValue: 'Source' })}
                  options={filterOptions.source}
                  excluded={excludeSource}
                  onChange={onSourceFilterChange}
                />
              </TableHead>
              <TableHead>
                <FilterHeader
                  label={t('list.headers.status', { defaultValue: 'Status' })}
                  options={filterOptions.status}
                  excluded={excludeStatus}
                  onChange={onStatusFilterChange}
                />
              </TableHead>
              <TableHead>
                <FilterHeader
                  label={t('list.headers.server', { defaultValue: 'Server' })}
                  options={filterOptions.server}
                  excluded={excludeServer}
                  onChange={onServerFilterChange}
                />
              </TableHead>
              <TableHead>
                {t('list.headers.totalDuration', { defaultValue: 'Total duration' })}
              </TableHead>
              {showCreatedColumn ? (
                <TableHead>
                  <SortableHeader
                    label={t('list.created', { defaultValue: 'Created' })}
                    field="created"
                    current={sortField}
                    dir={sortDir}
                    onSort={onSort}
                  />
                </TableHead>
              ) : null}
              <TableHead>
                <SortableHeader
                  label={t('list.headers.started', { defaultValue: 'Started' })}
                  field="started_at"
                  current={sortField}
                  dir={sortDir}
                  onSort={onSort}
                />
              </TableHead>
              <TableHead>
                <SortableHeader
                  label={t('list.headers.finished', { defaultValue: 'Finished' })}
                  field="finished_at"
                  current={sortField}
                  dir={sortDir}
                  onSort={onSort}
                />
              </TableHead>
              <TableHead>{t('list.headers.user', { defaultValue: 'User' })}</TableHead>
              <TableHead className="w-[84px] text-right">
                {t('list.headers.action', { defaultValue: 'Action' })}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell
                  colSpan={showCreatedColumn ? 11 : 10}
                  className="py-8 text-center text-muted-foreground"
                >
                  {t('list.loading', { defaultValue: 'Loading activity...' })}
                </TableCell>
              </TableRow>
            ) : pagedItems.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={showCreatedColumn ? 11 : 10}
                  className="py-8 text-center text-muted-foreground"
                >
                  {t('list.empty', { defaultValue: 'No action records found.' })}
                </TableCell>
              </TableRow>
            ) : (
              pagedItems.map(item => (
                <TableRow
                  key={item.id}
                  data-state={selectedIds.has(item.id) ? 'selected' : undefined}
                >
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.has(item.id)}
                      aria-label={t('list.selectItem', {
                        defaultValue: 'Select {{name}}',
                        name: item.compose_project_name || item.id,
                      })}
                      onCheckedChange={checked =>
                        onToggleOperationSelection(item.id, Boolean(checked))
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <div>
                      <button
                        type="button"
                        className="font-medium text-left text-foreground hover:text-primary hover:underline"
                        onClick={() => onOpenOperation(item.id)}
                      >
                        {item.compose_project_name}
                      </button>
                      <div className="font-mono text-xs text-muted-foreground">{item.id}</div>
                    </div>
                  </TableCell>
                  <TableCell>{item.source}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(item.status)}>
                      {actionStatusLabel(item.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{getServerLabel(item)}</div>
                    <div className="text-xs text-muted-foreground">{item.server_id || 'local'}</div>
                  </TableCell>
                  <TableCell>{actionDurationLabel(item)}</TableCell>
                  {showCreatedColumn ? <TableCell>{formatTime(item.created)}</TableCell> : null}
                  <TableCell>{formatTime(item.started_at)}</TableCell>
                  <TableCell>{formatTime(item.finished_at)}</TableCell>
                  <TableCell>{getUserLabel(item)}</TableCell>
                  <TableCell className="text-right">{renderActionMenu(item)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
