import { Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { ManualDialogCopy, ServerEntry } from '@/pages/deploy/operations/operation-types'

type ManualDeploymentDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  dialogCopy: ManualDialogCopy
  servers: ServerEntry[]
  serverId: string
  onServerIdChange: (value: string) => void
  projectName: string
  onProjectNameChange: (value: string) => void
  compose: string
  onComposeChange: (value: string) => void
  submitting: boolean
  onSubmit: () => void
}

export function ManualDeploymentDialog({
  open,
  onOpenChange,
  dialogCopy,
  servers,
  serverId,
  onServerIdChange,
  projectName,
  onProjectNameChange,
  compose,
  onComposeChange,
  submitting,
  onSubmit,
}: ManualDeploymentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{dialogCopy.title}</DialogTitle>
          <DialogDescription>{dialogCopy.description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="rounded-lg border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">{dialogCopy.helper}</div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="deploy-project-name">Name</Label><Input id="deploy-project-name" value={projectName} onChange={event => onProjectNameChange(event.target.value)} placeholder="demo-nginx" /></div>
            <div className="space-y-2"><Label htmlFor="deploy-server-id">Target Server</Label><select id="deploy-server-id" className="border-input bg-background h-10 rounded-md border px-3 text-sm" value={serverId} onChange={event => onServerIdChange(event.target.value)}>{servers.map(item => <option key={item.id} value={item.id}>{item.label} ({item.host})</option>)}</select></div>
          </div>
          <div className="space-y-2"><Label htmlFor="deploy-compose">docker-compose.yml</Label><Textarea id="deploy-compose" className="min-h-[300px] font-mono text-xs" value={compose} onChange={event => onComposeChange(event.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button><Button onClick={onSubmit} disabled={submitting || !projectName.trim() || !compose.trim()}>{submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Create Deployment</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}