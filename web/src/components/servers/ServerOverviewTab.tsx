import { Loader2, Pencil, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

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

type Translate = (key: string, options?: Record<string, unknown>) => string

function firstStringValue(
  item: ServerReadModelItem,
  key: string,
  fallback = 'Unavailable'
): string {
  const value = item[key]
  if (typeof value === 'string' && value.trim()) return value.trim()
  return fallback
}

function formatCloudSourceLabel(value: string, t: Translate): string {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'unavailable') return value
  if (normalized === 'cloud-init') return t('servers.overview.cloudSources.cloudInit')
  if (normalized === 'metadata') return t('servers.overview.cloudSources.metadata')
  if (normalized === 'manual') return t('servers.overview.cloudSources.manual')
  return value
}

function formatCredentialTypeLabel(value: string, t: Translate): string {
  const normalized = value.trim().toLowerCase()
  if (!normalized || normalized === '—') return '—'
  if (normalized.includes('password')) return t('servers.overview.credentialTypes.password')
  if (normalized.includes('ssh') || normalized.includes('key')) {
    return t('servers.overview.credentialTypes.sshKey')
  }
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
  const { t } = useTranslation('resources')
  const unavailable = t('servers.overview.fallback.unavailable')
  const cloudProviderName = firstStringValue(item, 'cloud_provider_name', unavailable)
  const cloudProviderRegion = firstStringValue(item, 'cloud_region', unavailable)
  const cloudProviderZone = firstStringValue(item, 'cloud_zone', unavailable)
  const cloudProviderSource = formatCloudSourceLabel(
    firstStringValue(item, 'cloud_provider_source', unavailable),
    t
  )
  const createdAt = formatTimestamp(item.created)
  const updatedAt = formatTimestamp(item.updated)
  const createdByLabel = createdBy.trim() || '—'
  const credentialTypeLabel = formatCredentialTypeLabel(credentialType, t)

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className={detailSectionTitleClassName}>{t('servers.overview.sections.metadata')}</h3>
          <div className="flex items-center gap-2">
            {onRefresh ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="shrink-0"
                onClick={() => void onRefresh()}
                disabled={refreshLoading}
                aria-label={t('servers.overview.actions.refresh')}
                title={t('servers.overview.actions.refresh')}
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
                {t('servers.overview.actions.edit')}
              </Button>
            ) : null}
          </div>
        </div>
        <dl className="grid gap-x-8 gap-y-5 text-sm sm:grid-cols-2 xl:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('servers.overview.fields.id')}
            </dt>
            <dd className="mt-1 break-all font-mono text-xs">{serverId || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('servers.overview.fields.name')}
            </dt>
            <dd className="mt-1 break-all">{String(item.name || '—')}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('servers.overview.fields.connectionType')}
            </dt>
            <dd className="mt-1">
              <Badge variant="outline">
                {isTunnel
                  ? t('servers.connection.tunnelShort')
                  : t('servers.overview.connection.direct')}
              </Badge>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('servers.overview.fields.host')}
            </dt>
            <dd className="mt-1 break-all font-mono text-xs">{String(item.host || '—')}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('servers.overview.fields.port')}
            </dt>
            <dd className="mt-1">{String(item.port || '22')}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('servers.overview.fields.user')}
            </dt>
            <dd className="mt-1">{String(item.user || 'root')}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('servers.overview.fields.access')}
            </dt>
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
                {t('servers.overview.fields.tunnelState')}
              </dt>
              <dd className="mt-1">
                <Badge variant="outline">{tunnelStateLabel(tunnelState)}</Badge>
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('servers.overview.fields.credentialType')}
            </dt>
            <dd className="mt-1">
              {credentialTypeLabel === '—' ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <Badge variant="secondary">{credentialTypeLabel}</Badge>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('servers.overview.fields.createdBy')}
            </dt>
            <dd className="mt-1">{createdByLabel}</dd>
          </div>
          {item.description ? (
            <div className="sm:col-span-2 xl:col-span-3">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                {t('servers.overview.fields.description')}
              </dt>
              <dd className="mt-1 text-muted-foreground">{String(item.description)}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('servers.overview.fields.created')}
            </dt>
            <dd className="mt-1">{createdAt}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('servers.overview.fields.updated')}
            </dt>
            <dd className="mt-1">{updatedAt}</dd>
          </div>
        </dl>
      </section>

      <section className="space-y-4">
        <h3 className={detailSectionTitleClassName}>
          {t('servers.overview.sections.systemInformation')}
        </h3>
        {facts.hasFacts ? (
          <dl className="grid gap-x-8 gap-y-5 text-sm sm:grid-cols-2 xl:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                {t('servers.overview.fields.operatingSystem')}
              </dt>
              <dd className="mt-1">{facts.operatingSystem}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                {t('servers.overview.fields.kernel')}
              </dt>
              <dd className="mt-1">{facts.kernelRelease}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                {t('servers.overview.fields.architecture')}
              </dt>
              <dd className="mt-1">{facts.architecture}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                {t('servers.overview.fields.cpuCores')}
              </dt>
              <dd className="mt-1">{facts.cpuCores}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                {t('servers.overview.fields.memory')}
              </dt>
              <dd className="mt-1">{facts.memoryTotal}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                {t('servers.overview.fields.factsObserved')}
              </dt>
              <dd className="mt-1">{facts.observedAt}</dd>
            </div>
          </dl>
        ) : (
          <div className="text-sm text-muted-foreground">{t('servers.overview.empty.noFacts')}</div>
        )}
      </section>

      <section className="space-y-4">
        <h3 className={detailSectionTitleClassName}>
          {t('servers.overview.sections.cloudProvider')}
        </h3>
        <dl className="grid gap-x-8 gap-y-5 text-sm sm:grid-cols-2 xl:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('servers.overview.fields.provider')}
            </dt>
            <dd className="mt-1">{cloudProviderName}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('servers.overview.fields.region')}
            </dt>
            <dd className="mt-1">{cloudProviderRegion}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('servers.overview.fields.zone')}
            </dt>
            <dd className="mt-1">{cloudProviderZone}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t('servers.overview.fields.source')}
            </dt>
            <dd className="mt-1">{cloudProviderSource}</dd>
          </div>
        </dl>
      </section>
    </div>
  )
}
