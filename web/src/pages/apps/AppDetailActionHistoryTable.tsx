import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  canCancelAction,
  canForceFailAction,
  canResumeAction,
} from '@/pages/deploy/actions/action-utils'
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
  onRequestCancel?: (action: ActionRecord) => void
  onRequestForceFail?: (action: ActionRecord) => void
  onRequestResume?: (action: ActionRecord) => void
}

export function AppDetailActionHistoryTable({
  actions,
  buildActionDetailHref,
  onRequestCancel,
  onRequestForceFail,
  onRequestResume,
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
          <TableHead className="text-right">Actions</TableHead>
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
              <div className="flex flex-wrap justify-end gap-2">
                {onRequestCancel && canCancelAction(action) ? (
                  <Button variant="outline" size="sm" onClick={() => onRequestCancel(action)}>
                    Cancel
                  </Button>
                ) : null}
                {onRequestForceFail && canForceFailAction(action) ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => onRequestForceFail(action)}
                  >
                    Force Fail
                  </Button>
                ) : null}
                {onRequestResume && canResumeAction(action) ? (
                  <Button variant="outline" size="sm" onClick={() => onRequestResume(action)}>
                    Resume
                  </Button>
                ) : null}
                <Button variant="outline" size="sm" asChild>
                  <a href={buildActionDetailHref(action.id)} target="_blank" rel="noreferrer">
                    Open Detail
                  </a>
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
