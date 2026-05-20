import { Loader2, Pencil, RefreshCw } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import type { ServerFactsView, ServerReadModelItem } from './server-detail-shared'
import { accessLabel, formatTimestamp, tunnelStateLabel } from './server-detail-shared'

type ServerOverviewTabProps = {
  item: ServerReadModelItem
  serverId: string
  facts: ServerFactsView
  status: string
  tunnelState: string
  isTunnel: boolean
  credentialType: string
  credentialId: string
  createdBy: string
  onEditServer?: () => void
  onRefresh?: () => void | Promise<void>
  refreshLoading?: boolean
}

const detailSectionTitleClassName = 'text-sm font-semibold text-foreground'

function firstStringValue(
  item: ServerReadModelItem,
  key: string,
  fallback = 'Unavailable'
): string {
  const value = item[key]
  if (typeof value === 'string' && value.trim()) return value.trim()
  return fallback
}

function formatCloudSourceLabel(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'unavailable') return value
  if (normalized === 'cloud-init') return 'Cloud-init'
  if (normalized === 'metadata') return 'Metadata service'
  if (normalized === 'manual') return 'Manual override'
  return value
}

function formatCredentialTypeLabel(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (!normalized || normalized === '—') return '—'
  if (normalized.includes('password')) return 'Password'
  if (normalized.includes('ssh') || normalized.includes('key')) return 'SSH key'
  return value.trim()
}

export function ServerOverviewTab({
  item,
  serverId,
  facts,
  status,
  tunnelState,
  isTunnel,
  credentialType,
  createdBy,
  onEditServer,
  onRefresh,
  refreshLoading = false,
}: ServerOverviewTabProps) {
  const cloudProviderName = firstStringValue(item, 'cloud_provider_name')
  const cloudProviderRegion = firstStringValue(item, 'cloud_region')
  const cloudProviderZone = firstStringValue(item, 'cloud_zone')
  const cloudProviderSource = formatCloudSourceLabel(
    firstStringValue(item, 'cloud_provider_source')
  )
  const createdAt = formatTimestamp(item.created)
  const updatedAt = formatTimestamp(item.updated)
  const createdByLabel = createdBy.trim() || '—'
  const credentialTypeLabel = formatCredentialTypeLabel(credentialType)

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className={detailSectionTitleClassName}>Server Metadata</h3>
          <div className="flex items-center gap-2">
            {onRefresh ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="shrink-0"
                onClick={() => void onRefresh()}
                disabled={refreshLoading}
                aria-label="Refresh overview data"
                title="Refresh overview data"
              >
                {refreshLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            ) : null}
            {onEditServer ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 px-2.5 text-xs"
                onClick={onEditServer}
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
            ) : null}
          </div>
        </div>
        <dl className="grid gap-x-8 gap-y-5 text-sm sm:grid-cols-2 xl:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">ID</dt>
            <dd className="mt-1 break-all font-mono text-xs">{serverId || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Name</dt>
            <dd className="mt-1 break-all">{String(item.name || '—')}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              Connection Type
            </dt>
            <dd className="mt-1">
              <Badge variant="outline">{isTunnel ? 'Tunnel' : 'Direct'}</Badge>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Host</dt>
            <dd className="mt-1 break-all font-mono text-xs">{String(item.host || '—')}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Port</dt>
            <dd className="mt-1">{String(item.port || '22')}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">User</dt>
            <dd className="mt-1">{String(item.user || 'root')}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Access</dt>
            <dd className="mt-1">
              {status === 'online' ? (
                <Badge variant="default">{accessLabel(status)}</Badge>
              ) : status === 'offline' ? (
                <Badge variant="secondary">{accessLabel(status)}</Badge>
              ) : (
                <Badge variant="outline">{accessLabel(status)}</Badge>
              )}
            </dd>
          </div>
          {isTunnel ? (
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Tunnel State
              </dt>
              <dd className="mt-1">
                <Badge variant="outline">{tunnelStateLabel(tunnelState)}</Badge>
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Credential type</dt>
            <dd className="mt-1">
              {credentialTypeLabel === '—' ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <Badge variant="secondary">{credentialTypeLabel}</Badge>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Created by</dt>
            <dd className="mt-1">{createdByLabel}</dd>
          </div>
          {item.description ? (
            <div className="sm:col-span-2 xl:col-span-3">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Description</dt>
              <dd className="mt-1 text-muted-foreground">{String(item.description)}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Created</dt>
            <dd className="mt-1">{createdAt}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Updated</dt>
            <dd className="mt-1">{updatedAt}</dd>
          </div>
        </dl>
      </section>

      <section className="space-y-4">
        <h3 className={detailSectionTitleClassName}>System Information</h3>
        {facts.hasFacts ? (
          <dl className="grid gap-x-8 gap-y-5 text-sm sm:grid-cols-2 xl:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Operating System
              </dt>
              <dd className="mt-1">{facts.operatingSystem}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Kernel</dt>
              <dd className="mt-1">{facts.kernelRelease}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Architecture
              </dt>
              <dd className="mt-1">{facts.architecture}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">CPU Cores</dt>
              <dd className="mt-1">{facts.cpuCores}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Memory</dt>
              <dd className="mt-1">{facts.memoryTotal}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Facts Observed
              </dt>
              <dd className="mt-1">{facts.observedAt}</dd>
            </div>
          </dl>
        ) : (
          <div className="text-sm text-muted-foreground">
            No host facts have been collected for this server yet.
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h3 className={detailSectionTitleClassName}>Cloud Provider</h3>
        <dl className="grid gap-x-8 gap-y-5 text-sm sm:grid-cols-2 xl:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Provider</dt>
            <dd className="mt-1">{cloudProviderName}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Region</dt>
            <dd className="mt-1">{cloudProviderRegion}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Zone</dt>
            <dd className="mt-1">{cloudProviderZone}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Source</dt>
            <dd className="mt-1">{cloudProviderSource}</dd>
          </div>
        </dl>
      </section>
    </div>
  )
}
