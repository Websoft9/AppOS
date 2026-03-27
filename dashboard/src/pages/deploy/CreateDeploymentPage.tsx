import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  List,
  ShieldAlert,
  X,
} from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { iacUploadFile, iacMkdir } from '@/lib/iac-api'
import { pb } from '@/lib/pb'
import { buildActionListHref } from '@/pages/deploy/actions/action-utils'
import type { CreateDeploymentEntryMode } from '@/pages/deploy/actions/action-types'
import { useActionsController } from '@/pages/deploy/actions/useActionsController'
import { OrchestrationSection } from '@/pages/deploy/OrchestrationSection'

const SOURCE_LABELS: Record<string, string> = {
  compose: 'Compose File',
  'git-compose': 'Git Repository',
  'docker-command': 'Docker Command',
  'install-script': 'Source Packages',
}

type CreateDeploymentPageProps = {
  prefillMode?: string
  prefillSource?: string
  prefillAppId?: string
  prefillAppKey?: string
  prefillAppName?: string
  prefillServerId?: string
  entryMode?: CreateDeploymentEntryMode
}

type NameAvailabilityResult = {
  ok?: boolean
  project_name?: string
  normalized_name?: string
  message?: string
}

function HelpTip({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <CircleHelp className="ml-1 inline h-3.5 w-3.5 cursor-help text-muted-foreground/60 hover:text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function CreateDeploymentPage({
  prefillMode,
  prefillSource,
  prefillAppId,
  prefillAppKey,
  prefillAppName,
  prefillServerId,
  entryMode,
}: CreateDeploymentPageProps) {
  const {
    servers,
    notice,
    setNotice,
    prefillLoading,
    prefillReady,
    createEntryMode,
    serverId,
    setServerId,
    projectName,
    setProjectName,
    compose,
    setCompose,
    envVars,
    setEnvVars,
    storeProducts,
    gitProjectName,
    setGitProjectName,
    gitRepositoryUrl,
    setGitRepositoryUrl,
    gitRef,
    setGitRef,
    gitComposePath,
    setGitComposePath,
    gitAuthHeaderName,
    setGitAuthHeaderName,
    gitAuthHeaderValue,
    setGitAuthHeaderValue,
    appRequiredDiskGiB,
    setAppRequiredDiskGiB,
    checkResult,
    setCheckResult,
    checking,
    gitChecking,
    submitting,
    gitSubmitting,
    checkManualOperation,
    checkGitOperation,
    submitManualOperation,
    submitGitOperation,
  } = useActionsController({
    prefillMode,
    prefillSource,
    prefillAppId,
    prefillAppKey,
    prefillAppName,
    prefillServerId,
    entryMode,
    view: 'create',
  })

  const isGit = createEntryMode === 'git-compose'
  const activeName = isGit ? gitProjectName : projectName
  const activeSubmitting = isGit ? gitSubmitting : submitting
  const activeChecking = isGit ? gitChecking : checking
  const [composeYamlError, setComposeYamlError] = useState<string | null>(null)

  const createDisabled = isGit
    ? !gitRepositoryUrl.trim() || !gitComposePath.trim() || !serverId || activeSubmitting
    : !compose.trim() || !serverId || activeSubmitting || Boolean(composeYamlError)
  const checkDisabled = isGit
    ? !gitRepositoryUrl.trim() || !gitComposePath.trim() || !serverId || activeChecking
    : !compose.trim() || !serverId || activeChecking || Boolean(composeYamlError)

  // ── Src file state (shared with OrchestrationSection, uploaded on submit) ──
  const [srcFiles, setSrcFiles] = useState<File[]>([])
  const [srcUploading, setSrcUploading] = useState(false)
  const [srcUploaded, setSrcUploaded] = useState<string[]>([])

  // ── Submit with src uploads ──
  const handleSubmit = useCallback(async () => {
    const preflight = isGit
      ? await checkGitOperation({ silentNotice: true })
      : await checkManualOperation({ silentNotice: true })

    if (!preflight) {
      return
    }

    if (!preflight.ok) {
      setNotice({
        variant: 'destructive',
        message: `Create blocked by preflight: ${preflight.message}`,
      })
      return
    }

    if (srcFiles.length > 0 && projectName.trim()) {
      setSrcUploading(true)
      try {
        const dir = `apps/${projectName.trim()}/src`
        await iacMkdir(dir)
        const uploaded: string[] = []
        for (const file of srcFiles) {
          await iacUploadFile(dir, file)
          uploaded.push(file.name)
        }
        setSrcUploaded(uploaded)
        setSrcFiles([])
      } catch {
        // continue with deployment even if upload fails
      } finally {
        setSrcUploading(false)
      }
    }
    if (isGit) {
      await submitGitOperation()
    } else {
      await submitManualOperation()
    }
  }, [
    checkGitOperation,
    checkManualOperation,
    setNotice,
    srcFiles,
    projectName,
    isGit,
    submitGitOperation,
    submitManualOperation,
  ])

  const activeServer = servers.find(s => s.id === serverId)

  const resolutionPreview = useMemo(() => {
    switch (createEntryMode) {
      case 'git-compose':
        return { source: 'gitops', adapter: 'git-compose' }
      default:
        return { source: 'manualops', adapter: 'manual-compose' }
    }
  }, [createEntryMode])

  const envCount = envVars.filter(e => e.key.trim()).length
  const composeLineCount = compose.split('\n').length
  const validationItems = [
    { label: 'Target server', passed: serverId.length > 0 },
    { label: isGit ? 'Repository inputs' : 'Compose content', passed: isGit ? gitRepositoryUrl.trim().length > 0 && gitComposePath.trim().length > 0 : compose.trim().length > 0 },
    ...(!isGit && compose.trim() ? [{ label: 'YAML syntax', passed: !composeYamlError }] : []),
  ]

  const srcRelativePath = './src/'

  useEffect(() => {
    setCheckResult(null)
  }, [
    compose,
    gitAuthHeaderName,
    gitAuthHeaderValue,
    gitComposePath,
    gitRef,
    gitRepositoryUrl,
    isGit,
    projectName,
    gitProjectName,
    serverId,
    appRequiredDiskGiB,
    setCheckResult,
  ])

  const preflightSummary = checkResult?.checks?.ports
  const diskSummary = checkResult?.checks?.disk_space
  const portItems = preflightSummary?.items || []
  const [nameChecking, setNameChecking] = useState(false)
  const [nameResult, setNameResult] = useState<NameAvailabilityResult | null>(null)

  const nameHint = useMemo(() => {
    if (!activeName.trim()) return null
    if (nameChecking) return 'Checking name availability...'
    if (nameResult?.ok === false) return nameResult.message || 'Application name is unavailable'
    if (!nameResult) return 'Name availability check is temporarily unavailable'
    return null
  }, [activeName, nameChecking, nameResult])

  const reviewMessages = useMemo(() => {
    const messages: string[] = []

    const pushMessage = (message?: string, include?: boolean) => {
      const normalized = message?.trim()
      if (!include || !normalized || messages.includes(normalized)) return
      messages.push(normalized)
    }

    pushMessage(checkResult?.checks?.app_name?.message, checkResult?.checks?.app_name?.ok === false)
    pushMessage(nameResult?.message, nameResult?.ok === false)
    pushMessage(
      preflightSummary?.message,
      Boolean(preflightSummary?.conflict || (preflightSummary?.ok === false && preflightSummary?.status !== 'unavailable')),
    )
    pushMessage(
      diskSummary?.message,
      Boolean(diskSummary?.conflict || (diskSummary?.ok === false && diskSummary?.status !== 'unavailable')),
    )

    for (const warning of checkResult?.warnings || []) {
      pushMessage(warning, true)
    }

    return messages
  }, [checkResult, diskSummary, nameResult, preflightSummary])

  useEffect(() => {
    if (!activeName.trim()) {
      setNameResult(null)
      setNameChecking(false)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      setNameChecking(true)
      void pb.send<NameAvailabilityResult>('/api/actions/install/name-availability', {
        method: 'POST',
        body: { project_name: activeName },
      })
        .then(result => {
          if (!cancelled) {
            setNameResult(result)
          }
        })
        .catch(() => {
          if (!cancelled) {
            setNameResult(null)
          }
        })
        .finally(() => {
          if (!cancelled) {
            setNameChecking(false)
          }
        })
    }, 300)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [activeName])

  return (
    <div className="flex flex-col gap-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Create Deployment</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Define and launch a new application deployment on a target server.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <a href="/deploy"><ArrowLeft className="mr-1 h-4 w-4" />Back</a>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <a href={buildActionListHref()}><List className="mr-1 h-4 w-4" />History</a>
          </Button>
        </div>
      </div>

      {/* ── Alerts ── */}
      {notice ? (
        <Alert variant={notice.variant} className="flex items-center justify-between py-2">
          <AlertDescription>{notice.message}</AlertDescription>
          <Button variant="ghost" size="sm" onClick={() => setNotice(null)}><X className="h-3 w-3" /></Button>
        </Alert>
      ) : null}
      {prefillLoading ? (
        <Alert><AlertDescription>Loading template for {prefillAppName || prefillAppKey || prefillAppId}...</AlertDescription></Alert>
      ) : null}
      {prefillReady ? (
        <Alert><AlertDescription>Template loaded for {prefillReady}. Review inputs below.</AlertDescription></Alert>
      ) : null}

      {/* ════ Two-column: Form workspace │ Review panel ════ */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        {/* ──── Left: Form workspace ──── */}
        <div className="space-y-5">
          {/* ── Section 1: Info ── */}
          <section className="rounded-lg border bg-card px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <span className="text-base font-semibold">Info</span>
                <HelpTip text="Identify the deployment target. The app name becomes the compose project name and data directory. Leave empty to auto-generate." />
              </div>
              <div className="text-xs text-muted-foreground">Application identity and target server</div>
            </div>
            <div className="grid gap-4 pt-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="deploy-name" className="text-xs">
                  App Name <HelpTip text="Must be unique across the server. Used as compose_project_name and the root of the app data path. Leave empty to auto-generate." />
                </Label>
                <Input
                  id="deploy-name"
                  value={activeName}
                  onChange={e => isGit ? setGitProjectName(e.target.value) : setProjectName(e.target.value)}
                  placeholder={isGit ? 'Auto-generated from repo name' : 'Auto-generated if empty'}
                />
                {nameHint ? (
                  <div className={`text-[11px] ${nameResult?.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
                    {nameHint}
                  </div>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="deploy-server" className="text-xs">
                  Target Location <HelpTip text="The target server where containers will be created and managed." />
                </Label>
                <select
                  id="deploy-server"
                  className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                  value={serverId}
                  onChange={e => setServerId(e.target.value)}
                >
                  <option value="" disabled>Select a server…</option>
                  {servers.map(s => <option key={s.id} value={s.id}>{s.label} ({s.host})</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="required-disk" className="text-xs">
                  Estimated App Disk (GiB) <HelpTip text="Optional. If provided, preflight blocks creation when estimated requirement exceeds currently available disk space." />
                </Label>
                <Input
                  id="required-disk"
                  type="number"
                  min="0"
                  step="0.1"
                  value={appRequiredDiskGiB}
                  onChange={e => setAppRequiredDiskGiB(e.target.value)}
                  placeholder="Optional, e.g. 2"
                />
              </div>
            </div>
          </section>

          {/* ── Section 2: Source inputs ── */}
          {isGit ? (
            /* ── Git-compose inputs ── */
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Repository</CardTitle>
                <CardDescription>Provide the Git repository coordinates. The backend clones, extracts the compose file, and resolves it into an install payload.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="git-url" className="text-xs">Repository URL</Label>
                  <Input id="git-url" value={gitRepositoryUrl} onChange={e => setGitRepositoryUrl(e.target.value)} placeholder="https://github.com/org/repo" />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="git-ref" className="text-xs">Ref</Label>
                    <Input id="git-ref" value={gitRef} onChange={e => setGitRef(e.target.value)} placeholder="main" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="git-path" className="text-xs">Compose Path</Label>
                    <Input id="git-path" value={gitComposePath} onChange={e => setGitComposePath(e.target.value)} placeholder="docker-compose.yml" />
                  </div>
                </div>
                <details className="rounded-md border p-3">
                  <summary className="cursor-pointer text-xs font-medium">Private Repository Access</summary>
                  <div className="mt-3 grid gap-3 md:grid-cols-[180px_1fr]">
                    <div className="space-y-1.5">
                      <Label htmlFor="git-auth-name" className="text-xs">Header Name</Label>
                      <Input id="git-auth-name" value={gitAuthHeaderName} onChange={e => setGitAuthHeaderName(e.target.value)} placeholder="Authorization" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="git-auth-value" className="text-xs">Header Value</Label>
                      <Input id="git-auth-value" value={gitAuthHeaderValue} onChange={e => setGitAuthHeaderValue(e.target.value)} placeholder="Bearer <token>" />
                    </div>
                  </div>
                </details>
              </CardContent>
            </Card>
          ) : (
            <OrchestrationSection
              compose={compose}
              setCompose={setCompose}
              envVars={envVars}
              setEnvVars={setEnvVars}
              projectName={projectName}
              setProjectName={setProjectName}
              storeProducts={storeProducts}
              srcFiles={srcFiles}
              setSrcFiles={setSrcFiles}
              srcUploaded={srcUploaded}
              onYamlError={setComposeYamlError}
            />
          )}

          {/* ── Section 3: Advanced Options ── */}
          <details className="group rounded-lg border bg-card">
            <summary className="flex cursor-pointer list-none items-start gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-0 [&:not([open]_&)]:rotate-[-90deg]" />
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-base font-semibold">Advanced Options</span>
                  <HelpTip text="Additional deployment parameters resolved and normalized by the backend before execution." />
                </div>
                <div className="text-xs text-muted-foreground">Exposure, secret-backed inputs, and more</div>
              </div>
            </summary>
            <div className="grid gap-3 px-4 pb-4 pl-10 md:grid-cols-2">
              <div className="rounded-lg border bg-muted/10 p-3">
                <div className="text-xs font-medium">Exposure Intent <HelpTip text="Domain, path, or port publication intent for reverse-proxy configuration." /></div>
                <div className="mt-1 text-xs text-muted-foreground">Coming soon</div>
              </div>
              <div className="rounded-lg border bg-muted/10 p-3">
                <div className="text-xs font-medium">Secret-backed Inputs <HelpTip text="Sensitive values managed through the backend secret store, never exposed in plain text." /></div>
                <div className="mt-1 text-xs text-muted-foreground">Coming soon</div>
              </div>
            </div>
          </details>
        </div>

        {/* ──── Right: Review panel ──── */}
        <div>
          <div className="space-y-4 xl:sticky xl:top-6">
            <Card className="border-slate-200 dark:border-slate-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Review</CardTitle>
                <CardDescription>Verify the deployment summary before submitting. The backend performs final validation and normalization.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {/* ── Identity ── */}
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Identity</div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Source</span>
                      <span>{SOURCE_LABELS[createEntryMode] || createEntryMode}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">App Name</span>
                      <span className="max-w-[200px] truncate">{activeName || 'Auto-generated'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Server</span>
                      <span className="max-w-[200px] truncate">{activeServer ? `${activeServer.label} (${activeServer.host})` : '—'}</span>
                    </div>
                  </div>
                </div>

                <hr className="border-dashed" />

                {/* ── Resolution ── */}
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Resolution</div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Lifecycle source</span>
                      <span>{resolutionPreview.source}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Adapter</span>
                      <span>{resolutionPreview.adapter}</span>
                    </div>
                    {isGit && gitRepositoryUrl.trim() ? (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Repository</span>
                        <span className="max-w-[200px] truncate">{gitRepositoryUrl}</span>
                      </div>
                    ) : null}
                    {!isGit ? (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Compose</span>
                        <span>{compose.trim() ? `${composeLineCount} lines` : '—'}</span>
                      </div>
                    ) : null}
                  </div>
                </div>

                <hr className="border-dashed" />

                {/* ── Inputs ── */}
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Inputs</div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Env variables</span>
                      <span>{envCount > 0 ? `${envCount} defined` : 'None'}</span>
                    </div>
                    {envCount > 0 ? (
                      <div className="max-h-24 overflow-y-auto rounded-md bg-muted/30 px-2 py-1.5">
                        {envVars.filter(e => e.key.trim()).map((e, i) => (
                          <div key={i} className="truncate font-mono text-xs text-muted-foreground">
                            {e.key}={e.value.length > 20 ? `${e.value.slice(0, 20)}…` : e.value}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Mount files</span>
                      <span>{srcFiles.length + srcUploaded.length > 0 ? `${srcFiles.length + srcUploaded.length} file(s)` : 'None'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Estimated app disk</span>
                      <span>{appRequiredDiskGiB.trim() ? `${appRequiredDiskGiB.trim()} GiB` : 'Not set'}</span>
                    </div>
                    {srcFiles.length > 0 || srcUploaded.length > 0 ? (
                      <div className="rounded-md bg-muted/30 px-2 py-1.5">
                        {[...srcUploaded.map(n => ({ name: n, done: true })), ...srcFiles.map(f => ({ name: f.name, done: false }))].map((f, i) => (
                          <div key={i} className="truncate font-mono text-xs text-muted-foreground">
                            {f.done ? <span className="text-emerald-600">✓ </span> : null}{srcRelativePath}{f.name}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>

                <hr className="border-dashed" />

                {/* ── Validation ── */}
                <div className="rounded-lg border bg-slate-50/80 p-3 dark:bg-slate-900/60">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pre-flight checks</div>
                  <div className="mt-2 space-y-1.5">
                    {validationItems.map(item => (
                      <div key={item.label} className="flex items-center gap-2 text-xs">
                        <CheckCircle2 className={item.passed ? 'h-3.5 w-3.5 text-emerald-600' : 'h-3.5 w-3.5 text-slate-400'} />
                        <span>{item.label}</span>
                      </div>
                    ))}
                  </div>
                  {checkResult ? (
                    <div className="mt-3 space-y-2 rounded-md border bg-background/80 p-2.5 text-xs">
                      <div className="flex items-start gap-2">
                        {checkResult.ok ? (
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 text-amber-600" />
                        )}
                        <div className="min-w-0">
                          <div className="font-medium">{checkResult.message}</div>
                          {checkResult.compose_project_name ? (
                            <div className="text-xs text-muted-foreground">Resolved app name: {checkResult.compose_project_name}</div>
                          ) : null}
                        </div>
                      </div>
                      {reviewMessages.length > 0 ? (
                        <div className="space-y-2">
                          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Warnings</div>
                          <div className="space-y-1.5">
                            {reviewMessages.map(message => (
                              <div key={message} className="rounded-md border border-amber-200/70 bg-amber-50/60 px-2.5 py-2 text-xs leading-5 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
                                {message}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {portItems.length > 0 ? (
                        <div className="space-y-1 rounded-md bg-muted/30 p-2">
                          {portItems.map(item => (
                            <div key={`${item.protocol}-${item.port}`} className="flex items-center justify-between gap-3 text-xs">
                              <span className="font-mono">{item.port}/{item.protocol}</span>
                              <span className={item.conflict ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}>
                                {item.conflict ? `${item.occupied ? 'occupied' : 'reserved'}${item.occupied && item.reserved ? ' and reserved' : ''}` : 'available'}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="mt-2 text-[10px] text-muted-foreground">Final validation is performed server-side. Use Check to preview compose validity, duplicate names, and host-port conflicts before creating the action.</div>
                  )}
                </div>

                {/* ── Actions ── */}
                <div className="flex flex-col gap-2 pt-1">
                  <Button variant="outline" onClick={() => void (isGit ? checkGitOperation() : checkManualOperation())} disabled={checkDisabled} className="h-10">
                    {activeChecking ? 'Checking...' : 'Check'}
                  </Button>
                  <Button onClick={() => void handleSubmit()} disabled={createDisabled || srcUploading} className="h-10">
                    {activeSubmitting || srcUploading ? 'Creating...' : 'Create Deployment'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}