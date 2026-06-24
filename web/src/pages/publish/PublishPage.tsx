import { useMemo, useState } from 'react'
import { ExternalLink, Globe, Plus, Search, Shield, TimerReset } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type PublishStatus = 'active' | 'draft' | 'expired'

type PublishRecord = {
  id: string
  name: string
  appName: string
  target: string
  accessPath: string
  status: PublishStatus
  visibility: 'public' | 'private-preview'
  expiresAt: string
  updatedAt: string
}

const INITIAL_RECORDS: PublishRecord[] = [
  {
    id: 'publish-1',
    name: 'Traefik Dashboard',
    appName: 'Traefik',
    target: 'Gateway Admin',
    accessPath: '/publish/traefik',
    status: 'active',
    visibility: 'public',
    expiresAt: 'No expiry',
    updatedAt: '5 minutes ago',
  },
  {
    id: 'publish-2',
    name: 'WordPress Preview',
    appName: 'WordPress',
    target: 'App Console',
    accessPath: '/publish/wordpress-preview',
    status: 'draft',
    visibility: 'private-preview',
    expiresAt: 'In 2 hours',
    updatedAt: '12 minutes ago',
  },
  {
    id: 'publish-3',
    name: 'Netdata Public View',
    appName: 'Netdata',
    target: 'Monitoring Surface',
    accessPath: '/publish/netdata',
    status: 'expired',
    visibility: 'public',
    expiresAt: 'Expired yesterday',
    updatedAt: '1 day ago',
  },
]

function statusVariant(status: PublishStatus): 'default' | 'secondary' | 'destructive' {
  if (status === 'active') return 'default'
  if (status === 'expired') return 'destructive'
  return 'secondary'
}

function statusLabel(status: PublishStatus): string {
  if (status === 'active') return 'Active'
  if (status === 'expired') return 'Expired'
  return 'Draft'
}

export function PublishPage() {
  const [query, setQuery] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [records, setRecords] = useState<PublishRecord[]>(INITIAL_RECORDS)
  const [name, setName] = useState('')
  const [appName, setAppName] = useState('')
  const [target, setTarget] = useState('')
  const [accessPath, setAccessPath] = useState('')

  const filteredRecords = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return records
    return records.filter(record =>
      [record.name, record.appName, record.target, record.accessPath].some(value =>
        value.toLowerCase().includes(keyword)
      )
    )
  }, [records, query])

  const activeCount = records.filter(record => record.status === 'active').length
  const draftCount = records.filter(record => record.status === 'draft').length
  const expiredCount = records.filter(record => record.status === 'expired').length

  function resetForm() {
    setName('')
    setAppName('')
    setTarget('')
    setAccessPath('')
  }

  function handleCreate() {
    if (!name.trim() || !appName.trim() || !target.trim() || !accessPath.trim()) return

    setRecords(prev => [
      {
        id: `publish-${prev.length + 1}`,
        name: name.trim(),
        appName: appName.trim(),
        target: target.trim(),
        accessPath: accessPath.trim(),
        status: 'draft',
        visibility: 'private-preview',
        expiresAt: 'Not scheduled',
        updatedAt: 'Just now',
      },
      ...prev,
    ])
    resetForm()
    setDialogOpen(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Publish</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage Public Access records and create shareable publish items from one list.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="gap-2 self-start">
          <Plus className="h-4 w-4" />
          New Publish Item
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Active endpoints</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Globe className="h-5 w-5 text-primary" />
              {activeCount}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Draft items</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Shield className="h-5 w-5 text-muted-foreground" />
              {draftCount}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Expired access</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <TimerReset className="h-5 w-5 text-destructive" />
              {expiredCount}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>Public Access Records</CardTitle>
            <CardDescription>
              This demo list shows all published entry points and manual publish items in one place.
            </CardDescription>
          </div>
          <div className="relative w-full md:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search publish records"
              className="pl-9"
            />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>App</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Access Path</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRecords.length > 0 ? (
                filteredRecords.map(record => (
                  <TableRow key={record.id}>
                    <TableCell className="font-medium">{record.name}</TableCell>
                    <TableCell>{record.appName}</TableCell>
                    <TableCell>{record.target}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span className="font-mono">{record.accessPath}</span>
                        <ExternalLink className="h-3.5 w-3.5" />
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(record.status)}>{statusLabel(record.status)}</Badge>
                    </TableCell>
                    <TableCell>{record.expiresAt}</TableCell>
                    <TableCell>{record.updatedAt}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                    No publish records match the current search.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Publish Item</DialogTitle>
            <DialogDescription>
              Create a manual Public Access record for a gateway, console, or app preview.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="publish-name">Name</Label>
              <Input id="publish-name" value={name} onChange={event => setName(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="publish-app">App</Label>
              <Input id="publish-app" value={appName} onChange={event => setAppName(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="publish-target">Target</Label>
              <Input id="publish-target" value={target} onChange={event => setTarget(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="publish-path">Access Path</Label>
              <Input
                id="publish-path"
                placeholder="/publish/example"
                value={accessPath}
                onChange={event => setAccessPath(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { resetForm(); setDialogOpen(false) }}>
              Cancel
            </Button>
            <Button onClick={handleCreate}>Create Draft</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}