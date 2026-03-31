import { Link } from '@tanstack/react-router'
import { Boxes, ExternalLink, FolderOpen, Loader2, RefreshCw, RotateCcw, Save, ShieldCheck, TerminalSquare } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TabsContent } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { statusVariant } from '@/pages/deploy/actions/action-utils'
import { formatBytesCompact, getActionLabel, summarizePorts } from '@/pages/apps/app-detail-utils'
import { formatTime } from '@/pages/apps/types'
import type {
  ComposeTabProps,
  DataTabProps,
  ObservabilityTabProps,
  RuntimeTabProps,
} from '@/pages/apps/AppDetailTabPanelTypes'

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
  return (
    <TabsContent value="runtime" className="space-y-2.5">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Containers</CardTitle>
          <CardDescription>App-related runtime projection from Docker inventory and container stats.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl bg-muted/20 p-3"><div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Matched Containers</div><div className="mt-1 text-xl font-semibold">{runtimeSummary.total}</div></div>
            <div className="rounded-2xl bg-muted/20 p-3"><div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Running</div><div className="mt-1 text-xl font-semibold">{runtimeSummary.running}</div></div>
            <div className="rounded-2xl bg-muted/20 p-3"><div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Total CPU</div><div className="mt-1 text-xl font-semibold">{runtimeSummary.cpu.toFixed(runtimeSummary.cpu >= 10 ? 0 : 1)}%</div></div>
            <div className="rounded-2xl bg-muted/20 p-3"><div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Memory Used</div><div className="mt-1 text-xl font-semibold">{formatBytesCompact(runtimeSummary.memory)}</div></div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Server {app.server_id || 'local'}</span>
            <span>Project directory {app.project_dir}</span>
            {projectNameCandidates.length > 0 ? <span>Matched by {projectNameCandidates.join(', ')}</span> : null}
          </div>
          {runtimeLoading && !runtimeLoaded ? (
            <div className="rounded-2xl border p-4 text-sm text-muted-foreground">Loading runtime inventory...</div>
          ) : relatedRuntimeContainers.length > 0 ? (
            <Table containerClassName="rounded-xl border">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Image</TableHead>
                  <TableHead>CPU</TableHead>
                  <TableHead>Memory</TableHead>
                  <TableHead>Ports</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {relatedRuntimeContainers.map(container => (
                  <TableRow key={container.ID}>
                    <TableCell>
                      <div className="font-medium">{container.Names || container.ID}</div>
                      <div className="font-mono text-xs text-muted-foreground">{container.ID}</div>
                    </TableCell>
                    <TableCell><Badge variant={container.State === 'running' ? 'default' : 'outline'}>{container.State || container.Status || '-'}</Badge></TableCell>
                    <TableCell className="max-w-[260px] truncate">{container.Image || '-'}</TableCell>
                    <TableCell>{runtimeStats[container.ID]?.CPUPerc || '-'}</TableCell>
                    <TableCell>{runtimeStats[container.ID]?.MemUsage?.split('/')[0]?.trim() || '-'}</TableCell>
                    <TableCell className="max-w-[280px] whitespace-normal text-xs text-muted-foreground">{summarizePorts(container.Ports)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => openRuntimeContainerLogs(container)}>Logs</Button>
                        <Button variant="outline" size="sm" onClick={() => openServerWorkspace()} disabled={!canOpenServerWorkspace}>Exec</Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openServerWorkspace({ panel: 'files', path: app.project_dir || '/', lockedRoot: app.project_dir || '/' })}
                          disabled={!canOpenServerWorkspace || !app.project_dir}
                        >
                          Files
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
              No matching containers were found for this app in the current Docker inventory.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2.5"><CardTitle>Runtime Operations</CardTitle></CardHeader>
        <CardContent className="space-y-1.5 text-sm text-muted-foreground">
          <p>This page exposes app-related container projection and resource summary. Deep runtime control still belongs to the server workspace and Docker views.</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setTab('observability')}>Open Observability</Button>
            <Button variant="outline" size="sm" onClick={() => setTab('compose')}>Open Compose</Button>
            {canOpenServerWorkspace ? (
              <Button variant="outline" size="sm" onClick={() => openServerWorkspace()}>
                <TerminalSquare className="mr-2 h-4 w-4" />
                Open Server Workspace
              </Button>
            ) : null}
            <Button variant="outline" size="sm" asChild>
              <Link to="/docker" search={{ server: app.server_id && app.server_id !== 'local' ? app.server_id : undefined }}>
                <Boxes className="mr-2 h-4 w-4" />
                Open Docker Workspace
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
  return (
    <TabsContent value="compose" className="space-y-2.5">
      <Card>
        <CardHeader className="pb-2.5"><CardTitle>Compose Asset</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => fetchConfig(true)} disabled={configLoading}>{configLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Reload</Button>
            <Button variant="outline" onClick={validateDraft} disabled={validating || !configText.trim()}>{validating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}Validate Draft</Button>
            <Button variant="outline" onClick={rollbackConfig} disabled={rollingBack || !rollbackMeta.available}>{rollingBack ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}Rollback</Button>
            {app.iac_path ? <Button variant="outline" onClick={openIacWindow}><ExternalLink className="mr-2 h-4 w-4" />Open in IaC</Button> : null}
            <Button onClick={saveConfig} disabled={saveDisabled}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save</Button>
          </div>
          <div className="grid gap-2 text-sm md:grid-cols-2">
            <div><span className="text-muted-foreground">IaC Path:</span> <span className="font-mono text-xs">{app.iac_path || '-'}</span></div>
            <div><span className="text-muted-foreground">Project Dir:</span> <span className="break-all">{app.project_dir}</span></div>
          </div>
          {rollbackMeta.available ? <p className="text-xs text-muted-foreground">Rollback point available{rollbackMeta.savedAt ? ` from ${formatTime(rollbackMeta.savedAt)}` : ''}{rollbackMeta.sourceAction ? ` via ${rollbackMeta.sourceAction}` : ''}.</p> : null}
          {validation ? <Alert variant={validation.valid ? 'default' : 'destructive'}><AlertDescription>{validation.message}</AlertDescription></Alert> : <Alert><AlertDescription>Validate the current draft before saving. Save remains disabled until the current content passes validation.</AlertDescription></Alert>}
          <Textarea className="min-h-[360px] font-mono text-xs" value={configText} onChange={event => setConfigText(event.target.value)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2.5">
          <CardTitle>Environment File</CardTitle>
          <CardDescription>Edit the app-local .env file beside the compose asset when present.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => envFilePath && fetchEnvFile(envFilePath)} disabled={!envFilePath || envFileLoading}>
              {envFileLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Reload Env
            </Button>
            <Button onClick={() => envFilePath && saveEnvFile(envFilePath)} disabled={!envFilePath || !hasEnvFileChanges || envFileSaving}>
              {envFileSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Env
            </Button>
          </div>
          <div className="grid gap-2 text-sm md:grid-cols-2">
            <div><span className="text-muted-foreground">Env Path:</span> <span className="font-mono text-xs">{envFilePath || '-'}</span></div>
            <div><span className="text-muted-foreground">Status:</span> {envFileLoaded ? 'loaded' : envFileLoading ? 'loading' : 'not loaded'}</div>
          </div>
          {envFileError ? <Alert variant="destructive"><AlertDescription>{envFileError}</AlertDescription></Alert> : null}
          {!envFilePath ? <Alert><AlertDescription>Env editing is unavailable because the compose asset path is not resolved yet.</AlertDescription></Alert> : null}
          <Textarea className="min-h-[180px] font-mono text-xs" value={envFileText} onChange={event => setEnvFileText(event.target.value)} placeholder="KEY=value" disabled={!envFilePath || envFileLoading} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2.5"><CardTitle>Validation and Diff</CardTitle></CardHeader>
        <CardContent>
          <pre className="max-h-[320px] overflow-auto rounded-xl border bg-muted/20 p-4 font-mono text-xs leading-5">{diffText}</pre>
        </CardContent>
      </Card>
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
  return (
    <TabsContent value="observability" className="space-y-2.5">
      <div className="grid gap-2.5 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2.5"><CardTitle>Metrics</CardTitle><Button variant="outline" onClick={() => fetchLogs(true)} disabled={logsLoading}>{logsLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Refresh</Button></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid gap-2 md:grid-cols-2">
              <div className="rounded-xl border p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Runtime Containers</div>
                <div className="mt-1 text-xl font-semibold">{runtimeLoaded ? `${runtimeSummary.running} / ${runtimeSummary.total}` : '-'}</div>
                <div className="text-xs text-muted-foreground">running / total matched containers</div>
              </div>
              <div className="rounded-xl border p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Combined Resource Use</div>
                <div className="mt-1 text-sm font-medium">CPU {runtimeLoaded ? `${runtimeSummary.cpu.toFixed(1)}%` : '-'}</div>
                <div className="text-sm text-muted-foreground">Memory {runtimeLoaded ? formatBytesCompact(runtimeSummary.memory) : '-'}</div>
              </div>
            </div>
            <div className="rounded-xl border p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Latest Lifecycle Execution</div>
              {latestScopedAction ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
                  <span className="font-medium">{getActionLabel(latestScopedAction)}</span>
                  <Badge variant={statusVariant(latestScopedAction.status)}>{latestScopedAction.status}</Badge>
                  <span className="text-muted-foreground">{formatTime(latestScopedAction.updated || latestScopedAction.created)}</span>
                </div>
              ) : (
                <div className="mt-1.5 text-muted-foreground">No app-scoped actions have been observed yet.</div>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2.5"><CardTitle>Health and Heartbeat</CardTitle></CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            <div className="grid gap-2 md:grid-cols-2">
              <div><span className="text-muted-foreground">Runtime status:</span> {app.runtime_status}</div>
              <div><span className="text-muted-foreground">Lifecycle state:</span> {app.lifecycle_state || '-'}</div>
              <div><span className="text-muted-foreground">Health summary:</span> {app.health_summary || '-'}</div>
              <div><span className="text-muted-foreground">Publication:</span> {app.publication_summary || '-'}</div>
              <div><span className="text-muted-foreground">Primary exposure health:</span> {primaryExposure?.health_state || '-'}</div>
              <div><span className="text-muted-foreground">Last exposure verification:</span> {formatTime(primaryExposure?.last_verified_at)}</div>
            </div>
            <div className="rounded-xl border bg-muted/20 px-3 py-2 text-muted-foreground">
              Heartbeat is projected from app runtime and exposure health signals. Dedicated heartbeat telemetry is not connected yet.
            </div>
            {app.runtime_reason ? <div className="rounded-lg bg-amber-50 px-3 py-2 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">{app.runtime_reason}</div> : null}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader className="pb-2.5"><CardTitle>Logs</CardTitle></CardHeader>
        <CardContent>
          <div ref={logViewportRef} className="h-[380px] overflow-auto rounded-xl bg-black px-4 py-3 font-mono text-[11px] leading-5 text-slate-100" onScroll={event => {
            const target = event.currentTarget
            stickToBottomRef.current = target.scrollHeight - target.scrollTop - target.clientHeight < 32
          }}>
            <pre className={cn('whitespace-pre-wrap break-words', !logs?.output && 'text-slate-500')}>{logs?.output || 'No logs yet.'}</pre>
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
  matchedDatabaseResources,
  matchedDataVolumes,
  backupProjection,
  mountProjectionLoading,
  containerMountRows,
  canOpenServerWorkspace,
  openServerWorkspace,
}: DataTabProps) {
  return (
    <TabsContent value="data" className="space-y-2.5">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Database Connections</CardTitle>
          <CardDescription>Projected matches from shared resource inventory.</CardDescription>
          <CardAction>
            <Button variant="outline" size="sm" asChild>
              <Link to="/resources/databases">Open Databases</Link>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-3">
          {dataError ? <Alert variant="destructive"><AlertDescription>{dataError}</AlertDescription></Alert> : null}
          {dataLoading && !dataLoaded ? (
            <div className="rounded-2xl border p-4 text-sm text-muted-foreground">Loading database projections...</div>
          ) : matchedDatabaseResources.length > 0 ? (
            <Table containerClassName="rounded-xl border">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Host</TableHead>
                  <TableHead>Database</TableHead>
                  <TableHead>User</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {matchedDatabaseResources.map(database => (
                  <TableRow key={database.id}>
                    <TableCell className="font-medium">{database.name || '-'}</TableCell>
                    <TableCell>{database.type || '-'}</TableCell>
                    <TableCell>{database.host}{database.port ? `:${database.port}` : ''}</TableCell>
                    <TableCell>{database.db_name || '-'}</TableCell>
                    <TableCell>{database.user || '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
              No database resource matched this app by name, project, or description.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Volumes and Restore Points</CardTitle>
          <CardDescription>App-matched Docker volumes plus platform backup status.</CardDescription>
          <CardAction>
            <Button variant="outline" size="sm" asChild>
              <Link to="/docker" search={{ server: app.server_id && app.server_id !== 'local' ? app.server_id : undefined }}>Open Docker Workspace</Link>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-3">
          {dataLoading && !dataLoaded ? (
            <div className="rounded-2xl border p-4 text-sm text-muted-foreground">Loading volume projections...</div>
          ) : matchedDataVolumes.length > 0 ? (
            <Table containerClassName="rounded-xl border">
              <TableHeader>
                <TableRow>
                  <TableHead>Volume</TableHead>
                  <TableHead>Driver</TableHead>
                  <TableHead>Mountpoint</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {matchedDataVolumes.map(volume => (
                  <TableRow key={volume.Name}>
                    <TableCell className="font-medium">{volume.Name}</TableCell>
                    <TableCell>{volume.Driver || '-'}</TableCell>
                    <TableCell className="max-w-[420px] truncate">{volume.Mountpoint || '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
              No Docker volumes matched this app in the current runtime inventory.
            </div>
          )}

          <Alert variant={backupProjection.status === 'error' ? 'destructive' : 'default'}>
            <AlertDescription>{backupProjection.message}</AlertDescription>
          </Alert>

          {backupProjection.status === 'available' && backupProjection.items.length > 0 ? (
            <Table containerClassName="rounded-xl border">
              <TableHeader>
                <TableRow>
                  <TableHead>Snapshot</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Updated</TableHead>
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
          <CardTitle>Container Mounts</CardTitle>
          <CardDescription>Bind mounts and named volume attachments projected from container inspect data.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {mountProjectionLoading ? (
            <div className="rounded-2xl border p-4 text-sm text-muted-foreground">Loading container mount projection...</div>
          ) : containerMountRows.length > 0 ? (
            <Table containerClassName="rounded-xl border">
              <TableHeader>
                <TableRow>
                  <TableHead>Container</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {containerMountRows.map(mount => (
                  <TableRow key={mount.id}>
                    <TableCell className="font-medium">{mount.containerName}</TableCell>
                    <TableCell>{mount.type}</TableCell>
                    <TableCell className="max-w-[320px] truncate">{mount.source}</TableCell>
                    <TableCell className="max-w-[280px] truncate">{mount.destination}</TableCell>
                    <TableCell>{mount.writable ? 'rw' : 'ro'}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openServerWorkspace({ panel: 'files', path: mount.source, lockedRoot: mount.source })}
                        disabled={!canOpenServerWorkspace || mount.source === '-'}
                      >
                        <FolderOpen className="mr-2 h-4 w-4" />
                        Files
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
              No container mount projection is available for the current app runtime.
            </div>
          )}
        </CardContent>
      </Card>
    </TabsContent>
  )
}