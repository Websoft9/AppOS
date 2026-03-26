import { useCallback, useMemo, useState } from 'react'
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  List,
  X,
} from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { iacUploadFile, iacMkdir } from '@/lib/iac-api'
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
    submitting,
    gitSubmitting,
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
  const createDisabled = isGit
    ? !gitRepositoryUrl.trim() || !gitComposePath.trim() || !serverId || activeSubmitting
    : !compose.trim() || !serverId || activeSubmitting

  // ── Src file state (shared with OrchestrationSection, uploaded on submit) ──
  const [srcFiles, setSrcFiles] = useState<File[]>([])
  const [srcUploading, setSrcUploading] = useState(false)
  const [srcUploaded, setSrcUploaded] = useState<string[]>([])

  // ── Submit with src uploads ──
  const handleSubmit = useCallback(async () => {
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
  }, [srcFiles, projectName, isGit, submitGitOperation, submitManualOperation])

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
  ]

  const srcRelativePath = './src/'

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
          <details className="group rounded-lg border bg-card" open>
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-0 [&:not([open]_&)]:rotate-[-90deg]" />
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-base font-semibold">Info</span>
                  <HelpTip text="Identify the deployment target. The app name becomes the compose project name and data directory. Leave empty to auto-generate." />
                </div>
                <div className="text-xs text-muted-foreground">Application identity and target server</div>
              </div>
            </summary>
            <div className="grid gap-4 px-4 pb-4 md:grid-cols-2">
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
            </div>
          </details>

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
            />
          )}

          {/* ── Section 3: Advanced Options ── */}
          <details className="group rounded-lg border bg-card">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-0 [&:not([open]_&)]:rotate-[-90deg]" />
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-base font-semibold">Advanced Options</span>
                  <HelpTip text="Additional deployment parameters resolved and normalized by the backend before execution." />
                </div>
                <div className="text-xs text-muted-foreground">Exposure, secret-backed inputs, and more</div>
              </div>
            </summary>
            <div className="grid gap-3 px-4 pb-4 md:grid-cols-2">
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
                  <div className="mt-2 text-[10px] text-muted-foreground">Final validation is performed server-side. Duplicate names, invalid YAML, and fetch failures are caught at that stage.</div>
                </div>

                {/* ── Actions ── */}
                <div className="flex flex-col gap-2 pt-1">
                  <Button onClick={() => void handleSubmit()} disabled={createDisabled || srcUploading} className="h-10">
                    {activeSubmitting || srcUploading ? 'Creating...' : 'Create Deployment'}
                  </Button>
                  <Button variant="outline" asChild>
                    <a href="/deploy">Cancel</a>
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