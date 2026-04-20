import { useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getLocalSoftwareComponent, listLocalSoftwareComponents, type SoftwareComponentDetail, type SoftwareComponentSummary } from '@/lib/software-api'

function statusTone(component: SoftwareComponentSummary): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (component.verification_state === 'degraded') return 'destructive'
  if (component.installed_state === 'installed' && component.verification_state === 'healthy') return 'default'
  if (component.installed_state === 'not_installed') return 'secondary'
  return 'outline'
}

function statusLabel(component: SoftwareComponentSummary): string {
  if (component.verification_state === 'degraded') return 'Degraded'
  if (component.installed_state === 'installed' && component.verification_state === 'healthy') return 'Healthy'
  if (component.installed_state === 'not_installed') return 'Not Installed'
  return 'Unknown'
}

export function LocalSoftwareInventoryPage() {
  const [items, setItems] = useState<SoftwareComponentSummary[]>([])
  const [selected, setSelected] = useState<SoftwareComponentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  async function load(selectKey?: string) {
    const setBusy = loading ? setLoading : setRefreshing
    setBusy(true)
    setError('')
    try {
      const summaries = await listLocalSoftwareComponents()
      setItems(summaries)
      const nextKey = selectKey ?? selected?.component_key ?? summaries[0]?.component_key
      if (nextKey) {
        setSelected(await getLocalSoftwareComponent(nextKey))
      } else {
        setSelected(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load local software inventory')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function selectComponent(componentKey: string) {
    setRefreshing(true)
    setError('')
    try {
      setSelected(await getLocalSoftwareComponent(componentKey))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load component detail')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Local Software</h1>
          <p className="mt-1 text-muted-foreground">
            AppOS-local runtime inventory backed by the Software Delivery catalog, local probes, and persisted snapshots.
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={loading || refreshing} onClick={() => void load()}>
          {loading || refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[1.2fr,0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Inventory</CardTitle>
            <CardDescription>Bundled binaries and supervisord-managed services on the current AppOS host.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {items.map(item => (
              <button
                key={item.component_key}
                type="button"
                onClick={() => void selectComponent(item.component_key)}
                className="flex w-full items-start justify-between gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/30"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{item.label}</span>
                    <Badge variant="secondary" className="text-xs uppercase">{item.template_kind}</Badge>
                    <Badge variant={statusTone(item)} className="text-xs">{statusLabel(item)}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {item.component_key}
                    {item.detected_version ? ` · ${item.detected_version}` : ''}
                  </div>
                  {item.preflight?.issues && item.preflight.issues.length > 0 && (
                    <div className="mt-2 text-xs text-amber-700">{item.preflight.issues.join(' | ')}</div>
                  )}
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Detail</CardTitle>
            <CardDescription>Latest local probe and persisted projection for the selected component.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {selected ? (
              <>
                <div>
                  <div className="text-lg font-semibold">{selected.label}</div>
                  <div className="text-muted-foreground">{selected.component_key}</div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-xs uppercase text-muted-foreground">Installed</div>
                    <div>{selected.installed_state}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase text-muted-foreground">Verification</div>
                    <div>{selected.verification_state}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase text-muted-foreground">Version</div>
                    <div>{selected.detected_version || '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase text-muted-foreground">Service</div>
                    <div>{selected.service_name || '—'}</div>
                  </div>
                  <div className="sm:col-span-2">
                    <div className="text-xs uppercase text-muted-foreground">Binary</div>
                    <div>{selected.binary_path || '—'}</div>
                  </div>
                </div>
                {selected.verification?.reason && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900">
                    {selected.verification.reason}
                  </div>
                )}
              </>
            ) : (
              <div className="text-muted-foreground">Select a component to inspect its local inventory detail.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}