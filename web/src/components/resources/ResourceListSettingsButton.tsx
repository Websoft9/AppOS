import { SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type ResourceListSettingsButtonProps = {
  title: string
  rowsPerPageLabel: string
  rowsPerPageOptionLabel: (count: number) => string
  columnsLabel: string
  pageSize: number
  setPageSize: (pageSize: number) => void
  pageSizeOptions: number[]
  columnOptions: Array<{
    key: string
    label: string
    checked: boolean
  }>
  onColumnToggle: (columnKey: string, checked: boolean) => void
}

export function ResourceListSettingsButton({
  title,
  rowsPerPageLabel,
  rowsPerPageOptionLabel,
  columnsLabel,
  pageSize,
  setPageSize,
  pageSizeOptions,
  columnOptions,
  onColumnToggle,
}: ResourceListSettingsButtonProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" title={title} aria-label={title}>
          <SlidersHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>{rowsPerPageLabel}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={String(pageSize)} onValueChange={value => setPageSize(Number(value))}>
          {pageSizeOptions.map(option => (
            <DropdownMenuRadioItem key={option} value={String(option)}>
              {rowsPerPageOptionLabel(option)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{columnsLabel}</DropdownMenuLabel>
        {columnOptions.map(option => (
          <DropdownMenuCheckboxItem
            key={option.key}
            checked={option.checked}
            onCheckedChange={checked => onColumnToggle(option.key, checked === true)}
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}