import { CircleHelp } from 'lucide-react'
import { formatResourceDateTime } from '@/components/resources/resource-formatters'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

type ResourceStatusTimestampProps = {
  checkedAt?: string | null | undefined
  sourceLabel?: string | null | undefined
  detail?: string | null | undefined
  emptyLabel?: string
}

export function ResourceStatusTimestamp({
  checkedAt,
  sourceLabel,
  detail,
  emptyLabel = '—',
}: ResourceStatusTimestampProps) {
  const formatted = formatResourceDateTime(checkedAt)
  if (formatted === '—') {
    return <span className="text-sm text-muted-foreground">{emptyLabel}</span>
  }

  const source = String(sourceLabel ?? '').trim()
  const detailText = String(detail ?? '').trim()
  if (!source) {
    return <span className="text-sm text-muted-foreground">{formatted}</span>
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
            <span>{formatted}</span>
            <CircleHelp className="h-3.5 w-3.5" />
          </span>
        </TooltipTrigger>
        <TooltipContent sideOffset={6} className="max-w-64 space-y-1">
          <div className="font-medium">{source}</div>
          {detailText ? <div>{detailText}</div> : null}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
