import { GitBranch, Loader2 } from 'lucide-react'
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
import type { ServerEntry } from '@/pages/deploy/deploy-types'

type GitDeploymentDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  servers: ServerEntry[]
  serverId: string
  onServerIdChange: (value: string) => void
  projectName: string
  onProjectNameChange: (value: string) => void
  repositoryUrl: string
  onRepositoryUrlChange: (value: string) => void
  gitRef: string
  onGitRefChange: (value: string) => void
  composePath: string
  onComposePathChange: (value: string) => void
  authHeaderName: string
  onAuthHeaderNameChange: (value: string) => void
  authHeaderValue: string
  onAuthHeaderValueChange: (value: string) => void
  submitting: boolean
  onSubmit: () => void
}

export function GitDeploymentDialog({
  open,
  onOpenChange,
  servers,
  serverId,
  onServerIdChange,
  projectName,
  onProjectNameChange,
  repositoryUrl,
  onRepositoryUrlChange,
  gitRef,
  onGitRefChange,
  composePath,
  onComposePathChange,
  authHeaderName,
  onAuthHeaderNameChange,
  authHeaderValue,
  onAuthHeaderValueChange,
  submitting,
  onSubmit,
}: GitDeploymentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Create Deployment from Git Repository</DialogTitle>
          <DialogDescription>Provide the Git repository, ref, and compose file path. The backend resolves the raw compose file and creates a deployment task through the shared flow.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="git-project-name">Name</Label><Input id="git-project-name" value={projectName} onChange={event => onProjectNameChange(event.target.value)} placeholder="Optional: defaults to repository name" /></div>
            <div className="space-y-2"><Label htmlFor="git-server-id">Target Server</Label><select id="git-server-id" className="border-input bg-background h-10 rounded-md border px-3 text-sm" value={serverId} onChange={event => onServerIdChange(event.target.value)}>{servers.map(item => <option key={item.id} value={item.id}>{item.label} ({item.host})</option>)}</select></div>
          </div>
          <div className="space-y-2"><Label htmlFor="git-repository-url">Repository URL</Label><Input id="git-repository-url" value={repositoryUrl} onChange={event => onRepositoryUrlChange(event.target.value)} placeholder="https://github.com/org/repo" /></div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="git-ref">Ref</Label><Input id="git-ref" value={gitRef} onChange={event => onGitRefChange(event.target.value)} placeholder="main" /></div>
            <div className="space-y-2"><Label htmlFor="git-compose-path">Compose Path</Label><Input id="git-compose-path" value={composePath} onChange={event => onComposePathChange(event.target.value)} placeholder="docker-compose.yml" /></div>
          </div>
          <div className="rounded-lg border bg-muted/20 p-4">
            <div className="text-sm font-medium">Private Repository Access</div>
            <div className="mt-1 text-xs text-muted-foreground">Optional. The header is used only to fetch the compose file and is not stored in deployment records.</div>
            <div className="mt-3 grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
              <div className="space-y-2"><Label htmlFor="git-auth-header-name">Header Name</Label><Input id="git-auth-header-name" value={authHeaderName} onChange={event => onAuthHeaderNameChange(event.target.value)} placeholder="Authorization" /></div>
              <div className="space-y-2"><Label htmlFor="git-auth-header-value">Header Value</Label><Input id="git-auth-header-value" value={authHeaderValue} onChange={event => onAuthHeaderValueChange(event.target.value)} placeholder="Bearer <token>" /></div>
            </div>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button><Button onClick={onSubmit} disabled={submitting || !repositoryUrl.trim() || !composePath.trim()}>{submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GitBranch className="mr-2 h-4 w-4" />}Create Deployment</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}