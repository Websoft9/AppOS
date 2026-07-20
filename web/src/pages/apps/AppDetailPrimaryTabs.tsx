import { Link } from '@tanstack/react-router'
import { ChevronRight, ExternalLink, Loader2, RefreshCw, Search } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TabsContent } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { AppDetailActionHistoryTable } from '@/pages/apps/AppDetailActionHistoryTable'
import {
  displayValue,
  formatActionType,
  parseReleaseAttribution,
} from '@/pages/apps/app-detail-utils'
import {
  formatEffectiveHealthLabel,
  formatEffectiveRuntimeLabel,
  formatServerConnectionLabel,
  formatTime,
  formatUptime,
  getServerConnectionReason,
  hasBlockingServerConnectionIssue,
  normalizeServerConnectionStatus,
} from '@/pages/apps/types'
import {
  actionStatusLabel,
  formatDurationCompact,
  statusVariant,
} from '@/pages/deploy/actions/action-utils'
import type {
  AccessTabProps,
  ActionsTabProps,
  OverviewTabProps,
} from '@/pages/apps/AppDetailTabPanelTypes'

const ACTION_NAME_MAP: Record<string, string> = {
  install: 'Install',
  upgrade: 'Upgrade',
  uninstall: 'Uninstall',
  start: 'Start',
  stop: 'Stop',
  restart: 'Restart',
  redeploy: 'Redeploy',
  rollback: 'Rollback',
}

function actionNameFromKey(key: string): string {
  for (const [verb, label] of Object.entries(ACTION_NAME_MAP)) {
    if (key.includes(`.${verb}.`) || key.includes(`.${verb}`) || key === verb) return label
  }
  const parts = key.split('.')
  const candidate = parts.length >= 2 ? parts[1] : parts[0]
  return candidate.charAt(0).toUpperCase() + candidate.slice(1)
}

