import { useMemo } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  ActiveServicesControls,
  ActiveServicesTableContent,
  useActiveServicesController,
} from '@/pages/platform-components/PlatformComponentsPage'
import {
  formatComponentStatusTime,
  type ComponentItem,
  useInstalledComponentsController,
} from '@/pages/platform-components/platform-component-status-shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

function componentSortWeight(component: ComponentItem): number {
  const id = String(component.id || '').toLowerCase()
  if (id === 'os') return 0
  if (id === 'appos') return 1
  return 2
}

function summarizeRuntimeShape(components: ComponentItem[]): string {
  if (components.length === 0) {
    return 'No built-in runtime components have been detected yet.'
  }

  const pendingCount = components.filter(component => component.probe_pending).length
  const knownComponents = components.filter(component => !component.probe_pending)
  const availableCount = knownComponents.filter(component => component.available).length
  const unavailableCount = knownComponents.length - availableCount

  if (pendingCount === components.length) {
    return `AppOS is still checking ${pendingCount} built-in component${pendingCount === 1 ? '' : 's'}.`
  }

  if (unavailableCount === 0 && pendingCount === 0) {
    return `AppOS currently exposes ${availableCount} built-in component${availableCount === 1 ? '' : 's'} in the local runtime.`
  }

  if (pendingCount > 0) {
    return `AppOS currently exposes ${availableCount} available built-in component${availableCount === 1 ? '' : 's'} with ${pendingCount} still checking.`
  }

  return `AppOS currently exposes ${availableCount} available built-in component${availableCount === 1 ? '' : 's'} with ${unavailableCount} unavailable.`
}

function formatComponentVersion(value: string, probePending: boolean): string {
  if (probePending && (!value || value === 'unknown')) return 'Checking...'
  return value || 'unknown'
}

function BundledComponentsDetailContent({
  components,
  loading,
  error,
}: {
  components: ComponentItem[]
  loading: boolean
  error: string
}) {
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-muted-foreground">Loading built-in components...</p>
      </div>
    )
  }

  if (components.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-muted-foreground">No built-in components were detected.</p>
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="border-b-0 hover:bg-transparent">
          <TableHead>Name</TableHead>
          <TableHead>Version</TableHead>
          <TableHead>Availability</TableHead>
          <TableHead>Service</TableHead>
          <TableHead className="text-right">Updated at</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {components.map(component => (
          <TableRow key={component.id} className="border-b-0 hover:bg-transparent">
            <TableCell className="font-medium text-foreground">{component.name || component.id}</TableCell>
            <TableCell className="text-muted-foreground">
              {formatComponentVersion(component.version, component.probe_pending)}
            </TableCell>
            <TableCell>
              <Badge
                variant={
                  component.probe_pending ? 'outline' : component.available ? 'default' : 'destructive'
                }
              >
                {component.probe_pending
                  ? 'Checking...'
                  : component.available
                    ? 'Available'
                    : 'Unavailable'}
              </Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {component.runtime_kind === 'service' ? 'Yes' : 'No'}
            </TableCell>
            <TableCell className="text-right text-muted-foreground">
              {formatComponentStatusTime(component.updated_at)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function PlatformRuntimePage() {
  const componentsController = useInstalledComponentsController()
  const servicesController = useActiveServicesController()

  const sortedComponents = useMemo(
    () =>
      [...componentsController.components].sort((a, b) => {
        const weightDiff = componentSortWeight(a) - componentSortWeight(b)
        if (weightDiff !== 0) return weightDiff
        return String(a.name || a.id || '').localeCompare(String(b.name || b.id || ''))
      }),
    [componentsController.components]
  )

  const pendingCount = componentsController.components.filter(component => component.probe_pending).length
  const knownComponents = componentsController.components.filter(component => !component.probe_pending)
  const availableCount = knownComponents.filter(component => component.available).length
  const unavailableCount = knownComponents.length - availableCount
  const activeServiceCount = servicesController.services.length

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Platform Runtime</h1>
          <p className="mt-1 text-muted-foreground">
            Inspect active services and built-in tools that currently make up the AppOS runtime.
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          title="Refresh built-in components"
          aria-label="Refresh built-in components"
          onClick={() => void componentsController.refresh(true)}
          disabled={componentsController.loading}
        >
          {componentsController.loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Runtime Summary</CardTitle>
          <CardDescription>{summarizeRuntimeShape(componentsController.components)}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-lg border bg-background px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Built-in Components
            </div>
            <div className="mt-2 text-2xl font-semibold text-foreground">{componentsController.components.length}</div>
          </div>
          <div className="rounded-lg border bg-background px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Available</div>
            <div className="mt-2 text-2xl font-semibold text-foreground">{availableCount}</div>
          </div>
          <div className="rounded-lg border bg-background px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Unavailable
            </div>
            <div className="mt-2 text-2xl font-semibold text-foreground">{unavailableCount}</div>
          </div>
          {pendingCount > 0 ? (
            <div className="rounded-lg border bg-background px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Checking
              </div>
              <div className="mt-2 text-2xl font-semibold text-foreground">{pendingCount}</div>
            </div>
          ) : null}
          <div className="rounded-lg border bg-background px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Active Services
            </div>
            <div className="mt-2 text-2xl font-semibold text-foreground">{activeServiceCount}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Active Services</CardTitle>
              <CardDescription>
                Runtime services currently detected for this AppOS instance, including diagnostic services.
              </CardDescription>
            </div>
            <ActiveServicesControls controller={servicesController} />
          </div>
        </CardHeader>
        <CardContent>
          <ActiveServicesTableContent
            controller={servicesController}
            hideControls
            emptyMessage="No active services are configured."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Built-in Components</CardTitle>
          <CardDescription>
            Built-in tools and embedded dependencies currently exposed inside the AppOS runtime.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BundledComponentsDetailContent
            components={sortedComponents}
            loading={componentsController.loading}
            error={componentsController.error}
          />
        </CardContent>
      </Card>
    </div>
  )
}
