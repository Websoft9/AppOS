import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  ActiveServicesControls,
  ActiveServicesTableContent,
  useActiveServicesController,
} from '@/pages/platform-components/PlatformComponentsPage'
import {
  fetchInstalledComponents,
  formatComponentStatusTime,
  type ComponentItem,
} from '@/pages/platform-components/platform-component-status-shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

function titleizeRuntimeKind(value: string): string {
  if (!value) return 'Unknown runtime'
  return value
    .split('_')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function defaultVisibilityService(service: { visibility: string }) {
  return service.visibility === 'default'
}

function nonDefaultVisibilityService(service: { visibility: string }) {
  return service.visibility !== 'default'
}

function summarizeDiagnosticServices(count: number): string {
  if (count === 0) {
    return 'No diagnostic-only services are declared in the current runtime registry.'
  }

  return `${count} service${count === 1 ? '' : 's'} are marked diagnostic or hidden and kept outside the default operator surface.`
}

function summarizeRuntimeShape(components: ComponentItem[]): string {
  if (components.length === 0) {
    return 'No built-in runtime components have been detected yet.'
  }

  const availableCount = components.filter(component => component.available).length
  const unavailableCount = components.length - availableCount

  if (unavailableCount === 0) {
    return `AppOS currently exposes ${availableCount} built-in component${availableCount === 1 ? '' : 's'} in the local runtime.`
  }

  return `AppOS currently exposes ${availableCount} available built-in component${availableCount === 1 ? '' : 's'} with ${unavailableCount} unavailable.`
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

  const grouped = components.reduce<Record<string, ComponentItem[]>>((groups, component) => {
    const key = component.runtime_kind || 'other'
    groups[key] = [...(groups[key] || []), component]
    return groups
  }, {})

  return (
    <div className="space-y-5">
      {Object.entries(grouped)
        .sort(([a], [b]) => String(a || '').localeCompare(String(b || '')))
        .map(([runtimeKind, items]) => (
          <div key={runtimeKind} className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {titleizeRuntimeKind(runtimeKind)}
              </h3>
              <p className="text-xs text-muted-foreground">
                {items.length} component{items.length === 1 ? '' : 's'} in this runtime slice.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {items.map(component => (
                <article key={component.id} className="rounded-xl border bg-background/80 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-base font-medium leading-6">{component.name}</p>
                    <Badge variant="outline">{component.criticality || 'unknown'}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {component.role || 'No role declared'}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Capability: {component.owned_capability || 'Not declared'}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant={component.available ? 'default' : 'destructive'}>
                      {component.available ? 'Available' : 'Unavailable'}
                    </Badge>
                    <Badge variant="secondary">{titleizeRuntimeKind(component.runtime_kind)}</Badge>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    Version {component.version || 'unknown'}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Updated {formatComponentStatusTime(component.updated_at)}
                  </p>
                </article>
              ))}
            </div>
          </div>
        ))}
    </div>
  )
}

export function PlatformRuntimePage() {
  const [components, setComponents] = useState<ComponentItem[]>([])
  const [componentsLoading, setComponentsLoading] = useState(true)
  const [componentsError, setComponentsError] = useState('')
  const servicesController = useActiveServicesController()

  const loadComponents = useCallback(async (force = false) => {
    setComponentsLoading(true)
    try {
      setComponents(await fetchInstalledComponents(force))
      setComponentsError('')
    } catch (err) {
      setComponentsError(err instanceof Error ? err.message : 'Failed to load components')
    } finally {
      setComponentsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadComponents()
  }, [loadComponents])

  const sortedComponents = useMemo(
    () => [...components].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    [components]
  )

  const availableCount = components.filter(component => component.available).length
  const unavailableCount = components.length - availableCount
  const diagnosticServiceCount = servicesController.services.filter(nonDefaultVisibilityService).length

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
          onClick={() => void loadComponents(true)}
          disabled={componentsLoading}
        >
          {componentsLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Runtime Summary</CardTitle>
          <CardDescription>{summarizeRuntimeShape(components)}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-lg border bg-background px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Built-in Components
            </div>
            <div className="mt-2 text-2xl font-semibold text-foreground">{components.length}</div>
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
          <div className="rounded-lg border bg-background px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Diagnostic Services
            </div>
            <div className="mt-2 text-2xl font-semibold text-foreground">{diagnosticServiceCount}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Built-in Components</CardTitle>
          <CardDescription>
            Built-in tools and embedded dependencies currently exposed inside the AppOS runtime, grouped by runtime kind.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BundledComponentsDetailContent
            components={sortedComponents}
            loading={componentsLoading}
            error={componentsError}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Active Services</CardTitle>
              <CardDescription>
                Default operator-visible runtime services for the current AppOS instance.
              </CardDescription>
            </div>
            <ActiveServicesControls controller={servicesController} />
          </div>
        </CardHeader>
        <CardContent>
          <ActiveServicesTableContent
            controller={servicesController}
            hideControls
            filter={defaultVisibilityService}
            emptyMessage="No default-visibility services are configured."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Diagnostic Services</CardTitle>
          <CardDescription>{summarizeDiagnosticServices(diagnosticServiceCount)}</CardDescription>
        </CardHeader>
        <CardContent>
          <ActiveServicesTableContent
            controller={servicesController}
            hideControls
            filter={nonDefaultVisibilityService}
            emptyMessage="No diagnostic-only services are configured."
          />
        </CardContent>
      </Card>
    </div>
  )
}