export function AppDetailOverviewTab({
  app,
  serverDisplayName,
  serverDetailHref,
  primaryExposure,
  primaryAccessUrl,
  deploymentLabel,
  templateName,
  templateDetailHref,
  actionDetailHref,
  setTab,
  recentActivity,
  recentActivityLoading,
}: OverviewTabProps) {
  const accessValue = primaryAccessUrl || '-'
  const operationLabel = app.current_pipeline?.selector?.operation_type
    ? formatActionType(app.current_pipeline.selector.operation_type)
    : app.last_operation
      ? `Action ${app.last_operation}`
      : '-'
  const operationState = [app.current_pipeline?.status, app.current_pipeline?.current_phase]
    .filter(Boolean)
    .join(' · ')
  const normalizedInstanceState = (app.instance_state || '').toLowerCase()
  const normalizedServerConnectionStatus = normalizeServerConnectionStatus(
    app.server_connection_status
  )
  const serverConnectionBlocked = hasBlockingServerConnectionIssue(app)
  const serverConnectionReason = getServerConnectionReason(app)
  const lastOperationValue =
    operationLabel === '-'
      ? '-'
      : operationState
        ? `${operationLabel} · ${operationState}`
        : operationLabel
  const healthValue = formatEffectiveHealthLabel(app)
  const runtimeValue = formatEffectiveRuntimeLabel(app)
  const stateReasonValue = app.state_reason || app.runtime_reason || '-'
  const publicationValue = app.publication_summary || primaryExposure?.publication_state || '-'
  const serverConnectionValue =
    app.server_id === 'local'
      ? 'Local server'
      : formatServerConnectionLabel(app.server_connection_status)
  const certificateAlert =
    primaryExposure?.domain && !primaryExposure.certificate_id
      ? 'Primary domain does not have a bound certificate.'
      : ''
  let healthAlert = ''
  if (app.server_id !== 'local' && normalizedServerConnectionStatus !== 'online') {
    healthAlert =
      serverConnectionReason ||
      'Application status cannot be verified because server connectivity is unavailable.'
  } else if (normalizedInstanceState === 'attention_required') {
    healthAlert = app.state_reason || app.runtime_reason || 'Manual intervention is required.'
  } else if (normalizedInstanceState === 'unknown') {
    healthAlert =
      app.state_reason || app.runtime_reason || 'Application runtime status is unavailable.'
  } else if (normalizedInstanceState === 'degraded') {
    healthAlert = app.state_reason || app.runtime_reason || 'Application is degraded.'
  } else if (app.runtime_status === 'error') {
    healthAlert = app.runtime_reason || 'Runtime reported an error.'
  } else if (app.current_pipeline?.status === 'failed') {
    healthAlert = 'Latest pipeline failed. Review Activity for details.'
  } else if (app.health_summary && !/healthy|running|available|ok/i.test(app.health_summary)) {
    healthAlert = app.health_summary
  }
  const alertValue = healthAlert || certificateAlert

  const accessNode =
    accessValue !== '-' ? (
      <a
        href={accessValue}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline"
      >
        <span className="break-all">{accessValue}</span>
        <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-70" />
      </a>
    ) : (
      <span className="break-all">{accessValue}</span>
    )

  const lastOperationNode = actionDetailHref ? (
    <a
      href={actionDetailHref}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline"
    >
      <span className="break-all">{lastOperationValue}</span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-70" />
    </a>
  ) : (
    <span className="break-all">{lastOperationValue}</span>
  )

  const serverNode = serverDetailHref ? (
    <a
      href={serverDetailHref}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline"
    >
      <span className="break-all">{serverDisplayName}</span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-70" />
    </a>
  ) : (
    <span className="break-all">{serverDisplayName}</span>
  )

  const deploymentNode = templateName ? (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>{deploymentLabel}</span>
      <span className="text-muted-foreground">·</span>
      {templateDetailHref ? (
        <a
          href={templateDetailHref}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline"
        >
          <span className="break-all">{templateName}</span>
          <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-70" />
        </a>
      ) : (
        <span className="break-all">{templateName}</span>
      )}
    </div>
  ) : (
    <span className="break-all">{deploymentLabel}</span>
  )

  const summaryRows = [
    { label: 'App Name', value: app.name },
    { label: 'App ID', value: app.id, mono: true },
    {
      label: 'Access',
      value: accessNode,
      action: (
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={() => setTab('access')}
          aria-label="Open Access tab"
          title="Open Access"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      ),
    },
    { label: 'Health', value: healthValue },
    {
      label: 'Container runtime',
      value:
        serverConnectionBlocked && serverConnectionReason
          ? `${runtimeValue} · ${serverConnectionReason}`
          : runtimeValue,
    },
    { label: 'State reason', value: stateReasonValue },
    {
      label: 'Uptime',
      value: <span className="font-medium tabular-nums">{formatUptime(app)}</span>,
    },
    { label: 'Publication', value: publicationValue },
    {
      label: 'Server connection',
      value: serverConnectionReason
        ? `${serverConnectionValue} · ${serverConnectionReason}`
        : serverConnectionValue,
    },
    {
      label: 'Server',
      value: serverNode,
    },
    {
      label: 'Deployment',
      value: deploymentNode,
    },
    {
      label: 'Last operation',
      value: lastOperationNode,
    },
  ]

  return (
    <TabsContent value="overview" className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">Overview</h2>
        <p className="text-sm text-muted-foreground">Current status and next steps.</p>
      </div>

      <div className="rounded-2xl border border-border/60 bg-background">
        <div className="space-y-1 p-2.5 md:p-3">
          {summaryRows.map((row, index) => (
            <div
              key={row.label}
              className={`grid gap-2 rounded-lg px-3 py-2.5 text-sm md:grid-cols-[140px_minmax(0,1fr)_auto] md:items-center ${
                index % 2 === 0 ? 'bg-muted/10' : 'bg-transparent'
              }`}
            >
              <div className="text-muted-foreground">{row.label}</div>
              <div className={row.mono ? 'break-all font-mono text-xs' : ''}>{row.value}</div>
              <div className="flex justify-start md:justify-end">{row.action}</div>
            </div>
          ))}
          {alertValue ? (
            <div className="grid gap-2 rounded-lg bg-amber-50/70 px-3 py-2.5 text-sm md:grid-cols-[140px_minmax(0,1fr)] dark:bg-amber-950/20">
              <div className="font-medium text-amber-800 dark:text-amber-300">Alert</div>
              <div className="text-amber-900 dark:text-amber-100">{alertValue}</div>
            </div>
          ) : null}
        </div>
        <div className="border-t border-border/40 px-4 py-4 md:px-6">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium text-muted-foreground">Recent Activity</div>
            <Button variant="ghost" size="sm" onClick={() => setTab('actions')}>
              View all
              <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>
          {recentActivityLoading ? (
            <div className="py-3 text-center text-sm text-muted-foreground">Loading...</div>
          ) : recentActivity.length === 0 ? (
            <div className="py-3 text-center text-sm text-muted-foreground">No activity yet.</div>
          ) : (
            <div className="space-y-1">
              <div className="grid grid-cols-[minmax(56px,1fr)_minmax(64px,2fr)_minmax(72px,1fr)_minmax(88px,1fr)] gap-3 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <div>Status</div>
                <div>Action</div>
                <div>Duration</div>
                <div>When</div>
              </div>
              {recentActivity.map(item => {
                const actionLabel = actionNameFromKey(
                  item.pipeline_definition_key || item.pipeline?.definition_key || ''
                )
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="grid w-full grid-cols-[minmax(56px,1fr)_minmax(64px,2fr)_minmax(72px,1fr)_minmax(88px,1fr)] items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50"
                    onClick={() => setTab('actions')}
                  >
                    <Badge
                      variant={statusVariant(item.status)}
                      className="w-fit shrink-0 text-[10px]"
                    >
                      {actionStatusLabel(item.status)}
                    </Badge>
                    <span className="truncate text-xs">{actionLabel}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDurationCompact(item.started_at, item.finished_at)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatTime(item.started_at || item.created)}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </TabsContent>
  )
}

function ReleaseLineageSection({
  releases,
  openReleaseDetail,
}: {
  releases: ActionsTabProps['releases']
  openReleaseDetail: ActionsTabProps['openReleaseDetail']
}) {
  const releaseLineage = [...releases]
    .sort((left, right) => new Date(right.updated).getTime() - new Date(left.updated).getTime())
    .slice(0, 4)

  return (
    <Card>
      <CardHeader className="pb-2.5">
        <CardTitle>Release Lineage</CardTitle>
        <CardDescription>
          Recent candidate and active releases with source-build attribution.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {releaseLineage.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
            No releases recorded yet.
          </div>
        ) : (
          <div className="space-y-2">
            {releaseLineage.map(release => {
              const attribution = parseReleaseAttribution(release.notes)
              return (
                <div key={release.id} className="rounded-2xl border bg-muted/10 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold">
                      {[release.release_role, release.version_label].filter(Boolean).join(' · ') ||
                        release.id}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-[11px] text-muted-foreground">
                        Updated {formatTime(release.updated)}
                      </div>
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto px-0 text-[11px]"
                        onClick={() => openReleaseDetail(release)}
                      >
                        Open detail
                      </Button>
                    </div>
                  </div>
                  {release.artifact_digest ? (
                    <div className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                      Artifact: {release.artifact_digest}
                    </div>
                  ) : null}
                  {attribution.localImageRef ? (
                    <div className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                      Local image: {attribution.localImageRef}
                    </div>
                  ) : null}
                  {release.source_ref ? (
                    <div className="mt-1 break-all text-[11px] text-muted-foreground">
                      Source: {release.source_ref}
                    </div>
                  ) : null}
                  {attribution.targetService ? (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Target service: {attribution.targetService}
                    </div>
                  ) : null}
                  {release.notes ? (
                    <div className="mt-1 text-xs text-muted-foreground">{release.notes}</div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function AppDetailAccessTab({
  app,
  primaryExposure,
  resolvedTargetPort,
  serverDisplayName,
  canOpenServerDetail,
  openServerDetail,
  serverConnectionPresentation,
  effectiveServerHost,
  primaryDomainUrl,
  publicAccessUrl,
  editingAccess,
  accessHintsPresent,
  accessUsernameDraft,
  accessSecretHintDraft,
  accessRetrievalMethodDraft,
  accessNotesDraft,
  hasAccessDraftChanges,
  accessSaving,
  setEditingAccess,
  setAccessUsernameDraft,
  setAccessSecretHintDraft,
  setAccessRetrievalMethodDraft,
  setAccessNotesDraft,
  saveAccessHints,
  cancelAccessEditing,
}: AccessTabProps) {
  return (
    <TabsContent value="access" className="space-y-2.5">
      <Card>
        <CardHeader className="pb-2.5">
          <CardTitle>Access URLs</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm md:grid-cols-2">
          <div>
            <span className="text-muted-foreground">Primary exposure:</span>{' '}
            {primaryExposure?.domain || primaryExposure?.path || '-'}
          </div>
          <div>
            <span className="text-muted-foreground">Publication summary:</span>{' '}
            {app.publication_summary || '-'}
          </div>
          <div>
            <span className="text-muted-foreground">Server host:</span> {effectiveServerHost || '-'}
          </div>
          <div>
            <span className="text-muted-foreground">Certificate status:</span>{' '}
            {primaryExposure?.certificate_id ? 'bound' : 'not bound'}
          </div>
          <div className="md:col-span-2 flex flex-col gap-1.5">
            <span className="text-muted-foreground">Domain access:</span>
            {primaryDomainUrl ? (
              <a
                href={primaryDomainUrl}
                target="_blank"
                rel="noreferrer"
                className="w-fit text-primary underline-offset-4 hover:underline"
              >
                {primaryDomainUrl}
              </a>
            ) : (
              <span>-</span>
            )}
          </div>
          <div className="md:col-span-2 flex flex-col gap-1.5">
            <span className="text-muted-foreground">Public IP access:</span>
            {publicAccessUrl ? (
              <a
                href={publicAccessUrl}
                target="_blank"
                rel="noreferrer"
                className="w-fit text-primary underline-offset-4 hover:underline"
              >
                {publicAccessUrl}
              </a>
            ) : (
              <span>-</span>
            )}
          </div>
          <div>
            <span className="text-muted-foreground">Target port:</span> {resolvedTargetPort || '-'}
          </div>
          <div>
            <span className="text-muted-foreground">Health state:</span>{' '}
            {primaryExposure?.health_state || '-'}
          </div>
          <div>
            <span className="text-muted-foreground">Last verified:</span>{' '}
            {formatTime(primaryExposure?.last_verified_at)}
          </div>
          <div>
            <span className="text-muted-foreground">Exposure state:</span>{' '}
            {primaryExposure?.publication_state || '-'}
          </div>
          {primaryExposure?.certificate_id ? (
            <div className="md:col-span-2 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link to="/certificates">Open Certificates</Link>
              </Button>
              <span className="text-xs text-muted-foreground">
                Certificate ID: {primaryExposure.certificate_id}
              </span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2.5">
          <CardTitle>Server Connection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <div>
            <span>Server:</span> <span>{serverDisplayName}</span>
          </div>
          <div>Certificate summary: {primaryExposure?.certificate_id ? 'bound' : 'not bound'}</div>
          {serverConnectionPresentation ? (
            <>
              <div className="flex items-center gap-2 text-foreground">
                <span>Connection:</span>
                <Badge
                  variant={
                    serverConnectionPresentation.state === 'online'
                      ? 'default'
                      : serverConnectionPresentation.state === 'paused' ||
                          serverConnectionPresentation.state === 'needs_attention'
                        ? 'secondary'
                        : 'outline'
                  }
                >
                  {serverConnectionPresentation.stateLabel}
                </Badge>
              </div>
              <div>Connection summary: {serverConnectionPresentation.reason}</div>
              <div>Endpoint: {serverConnectionPresentation.endpointSummary}</div>
              <div>Next server step: {serverConnectionPresentation.primaryAction.label}</div>
            </>
          ) : null}
          {canOpenServerDetail ? (
            <Button
              variant="link"
              size="sm"
              className="h-auto w-fit px-0"
              onClick={openServerDetail}
            >
              Open server detail
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b pb-3">
          <CardTitle>Accounts</CardTitle>
          <CardDescription>
            Operator-maintained login hints scoped to this app. This is not secret storage.
          </CardDescription>
          <CardAction>
            {!editingAccess ? (
              <Button variant="outline" size="sm" onClick={() => setEditingAccess(true)}>
                {accessHintsPresent ? 'Edit Account Hints' : 'Add Account Hints'}
              </Button>
            ) : null}
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          {!editingAccess ? (
            accessHintsPresent ? (
              <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1 text-sm">
                    <div className="text-muted-foreground">Default username</div>
                    <div>{displayValue(app.access_username)}</div>
                  </div>
                  <div className="space-y-1 text-sm">
                    <div className="text-muted-foreground">Credential hint</div>
                    <div>{displayValue(app.access_secret_hint)}</div>
                  </div>
                </div>
                <div className="space-y-1 text-sm">
                  <div className="text-muted-foreground">Retrieval method</div>
                  <div className="whitespace-pre-wrap text-sm">
                    {displayValue(app.access_retrieval_method)}
                  </div>
                </div>
                <div className="space-y-1 text-sm">
                  <div className="text-muted-foreground">Operator notes</div>
                  <div className="whitespace-pre-wrap text-sm">
                    {displayValue(app.access_notes)}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
                No account hints saved yet. Add the default username, retrieval steps, and operator
                notes for this app.
              </div>
            )
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground">Default username</div>
                  <Input
                    value={accessUsernameDraft}
                    onChange={event => setAccessUsernameDraft(event.target.value)}
                    placeholder="e.g. admin"
                  />
                </div>
                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground">Credential hint</div>
                  <Input
                    value={accessSecretHintDraft}
                    onChange={event => setAccessSecretHintDraft(event.target.value)}
                    placeholder="e.g. initial password from welcome screen"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">Retrieval method</div>
                <Textarea
                  className="min-h-[96px]"
                  value={accessRetrievalMethodDraft}
                  onChange={event => setAccessRetrievalMethodDraft(event.target.value)}
                  placeholder="Describe how operators retrieve or reset the account credential."
                />
              </div>
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">Operator notes</div>
                <Textarea
                  className="min-h-[96px]"
                  value={accessNotesDraft}
                  onChange={event => setAccessNotesDraft(event.target.value)}
                  placeholder="Add app-scoped account notes, first login warnings, or rotation guidance."
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={saveAccessHints} disabled={!hasAccessDraftChanges || accessSaving}>
                  {accessSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Save Account Hints
                </Button>
                <Button variant="outline" onClick={cancelAccessEditing} disabled={accessSaving}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </TabsContent>
  )
}

export function AppDetailActionsTab({
  app,
  releases,
  openReleaseDetail,
  actionsLoading,
  actionSearch,
  setActionSearch,
  actionHistoryPage,
  actionHistoryTotalPages,
  actionHistoryTotalItems,
  goToPreviousActionHistoryPage,
  goToNextActionHistoryPage,
  actionStatusFilter,
  setActionStatusFilter,
  actionTypeFilter,
  setActionTypeFilter,
  actionStatusOptions,
  actionTypeOptions,
  scopedActions,
  filteredScopedActions,
  fetchActionHistory,
  openAllActionsForApp,
  openOperationStatus,
  buildActionDetailHref,
  onRequestCancelAction,
  onRequestForceFailAction,
  onRequestResumeAction,
}: ActionsTabProps) {
  return (
    <TabsContent value="actions" className="space-y-2.5">
      <Card>
        <CardHeader className="pb-2.5">
          <CardTitle>Current State</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm md:grid-cols-2 xl:grid-cols-4">
          <div>
            <span className="text-muted-foreground">Last operation:</span>{' '}
            {app.last_operation || '-'}
          </div>
          <div>
            <span className="text-muted-foreground">Current pipeline:</span>{' '}
            {app.current_pipeline?.family || '-'}
          </div>
          <div>
            <span className="text-muted-foreground">Current phase:</span>{' '}
            {app.current_pipeline?.current_phase || '-'}
          </div>
          <div>
            <span className="text-muted-foreground">Source:</span>{' '}
            {app.source || app.current_pipeline?.selector?.source || '-'}
          </div>
          <div>
            <span className="text-muted-foreground">Pipeline status:</span>{' '}
            {app.current_pipeline?.status || '-'}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b pb-3">
          <CardTitle>Activity</CardTitle>
          <CardDescription>
            App-scoped activity records pulled from the shared Activity subsystem.
          </CardDescription>
          <CardAction>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={fetchActionHistory}
                disabled={actionsLoading}
              >
                {actionsLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Refresh
              </Button>
              <Button variant="outline" size="sm" onClick={openAllActionsForApp}>
                Open in Activity
              </Button>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-2.5 pt-4">
          <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_170px_170px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={actionSearch}
                onChange={event => setActionSearch(event.target.value)}
                placeholder="Search this app's activity"
                className="pl-9"
              />
            </div>
            <Select value={actionStatusFilter} onValueChange={setActionStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {actionStatusOptions.map(option => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={actionTypeFilter} onValueChange={setActionTypeFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All action types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All action types</SelectItem>
                {actionTypeOptions.map(option => (
                  <SelectItem key={option} value={option}>
                    {formatActionType(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <div>
              {actionHistoryTotalItems > 0
                ? `Showing page ${actionHistoryPage} of ${actionHistoryTotalPages} · ${actionHistoryTotalItems} total activity records`
                : 'No activity records loaded yet.'}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={goToPreviousActionHistoryPage}
                disabled={actionsLoading || actionHistoryPage <= 1}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={goToNextActionHistoryPage}
                disabled={actionsLoading || actionHistoryPage >= actionHistoryTotalPages}
              >
                Next
              </Button>
            </div>
          </div>

          {actionsLoading && scopedActions.length === 0 ? (
            <div className="rounded-2xl border p-4 text-sm text-muted-foreground">
              Loading activity...
            </div>
          ) : filteredScopedActions.length > 0 ? (
            <AppDetailActionHistoryTable
              actions={filteredScopedActions}
              buildActionDetailHref={buildActionDetailHref}
              onRequestCancel={onRequestCancelAction}
              onRequestForceFail={onRequestForceFailAction}
              onRequestResume={onRequestResumeAction}
            />
          ) : scopedActions.length > 0 ? (
            <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
              No activity records match the current local filters.
            </div>
          ) : (
            <div className="space-y-2 rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
              <p>No shared activity is associated with this app yet.</p>
              <div className="flex flex-wrap gap-2">
                {app.last_operation ? (
                  <Button variant="outline" onClick={openOperationStatus}>
                    Open Latest Activity Detail
                  </Button>
                ) : null}
                <Button variant="outline" onClick={openAllActionsForApp}>
                  Open Activity Page
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <ReleaseLineageSection releases={releases} openReleaseDetail={openReleaseDetail} />
    </TabsContent>
  )
}
