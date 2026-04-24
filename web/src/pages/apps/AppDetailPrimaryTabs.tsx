import { Link } from '@tanstack/react-router'
import { Loader2, RefreshCw, Search } from 'lucide-react'
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
import { AppDetailDisplaySection } from '@/pages/apps/AppDetailDisplaySection'
import {
  displayValue,
  formatActionType,
  parseReleaseAttribution,
} from '@/pages/apps/app-detail-utils'
import { formatTime, formatUptime } from '@/pages/apps/types'
import type {
  AccessTabProps,
  ActionsTabProps,
  OverviewTabProps,
} from '@/pages/apps/AppDetailTabPanelTypes'

export function AppDetailOverviewTab({
  app,
  currentRelease,
  releases,
  openReleaseDetail,
  serverDisplayName,
  canOpenServerDetail,
  openServerDetail,
  primaryExposure,
  exposures,
  serverConnectionPresentation,
  openOperationStatus,
  setTab,
  displaySection,
}: OverviewTabProps) {
  const currentReleaseAttribution = parseReleaseAttribution(currentRelease?.notes)
  const currentReleaseSummary = currentRelease
    ? [currentRelease.release_role, currentRelease.version_label].filter(Boolean).join(' · ')
    : '-'
  const releaseLineage = [...releases]
    .sort((left, right) => new Date(right.updated).getTime() - new Date(left.updated).getTime())
    .slice(0, 4)

  return (
    <TabsContent value="overview" className="space-y-2.5">
      <Card>
        <CardHeader className="pb-2.5">
          <CardTitle>Operational Snapshot</CardTitle>
          <CardDescription>
            Dense app signals for lifecycle, publication, runtime, and execution.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-2xl bg-muted/20 p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              App ID
            </div>
            <div className="mt-1 break-all font-mono text-[11px] font-semibold">{app.id}</div>
          </div>
          <div className="rounded-2xl bg-muted/20 p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Lifecycle
            </div>
            <div className="mt-1 text-sm font-semibold">{app.lifecycle_state || '-'}</div>
          </div>
          <div className="rounded-2xl bg-muted/20 p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Publication
            </div>
            <div className="mt-1 text-sm font-semibold">{app.publication_summary || '-'}</div>
          </div>
          <div className="rounded-2xl bg-muted/20 p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Current Release
            </div>
            <div className="mt-1 text-sm font-semibold">{currentReleaseSummary}</div>
            {currentRelease?.artifact_digest ? (
              <div className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                Artifact: {currentRelease.artifact_digest}
              </div>
            ) : null}
            {currentReleaseAttribution.localImageRef ? (
              <div className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                Local image: {currentReleaseAttribution.localImageRef}
              </div>
            ) : null}
            {currentRelease?.source_ref ? (
              <div className="mt-1 break-all text-[11px] text-muted-foreground">
                Source: {currentRelease.source_ref}
              </div>
            ) : null}
            {currentReleaseAttribution.targetService ? (
              <div className="mt-1 text-[11px] text-muted-foreground">
                Target service: {currentReleaseAttribution.targetService}
              </div>
            ) : null}
            {currentRelease ? (
              <Button
                variant="link"
                size="sm"
                className="mt-1 h-auto px-0 text-[11px]"
                onClick={() => openReleaseDetail(currentRelease)}
              >
                Open release detail
              </Button>
            ) : null}
          </div>
          <div className="rounded-2xl bg-muted/20 p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Installed
            </div>
            <div className="mt-1 text-sm font-semibold">{formatTime(app.installed_at)}</div>
          </div>
          <div className="rounded-2xl bg-muted/20 p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Server
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm font-semibold">
              {serverDisplayName}
              {canOpenServerDetail ? (
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto px-0 text-[11px]"
                  onClick={openServerDetail}
                >
                  Open detail
                </Button>
              ) : null}
            </div>
          </div>
          <div className="rounded-2xl bg-muted/20 p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Uptime
            </div>
            <div className="mt-1 text-sm font-semibold">{formatUptime(app)}</div>
          </div>
          <div className="rounded-2xl bg-muted/20 p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Execution
            </div>
            <div className="mt-1 text-sm font-semibold">
              {app.current_pipeline?.family || app.last_operation || '-'}
            </div>
          </div>
          <div className="rounded-2xl bg-muted/20 p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Health
            </div>
            <div className="mt-1 text-sm font-semibold">
              {app.health_summary || app.runtime_status || '-'}
            </div>
          </div>
        </CardContent>
      </Card>

      <AppDetailDisplaySection
        iconValue={displaySection.iconValue}
        labelValue={displaySection.labelValue}
        tagsValue={displaySection.tagsValue}
        tags={displaySection.tags}
        appName={app.name}
        saving={displaySection.saving}
        hasChanges={displaySection.hasChanges}
        onIconChange={displaySection.onIconChange}
        onLabelChange={displaySection.onLabelChange}
        onTagsChange={displaySection.onTagsChange}
        onSave={displaySection.onSave}
        onReset={displaySection.onReset}
      />

      <div className="grid gap-2.5 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-2.5">
            <CardTitle>Access Snapshot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            <div>Primary exposure: {primaryExposure?.domain || primaryExposure?.path || '-'}</div>
            <div>Exposure count: {exposures.length}</div>
            <div>Server: {serverDisplayName}</div>
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
            <div>
              Certificate summary: {primaryExposure?.certificate_id ? 'bound' : 'not bound'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2.5">
            <CardTitle>Current Execution Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            <div>
              {app.current_pipeline?.family || '-'}{' '}
              {app.current_pipeline?.current_phase ? `· ${app.current_pipeline.current_phase}` : ''}
            </div>
            <div>Last operation: {app.last_operation || '-'}</div>
            <div>Detailed progression stays in Actions.</div>
          </CardContent>
        </Card>
      </div>

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
              {releaseLineage.map(release => (
                <div key={release.id} className="rounded-2xl border bg-muted/10 p-3">
                  {(() => {
                    const attribution = parseReleaseAttribution(release.notes)
                    return (
                      <>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-semibold">
                            {[release.release_role, release.version_label]
                              .filter(Boolean)
                              .join(' · ') || release.id}
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
                      </>
                    )
                  })()}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-2.5 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-2.5">
            <CardTitle>Health Snapshot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            <div>Runtime status: {app.runtime_status}</div>
            <div>Health summary: {app.health_summary || '-'}</div>
            <div>Uptime: {formatUptime(app)}</div>
            {app.runtime_reason ? (
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                {app.runtime_reason}
              </div>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2.5">
            <CardTitle>Recent Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            <div>Last operation: {app.last_operation || '-'}</div>
            <div>Current pipeline: {app.current_pipeline?.family || '-'}</div>
            <div className="flex flex-wrap gap-2 pt-1">
              {app.last_operation ? (
                <Button variant="outline" size="sm" onClick={openOperationStatus}>
                  Open Latest Execution
                </Button>
              ) : null}
              <Button variant="outline" size="sm" onClick={() => setTab('actions')}>
                Open Actions Tab
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </TabsContent>
  )
}

export function AppDetailAccessTab({
  app,
  primaryExposure,
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
            <span className="text-muted-foreground">Target port:</span>{' '}
            {primaryExposure?.target_port || '-'}
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
  actionsLoading,
  actionSearch,
  setActionSearch,
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
}: ActionsTabProps) {
  return (
    <TabsContent value="actions" className="space-y-2.5">
      <Card>
        <CardHeader className="pb-2.5">
          <CardTitle>Current and Recent</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm md:grid-cols-2">
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b pb-3">
          <CardTitle>Action History</CardTitle>
          <CardDescription>
            App-scoped action records pulled from the shared Actions subsystem.
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
                Open in Actions
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
                placeholder="Search this app's actions"
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

          {actionsLoading && scopedActions.length === 0 ? (
            <div className="rounded-2xl border p-4 text-sm text-muted-foreground">
              Loading action history...
            </div>
          ) : filteredScopedActions.length > 0 ? (
            <AppDetailActionHistoryTable
              actions={filteredScopedActions}
              buildActionDetailHref={buildActionDetailHref}
            />
          ) : scopedActions.length > 0 ? (
            <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
              No action records match the current local filters.
            </div>
          ) : (
            <div className="space-y-2 rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
              <p>No shared actions are associated with this app yet.</p>
              <div className="flex flex-wrap gap-2">
                {app.last_operation ? (
                  <Button variant="outline" onClick={openOperationStatus}>
                    Open Latest Action Detail
                  </Button>
                ) : null}
                <Button variant="outline" onClick={openAllActionsForApp}>
                  Open Actions Page
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </TabsContent>
  )
}
