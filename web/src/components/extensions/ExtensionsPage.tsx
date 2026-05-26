import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { preloadSoftwareLogos, SoftwareLogo } from '@/components/software/software-logos'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  listSupportedServerSoftware,
  type SupportedServerSoftwareEntry,
} from '@/lib/software-api'

function capabilityLabel(capability?: string): string {
  if (!capability) return 'Platform'
  return capability.replaceAll('_', ' ')
}

function artifactLabel(item: SupportedServerSoftwareEntry): string {
  return item.artifact_kind || item.template_kind
}

function conciseDescription(description: string): string {
  const firstSentence = description.split(/(?<=[.!?])\s+/)[0]?.trim()
  return firstSentence && firstSentence.length > 0 ? firstSentence : description
}

function PlatformExtensionEmptyState({ loading }: { loading: boolean }) {
  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading platform extensions…</div>
  }

  return (
    <Card className="border-dashed border-border/70 bg-muted/20">
      <CardContent className="space-y-3 px-5 py-6">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-base font-semibold leading-tight">Platform extensions are coming later</p>
          <span className="rounded-full border border-border/70 bg-background px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Coming soon
          </span>
        </div>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          AppOS does not expose a real platform extension model yet. Built-in runtime components stay outside this tab until that packaging model exists.
        </p>
      </CardContent>
    </Card>
  )
}

function ServerExtensionGrid({
  items,
  loading,
  error,
}: {
  items: SupportedServerSoftwareEntry[]
  loading: boolean
  error: string
}) {
  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading server extensions…</div>
  }

  if (error) {
    return <div className="text-sm text-destructive">{error}</div>
  }

  if (items.length === 0) {
    return <div className="text-sm text-muted-foreground">No server extensions are available.</div>
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {items.map(item => (
        <div key={item.component_key} className="group block rounded-xl">
          <Card className="h-full border-border/70 transition-all duration-150 group-hover:-translate-y-0.5 group-hover:border-primary/30 group-hover:shadow-sm">
            <CardContent className="space-y-4 px-5 py-5">
              <div className="flex min-w-0 items-center gap-3">
                <SoftwareLogo componentKey={item.component_key} label={item.label} />
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold leading-tight">{item.label}</p>
                  <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    {artifactLabel(item)} extension
                  </p>
                </div>
              </div>

              <p className="text-sm leading-relaxed text-muted-foreground">
                {conciseDescription(item.description)}
              </p>

              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-xs font-medium text-foreground/80">
                  {capabilityLabel(item.capability)}
                </span>
                {item.supported_actions.slice(0, 3).map(action => (
                  <span
                    key={action}
                    className="rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-xs font-medium text-foreground/80"
                  >
                    {action}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      ))}
    </div>
  )
}

export function ExtensionsPage() {
  const [serverItems, setServerItems] = useState<SupportedServerSoftwareEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const loadServerExtensions = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'refresh') {
      setRefreshing(true)
    } else {
      setLoading(true)
    }

    setError('')
    try {
      const items = await listSupportedServerSoftware()
      setServerItems(items)
      preloadSoftwareLogos(items)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load server extensions')
    } finally {
      if (mode === 'refresh') {
        setRefreshing(false)
      } else {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    void loadServerExtensions()
  }, [loadServerExtensions])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Extensions</h1>
          <p className="text-muted-foreground">
            Platform-managed capabilities across the AppOS runtime and managed servers.
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label="Refresh extensions"
          title="Refresh extensions"
          onClick={() => void loadServerExtensions('refresh')}
          disabled={loading || refreshing}
        >
          <RefreshCw className={`h-4 w-4 ${loading || refreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <Tabs defaultValue="platform" className="space-y-4">
        <TabsList
          variant="line"
          className="inline-flex h-auto w-auto justify-start gap-6 rounded-none border-b p-0"
        >
          <TabsTrigger
            value="platform"
            className="h-auto flex-none rounded-none px-0 pb-3 pt-0 text-sm font-medium after:bottom-[-1px] after:w-full"
          >
            Platform
          </TabsTrigger>
          <TabsTrigger
            value="server"
            className="h-auto flex-none rounded-none px-0 pb-3 pt-0 text-sm font-medium after:bottom-[-1px] after:w-full"
          >
            Server
          </TabsTrigger>
        </TabsList>

        <TabsContent value="platform" className="space-y-4">
          <section
            className="space-y-4 rounded-2xl bg-card/40 p-4 sm:p-5"
            aria-labelledby="platform-extensions-title"
          >
            <div>
              <h2 id="platform-extensions-title" className="text-lg font-semibold tracking-tight">
                Platform Extensions
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Reserved for future AppOS platform extension packages, not built-in runtime components.
              </p>
            </div>
            <PlatformExtensionEmptyState loading={loading} />
          </section>
        </TabsContent>

        <TabsContent value="server" className="space-y-4">
          <section
            className="space-y-4 rounded-2xl bg-card/40 p-4 sm:p-5"
            aria-labelledby="server-extensions-title"
          >
            <div>
              <h2 id="server-extensions-title" className="text-lg font-semibold tracking-tight">
                Server Extensions
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                What AppOS can extend onto managed servers through software-backed capability delivery.
              </p>
            </div>
            <ServerExtensionGrid items={serverItems} loading={loading} error={error} />
          </section>
        </TabsContent>
      </Tabs>
    </div>
  )
}