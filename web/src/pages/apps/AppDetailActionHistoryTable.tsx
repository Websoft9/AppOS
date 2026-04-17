import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { ActionRecord } from '@/pages/deploy/actions/action-types'
import { actionDurationLabel, statusVariant } from '@/pages/deploy/actions/action-utils'
import { formatTime } from '@/pages/apps/types'
import { getActionLabel } from '@/pages/apps/app-detail-utils'

type AppDetailActionHistoryTableProps = {
  actions: ActionRecord[]
  buildActionDetailHref: (actionId: string) => string
}

export function AppDetailActionHistoryTable({
  actions,
  buildActionDetailHref,
}: AppDetailActionHistoryTableProps) {
  return (
    <Table containerClassName="rounded-xl border">
      <TableHeader>
        <TableRow>
          <TableHead>Action</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Phase</TableHead>
          <TableHead>Started</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead>Server</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Project</TableHead>
          <TableHead className="text-right">Detail</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {actions.map(action => (
          <TableRow key={action.id}>
            <TableCell className="min-w-[180px] align-top">
              <div className="font-medium">{getActionLabel(action)}</div>
              <div className="line-clamp-1 text-xs text-muted-foreground">
                {action.error_summary || action.id}
              </div>
            </TableCell>
            <TableCell>
              <Badge variant={statusVariant(action.status)}>{action.status}</Badge>
            </TableCell>
            <TableCell>{action.pipeline?.current_phase || '-'}</TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {formatTime(action.started_at || action.pipeline?.started_at || action.created)}
            </TableCell>
            <TableCell>{actionDurationLabel(action)}</TableCell>
            <TableCell>{action.server_label || action.server_id || 'local'}</TableCell>
            <TableCell>{action.source || action.pipeline_selector?.source || '-'}</TableCell>
            <TableCell className="max-w-[180px] truncate">
              {action.compose_project_name || '-'}
            </TableCell>
            <TableCell className="text-right">
              <Button variant="outline" size="sm" asChild>
                <a href={buildActionDetailHref(action.id)} target="_blank" rel="noreferrer">
                  Open Detail
                </a>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
