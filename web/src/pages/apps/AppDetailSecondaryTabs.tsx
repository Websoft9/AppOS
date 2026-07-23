import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  Boxes,
  ExternalLink,
  FolderOpen,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  TerminalSquare,
} from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { TabsContent } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { MonitorTargetPanel } from '@/components/monitor/MonitorTargetPanel'
import { statusVariant } from '@/pages/deploy/actions/action-utils'
import { formatBytesCompact, getActionLabel, summarizePorts } from '@/pages/apps/app-detail-utils'
import {
  formatEffectiveHealthLabel,
  formatEffectiveRuntimeLabel,
  formatServerConnectionLabel,
  formatTime,
  getServerConnectionReason,
  hasBlockingServerConnectionIssue,
} from '@/pages/apps/types'
import type {
  ComposeTabProps,
  DataTabProps,
  ObservabilityTabProps,
  RuntimeTabProps,
} from '@/pages/apps/AppDetailTabPanelTypes'

function ServerRuntimeUnavailableAlert({
  app,
}: {
  app: {
    server_id: string
    server_connection_status?: string
    server_connection_reason?: string
    runtime_reason?: string
  }
}) {
  if (!hasBlockingServerConnectionIssue(app)) return null
  const reason = getServerConnectionReason(app)
  return (
    <Alert variant="destructive">
      <AlertDescription>
        {formatServerConnectionLabel(app.server_connection_status)}
        {reason ? ` · ${reason}` : ''}
      </AlertDescription>
    </Alert>
  )
}

export function AppDetailRuntimeTab({
  app,
  runtimeSummary,
  runtimeLoading,
  runtimeLoaded,
  relatedRuntimeContainers,
  runtimeStats,
  canOpenServerWorkspace,
  openRuntimeContainerLogs,
  openServerWorkspace,
  projectNameCandidates,
  setTab,
}: RuntimeTabProps) {
  const { t } = useTranslation('apps')
  const serverConnectionBlocked = hasBlockingServerConnectionIssue(app)
  const serverConnectionReason = getServerConnectionReason(app)
  return (
    <TabsContent value="runtime" className="space-y-2.5">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>{t('detail.runtime.summaryTitle')}</CardTitle>
          <CardDescription>{t('detail.runtime.summaryDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ServerRuntimeUnavailableAlert app={app} />
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl bg-muted/20 p-3">
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('detail.runtime.matchedContainers')}
              </div>
              <div className="mt-1 text-xl font-semibold">
                {serverConnectionBlocked ? '-' : runtimeSummary.total}
              </div>
            </div>
            <div className="rounded-2xl bg-muted/20 p-3">
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('detail.runtime.running')}
              </div>
              <div className="mt-1 text-xl font-semibold">
                {serverConnectionBlocked ? '-' : runtimeSummary.running}
              </div>
            </div>
            <div className="rounded-2xl bg-muted/20 p-3">
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('detail.runtime.totalCpu')}
              </div>
              <div className="mt-1 text-xl font-semibold">
                {serverConnectionBlocked
                  ? '-'
                  : `${runtimeSummary.cpu.toFixed(runtimeSummary.cpu >= 10 ? 0 : 1)}%`}
              </div>
            </div>
            <div className="rounded-2xl bg-muted/20 p-3">
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('detail.runtime.memoryUsed')}
              </div>
              <div className="mt-1 text-xl font-semibold">
                {serverConnectionBlocked ? '-' : formatBytesCompact(runtimeSummary.memory)}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              {t('detail.runtime.serverProject', {
                server: app.server_name?.trim() || app.server_id || t('labels.serverLocal'),
              })}
            </span>
            <span>{t('detail.runtime.projectDirectory', { path: app.project_dir })}</span>
            {projectNameCandidates.length > 0 ? (
              <span>
                {t('detail.runtime.matchedBy', { value: projectNameCandidates.join(', ') })}
              </span>
            ) : null}
          </div>
          {runtimeLoading && !runtimeLoaded ? (
            <div className="rounded-2xl border p-4 text-sm text-muted-foreground">
              {t('loading.runtime')}
            </div>
          ) : !serverConnectionBlocked && relatedRuntimeContainers.length > 0 ? (
            <Table containerClassName="rounded-xl border">
              <TableHeader>
                <TableRow>
                  <TableHead>{t('labels.name')}</TableHead>
                  <TableHead>{t('detail.runtime.containerState')}</TableHead>
                  <TableHead>{t('detail.runtime.image')}</TableHead>
                  <TableHead>{t('detail.runtime.cpu')}</TableHead>
                  <TableHead>{t('detail.runtime.memory')}</TableHead>
                  <TableHead>{t('detail.runtime.ports')}</TableHead>
                  <TableHead className="text-right">{t('detail.data.action')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {relatedRuntimeContainers.map(container => (
                  <TableRow key={container.ID}>
                    <TableCell>
                      <div className="font-medium">{container.Names || container.ID}</div>
                      <div className="font-mono text-xs text-muted-foreground">{container.ID}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={container.State === 'running' ? 'default' : 'outline'}>
                        {container.State || container.Status || '-'}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[260px] truncate">
                      {container.Image || '-'}
                    </TableCell>
                    <TableCell>{runtimeStats[container.ID]?.CPUPerc || '-'}</TableCell>
                    <TableCell>
                      {runtimeStats[container.ID]?.MemUsage?.split('/')[0]?.trim() || '-'}
                    </TableCell>
                    <TableCell className="max-w-[280px] whitespace-normal text-xs text-muted-foreground">
                      {summarizePorts(container.Ports)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openRuntimeContainerLogs(container)}
                        >
                          {t('detail.runtime.logs')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openServerWorkspace()}
                          disabled={!canOpenServerWorkspace}
                        >
                          {t('detail.runtime.exec')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            openServerWorkspace({
                              panel: 'files',
                              path: app.project_dir || '/',
                              lockedRoot: app.project_dir || '/',
                            })
                          }
                          disabled={!canOpenServerWorkspace || !app.project_dir}
                        >
                          {t('detail.runtime.files')}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
              {serverConnectionBlocked
                ? serverConnectionReason || t('detail.runtime.unavailableInventory')
                : t('detail.runtime.noContainers')}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2.5">
          <CardTitle>{t('detail.runtime.nextStepTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm text-muted-foreground">
          <p>{t('detail.runtime.nextStepDescription')}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setTab('observability')}>
              {t('detail.secondary.openObservability')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setTab('compose')}>
              {t('detail.secondary.openCompose')}
            </Button>
            {canOpenServerWorkspace ? (
              <Button variant="outline" size="sm" onClick={() => openServerWorkspace()}>
                <TerminalSquare className="mr-2 h-4 w-4" />
                {t('detail.secondary.openServerWorkspace')}
              </Button>
            ) : null}
            <Button variant="outline" size="sm" asChild>
              <Link
                to="/docker"
                search={{
                  server: app.server_id && app.server_id !== 'local' ? app.server_id : undefined,
                }}
              >
                <Boxes className="mr-2 h-4 w-4" />
                {t('detail.secondary.openDockerWorkspace')}
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </TabsContent>
  )
}

export function AppDetailComposeTab({
  app,
  configLoading,
  fetchConfig,
  validating,
  validateDraft,
  rollingBack,
  rollbackConfig,
  rollbackMeta,
  openIacWindow,
  saveDisabled,
  saving,
  saveConfig,
  configText,
  setConfigText,
  validation,
  envFilePath,
  envFileLoading,
  fetchEnvFile,
  hasEnvFileChanges,
  envFileSaving,
  saveEnvFile,
  envFileLoaded,
  envFileError,
  envFileText,
  setEnvFileText,
  diffText,
}: ComposeTabProps) {
  const { t } = useTranslation('apps')
  return (
    <TabsContent value="compose" className="space-y-2.5">
      <Card>
        <CardHeader className="pb-2.5">
          <CardTitle>{t('detail.compose.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ServerRuntimeUnavailableAlert app={app} />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => fetchConfig(true)} disabled={configLoading}>
              {configLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              {t('detail.compose.reload')}
            </Button>
            <Button
              variant="outline"
              onClick={validateDraft}
              disabled={validating || !configText.trim()}
            >
              {validating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="mr-2 h-4 w-4" />
              )}
              {t('detail.compose.validateDraft')}
            </Button>
            <Button
              variant="outline"
              onClick={rollbackConfig}
              disabled={rollingBack || !rollbackMeta.available}
            >
              {rollingBack ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="mr-2 h-4 w-4" />
              )}
              {t('detail.compose.rollback')}
            </Button>
            {app.iac_path ? (
              <Button variant="outline" onClick={openIacWindow}>
                <ExternalLink className="mr-2 h-4 w-4" />
                {t('detail.compose.openInIac')}
              </Button>
            ) : null}
            <Button onClick={saveConfig} disabled={saveDisabled}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {t('common:save')}
            </Button>
          </div>
          <div className="grid gap-2 text-sm md:grid-cols-2">
            <div>
              <span className="text-muted-foreground">{t('detail.compose.iacPath')}</span>{' '}
              <span className="font-mono text-xs">{app.iac_path || '-'}</span>
            </div>
            <div>
              <span className="text-muted-foreground">{t('detail.compose.projectDir')}</span>{' '}
              <span className="break-all">{app.project_dir}</span>
            </div>
          </div>
          {rollbackMeta.available ? (
            <p className="text-xs text-muted-foreground">
              {t('detail.compose.rollbackPointAvailable', {
                savedAt: rollbackMeta.savedAt
                  ? t('detail.compose.savedAt', { time: formatTime(rollbackMeta.savedAt) })
                  : '',
                sourceAction: rollbackMeta.sourceAction
                  ? t('detail.compose.sourceAction', { value: rollbackMeta.sourceAction })
                  : '',
              })}
            </p>
          ) : null}
          {validation ? (
            <Alert variant={validation.valid ? 'default' : 'destructive'}>
              <AlertDescription>{validation.message}</AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <AlertDescription>{t('detail.compose.validateBeforeSave')}</AlertDescription>
            </Alert>
          )}
          <Textarea
            className="min-h-[360px] font-mono text-xs"
            value={configText}
            onChange={event => setConfigText(event.target.value)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2.5">
          <CardTitle>{t('detail.compose.environmentFileTitle')}</CardTitle>
          <CardDescription>{t('detail.compose.environmentFileDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => envFilePath && fetchEnvFile(envFilePath)}
              disabled={!envFilePath || envFileLoading}
            >
              {envFileLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              {t('detail.compose.reloadEnv')}
            </Button>
            <Button
              onClick={() => envFilePath && saveEnvFile(envFilePath)}
              disabled={!envFilePath || !hasEnvFileChanges || envFileSaving}
            >
              {envFileSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {t('detail.compose.saveEnv')}
            </Button>
          </div>
          <div className="grid gap-2 text-sm md:grid-cols-2">
            <div>
              <span className="text-muted-foreground">{t('detail.compose.envPath')}</span>{' '}
              <span className="font-mono text-xs">{envFilePath || '-'}</span>
            </div>
            <div>
              <span className="text-muted-foreground">{t('detail.compose.envStatus')}</span>{' '}
              {envFileLoaded
                ? t('detail.compose.envLoaded')
                : envFileLoading
                  ? t('detail.compose.envLoading')
                  : t('detail.compose.envNotLoaded')}
            </div>
          </div>
          {envFileError ? (
            <Alert variant="destructive">
              <AlertDescription>{envFileError}</AlertDescription>
            </Alert>
          ) : null}
          {!envFilePath ? (
            <Alert>
              <AlertDescription>{t('detail.compose.envUnavailable')}</AlertDescription>
            </Alert>
          ) : null}
          <Textarea
            className="min-h-[180px] font-mono text-xs"
            value={envFileText}
            onChange={event => setEnvFileText(event.target.value)}
            placeholder={t('detail.compose.envPlaceholder')}
            disabled={!envFilePath || envFileLoading}
          />
        </CardContent>
      </Card>

      {diffText ? (
        <Card>
          <CardHeader className="pb-2.5">
            <CardTitle>{t('detail.compose.draftDiff')}</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-[220px] overflow-auto rounded-xl border bg-muted/20 p-4 font-mono text-xs leading-5">
              {diffText}
            </pre>
          </CardContent>
        </Card>
      ) : null}
    </TabsContent>
  )
}

export function AppDetailObservabilityTab({
  app,
  logsLoading,
  fetchLogs,
  runtimeLoaded,
  runtimeSummary,
  latestScopedAction,
  primaryExposure,
  logs,
  logViewportRef,
  stickToBottomRef,
}: ObservabilityTabProps) {
  const { t } = useTranslation('apps')
  const serverConnectionBlocked = hasBlockingServerConnectionIssue(app)
  const serverConnectionReason = getServerConnectionReason(app)
  const runtimeValue = formatEffectiveRuntimeLabel(app)
  const healthValue = formatEffectiveHealthLabel(app)
  return (
    <TabsContent value="observability" className="space-y-2.5">
      <div className="grid gap-2.5 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2.5">
            <CardTitle>{t('detail.observability.metricsTitle')}</CardTitle>
            <Button variant="outline" onClick={() => fetchLogs(true)} disabled={logsLoading}>
              {logsLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              {t('common:refresh')}
            </Button>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ServerRuntimeUnavailableAlert app={app} />
            <div className="grid gap-2 md:grid-cols-2">
              <div className="rounded-xl border p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {t('detail.observability.runtimeContainers')}
                </div>
                <div className="mt-1 text-xl font-semibold">
                  {serverConnectionBlocked
                    ? '-'
                    : runtimeLoaded
                      ? `${runtimeSummary.running} / ${runtimeSummary.total}`
                      : '-'}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t('detail.observability.runningTotal')}
                </div>
              </div>
              <div className="rounded-xl border p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {t('detail.observability.combinedResourceUse')}
                </div>
                <div className="mt-1 text-sm font-medium">
                  {t('detail.runtime.cpu')}{' '}
                  {serverConnectionBlocked
                    ? '-'
                    : runtimeLoaded
                      ? `${runtimeSummary.cpu.toFixed(1)}%`
                      : '-'}
                </div>
                <div className="text-sm text-muted-foreground">
                  {t('detail.runtime.memory')}{' '}
                  {serverConnectionBlocked
                    ? '-'
                    : runtimeLoaded
                      ? formatBytesCompact(runtimeSummary.memory)
                      : '-'}
                </div>
              </div>
            </div>
            <div className="rounded-xl border p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {t('detail.observability.latestLifecycleExecution')}
              </div>
              {latestScopedAction ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
                  <span className="font-medium">{getActionLabel(latestScopedAction)}</span>
                  <Badge variant={statusVariant(latestScopedAction.status)}>
                    {latestScopedAction.status}
                  </Badge>
                  <span className="text-muted-foreground">
                    {formatTime(latestScopedAction.updated || latestScopedAction.created)}
                  </span>
                </div>
              ) : (
                <div className="mt-1.5 text-muted-foreground">
                  {t('detail.observability.noScopedActions')}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2.5">
            <CardTitle>{t('detail.observability.signalsTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            <ServerRuntimeUnavailableAlert app={app} />
            <div className="grid gap-2 md:grid-cols-2">
              <div>
                <span className="text-muted-foreground">
                  {t('detail.observability.containerRuntime')}
                </span>{' '}
                {runtimeValue}
              </div>
              <div>
                <span className="text-muted-foreground">{t('detail.observability.health')}</span>{' '}
                {healthValue}
              </div>
              <div>
                <span className="text-muted-foreground">
                  {t('detail.observability.stateReason')}
                </span>{' '}
                {app.state_reason || app.runtime_reason || '-'}
              </div>
              <div>
                <span className="text-muted-foreground">
                  {t('detail.observability.lastProjectedRuntime')}
                </span>{' '}
                {app.runtime_status || '-'}
              </div>
              <div>
                <span className="text-muted-foreground">
                  {t('detail.observability.lastProjectedAppState')}
                </span>{' '}
                {app.instance_state || '-'}
              </div>
              <div>
                <span className="text-muted-foreground">
                  {t('detail.observability.healthSummary')}
                </span>{' '}
                {serverConnectionBlocked ? t('states.unavailable') : app.health_summary || '-'}
              </div>
              <div>
                <span className="text-muted-foreground">
                  {t('detail.observability.publication')}
                </span>{' '}
                {app.publication_summary || '-'}
              </div>
              <div>
                <span className="text-muted-foreground">
                  {t('detail.observability.primaryExposureHealth')}
                </span>{' '}
                {primaryExposure?.health_state || '-'}
              </div>
              <div>
                <span className="text-muted-foreground">
                  {t('detail.observability.serverConnection')}
                </span>{' '}
                {serverConnectionBlocked
                  ? `${formatServerConnectionLabel(app.server_connection_status)}${serverConnectionReason ? ` · ${serverConnectionReason}` : ''}`
                  : t('detail.observability.online')}
              </div>
              <div>
                <span className="text-muted-foreground">
                  {t('detail.observability.lastExposureVerification')}
                </span>{' '}
                {formatTime(primaryExposure?.last_verified_at)}
              </div>
            </div>
            <div className="rounded-xl border bg-muted/20 px-3 py-2 text-muted-foreground">
              {t('detail.observability.heartbeat')}
            </div>
            {app.runtime_reason ? (
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                {app.runtime_reason}
              </div>
            ) : null}

            <div className="pt-2">
              <MonitorTargetPanel
                targetType="app"
                targetId={app.id}
                emptyMessage={t('detail.observability.monitorEmpty', {
                  name: app.name,
                  status: runtimeValue.toLowerCase() || t('states.unknown').toLowerCase(),
                })}
              />
            </div>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader className="pb-2.5">
          <CardTitle>{t('detail.observability.logsTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            ref={logViewportRef}
            className="h-[380px] overflow-auto rounded-xl bg-black px-4 py-3 font-mono text-[11px] leading-5 text-slate-100"
            onScroll={event => {
              const target = event.currentTarget
              stickToBottomRef.current =
                target.scrollHeight - target.scrollTop - target.clientHeight < 32
            }}
          >
            <pre
              className={cn('whitespace-pre-wrap break-words', !logs?.output && 'text-slate-500')}
            >
              {logs?.output || t('detail.observability.noLogs')}
            </pre>
          </div>
        </CardContent>
      </Card>
    </TabsContent>
  )
}

export function AppDetailDataTab({
  app,
  dataError,
  dataLoading,
  dataLoaded,
  matchedInstanceResources,
  matchedDataVolumes,
  backupProjection,
  mountProjectionLoading,
  containerMountRows,
  canOpenServerWorkspace,
  openServerWorkspace,
}: DataTabProps) {
  const { t } = useTranslation('apps')
  const serverConnectionBlocked = hasBlockingServerConnectionIssue(app)
  const serverConnectionReason = getServerConnectionReason(app)
  return (
    <TabsContent value="data" className="space-y-2.5">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>{t('detail.data.connectedDataTitle')}</CardTitle>
          <CardDescription>{t('detail.data.connectedDataDescription')}</CardDescription>
          <CardAction>
            <Button variant="outline" size="sm" asChild>
              <Link to="/resources/service-instances" search={{ create: undefined }}>
                {t('actions.openServiceInstances')}
              </Link>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-3">
          <ServerRuntimeUnavailableAlert app={app} />
          {dataError ? (
            <Alert variant="destructive">
              <AlertDescription>{dataError}</AlertDescription>
            </Alert>
          ) : null}
          {dataLoading && !dataLoaded ? (
            <div className="rounded-2xl border p-4 text-sm text-muted-foreground">
              {t('loading.data')}
            </div>
          ) : !serverConnectionBlocked && matchedInstanceResources.length > 0 ? (
            <Table containerClassName="rounded-xl border">
              <TableHeader>
                <TableRow>
                  <TableHead>{t('labels.name')}</TableHead>
                  <TableHead>{t('detail.data.kind')}</TableHead>
                  <TableHead>{t('detail.data.profile')}</TableHead>
                  <TableHead>{t('detail.data.endpoint')}</TableHead>
                  <TableHead>{t('detail.data.summary')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {matchedInstanceResources.map(instance => (
                  <TableRow key={instance.id}>
                    <TableCell className="font-medium">{instance.name || '-'}</TableCell>
                    <TableCell>{instance.kind || '-'}</TableCell>
                    <TableCell>{instance.template_id || '-'}</TableCell>
                    <TableCell>{instance.endpoint || '-'}</TableCell>
                    <TableCell>{instance.summary || '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
              {serverConnectionBlocked
                ? serverConnectionReason || t('detail.data.serverDataUnavailable')
                : t('detail.data.noDataMatch')}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>{t('detail.data.volumesTitle')}</CardTitle>
          <CardDescription>{t('detail.data.volumesDescription')}</CardDescription>
          <CardAction>
            <Button variant="outline" size="sm" asChild>
              <Link
                to="/docker"
                search={{
                  server: app.server_id && app.server_id !== 'local' ? app.server_id : undefined,
                }}
              >
                {t('actions.openDockerWorkspace')}
              </Link>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-3">
          {dataLoading && !dataLoaded ? (
            <div className="rounded-2xl border p-4 text-sm text-muted-foreground">
              {t('loading.volumes')}
            </div>
          ) : !serverConnectionBlocked && matchedDataVolumes.length > 0 ? (
            <Table containerClassName="rounded-xl border">
              <TableHeader>
                <TableRow>
                  <TableHead>{t('detail.data.volume')}</TableHead>
                  <TableHead>{t('detail.data.driver')}</TableHead>
                  <TableHead>{t('detail.data.mountpoint')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {matchedDataVolumes.map(volume => (
                  <TableRow key={volume.Name}>
                    <TableCell className="font-medium">{volume.Name}</TableCell>
                    <TableCell>{volume.Driver || '-'}</TableCell>
                    <TableCell className="max-w-[420px] truncate">
                      {volume.Mountpoint || '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
              {serverConnectionBlocked
                ? serverConnectionReason || t('detail.data.volumeUnavailable')
                : t('detail.data.noVolumeMatch')}
            </div>
          )}

          <Alert variant={backupProjection.status === 'error' ? 'destructive' : 'default'}>
            <AlertDescription>{backupProjection.message}</AlertDescription>
          </Alert>

          {backupProjection.status === 'available' && backupProjection.items.length > 0 ? (
            <Table containerClassName="rounded-xl border">
              <TableHeader>
                <TableRow>
                  <TableHead>{t('detail.data.snapshot')}</TableHead>
                  <TableHead>{t('detail.data.size')}</TableHead>
                  <TableHead>{t('labels.updated')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {backupProjection.items.map(item => (
                  <TableRow key={`${item.name}-${item.updatedAt}`}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>{item.size || '-'}</TableCell>
                    <TableCell>{formatTime(item.updatedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>{t('detail.data.containerMountsTitle')}</CardTitle>
          <CardDescription>{t('detail.data.containerMountsDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {mountProjectionLoading ? (
            <div className="rounded-2xl border p-4 text-sm text-muted-foreground">
              {t('loading.mounts')}
            </div>
          ) : !serverConnectionBlocked && containerMountRows.length > 0 ? (
            <Table containerClassName="rounded-xl border">
              <TableHeader>
                <TableRow>
                  <TableHead>{t('detail.data.container')}</TableHead>
                  <TableHead>{t('detail.data.type')}</TableHead>
                  <TableHead>{t('detail.data.source')}</TableHead>
                  <TableHead>{t('detail.data.destination')}</TableHead>
                  <TableHead>{t('detail.data.mode')}</TableHead>
                  <TableHead className="text-right">{t('detail.data.action')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {containerMountRows.map(mount => (
                  <TableRow key={mount.id}>
                    <TableCell className="font-medium">{mount.containerName}</TableCell>
                    <TableCell>{mount.type}</TableCell>
                    <TableCell className="max-w-[320px] truncate">{mount.source}</TableCell>
                    <TableCell className="max-w-[280px] truncate">{mount.destination}</TableCell>
                    <TableCell>
                      {mount.writable ? t('detail.data.rw') : t('detail.data.ro')}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          openServerWorkspace({
                            panel: 'files',
                            path: mount.source,
                            lockedRoot: mount.source,
                          })
                        }
                        disabled={!canOpenServerWorkspace || mount.source === '-'}
                      >
                        <FolderOpen className="mr-2 h-4 w-4" />
                        {t('detail.runtime.files')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
              {serverConnectionBlocked
                ? serverConnectionReason || t('detail.data.mountUnavailable')
                : t('detail.data.noMounts')}
            </div>
          )}
        </CardContent>
      </Card>
    </TabsContent>
  )
}
