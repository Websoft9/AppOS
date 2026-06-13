import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { CheckCircle2, ChevronDown, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { InstallPreflightResult } from '@/pages/deploy/actions/useActionsController'

type CreateDeploymentReviewPanelProps = {
  appName: string
  targetServerId?: string
  targetLabel: string
  templateAppKey?: string
  templateLabel?: string
  templateIconUrl?: string
  templateInitial?: string
  exposureSummary: string
  preflightVisible: boolean
  helpVisible: boolean
  checkResult: InstallPreflightResult | null
  reviewMessages: string[]
  portItems: Array<{
    port: number
    protocol: string
    occupied?: boolean
    reserved?: boolean
    conflict?: boolean
  }>
  activeChecking: boolean
  activeSubmitting: boolean
  srcUploading: boolean
  checkDisabled: boolean
  createDisabled: boolean
  onCheck: () => void
  onSubmit: () => void
}

export function CreateDeploymentReviewPanel({
  appName,
  targetServerId,
  targetLabel,
  templateAppKey,
  templateLabel,
  templateIconUrl,
  templateInitial,
  exposureSummary,
  preflightVisible,
  helpVisible,
  checkResult,
  reviewMessages,
  portItems,
  activeChecking,
  activeSubmitting,
  srcUploading,
  checkDisabled,
  createDisabled,
  onCheck,
  onSubmit,
}: CreateDeploymentReviewPanelProps) {
  const [templateImgError, setTemplateImgError] = useState(false)
  const preflightIssueCount = reviewMessages.length + portItems.filter(item => item.conflict).length
  const hasValidationDetails = preflightVisible && (preflightIssueCount > 0 || Boolean(checkResult))
  const validationSummary = !preflightVisible
    ? 'Not checked yet'
    : !checkResult
      ? activeChecking || activeSubmitting
        ? 'Checking current inputs...'
        : 'No pre-flight result for the current inputs yet.'
      : checkResult.ok && preflightIssueCount === 0
        ? 'Ready to deploy'
        : `${preflightIssueCount || 1} issue${preflightIssueCount === 1 ? '' : 's'} found`

  return (
    <div>
      <div className="space-y-4 xl:sticky xl:top-6 xl:ml-3">
        <Card className="rounded-2xl border-slate-200 shadow-sm dark:border-slate-800">
          <CardHeader className="space-y-1 pb-3">
            <CardTitle className="text-sm">Summary</CardTitle>
            <CardDescription>Current deployment overview.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-4 pt-0 text-sm">
            <div className="space-y-2 rounded-lg bg-muted/10 p-3">
              <div className="flex items-start justify-between gap-3">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  App
                </span>
                <span className="text-right font-medium">{appName.trim() || 'Not set'}</span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Target
                </span>
                {targetServerId && targetServerId !== 'local' ? (
                  <Link
                    to="/resources/servers"
                    search={{ server: targetServerId } as never}
                    className="text-right text-primary hover:underline"
                  >
                    {targetLabel}
                  </Link>
                ) : (
                  <span className="text-right">{targetLabel}</span>
                )}
              </div>
              {templateLabel ? (
                <div className="flex items-start justify-between gap-3">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Template
                  </span>
                  <div className="flex items-center gap-2 text-right">
                    {templateIconUrl && !templateImgError ? (
                      <img
                        src={templateIconUrl}
                        alt={`${templateLabel} logo`}
                        className="h-4 w-4 shrink-0 rounded-sm bg-muted object-contain ring-1 ring-border/60"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={() => setTemplateImgError(true)}
                      />
                    ) : templateInitial ? (
                      <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-muted text-[9px] font-semibold text-foreground ring-1 ring-border/60">
                        {templateInitial}
                      </div>
                    ) : null}
                    {templateAppKey ? (
                      <Link
                        to="/store"
                        search={{ q: undefined, app: templateAppKey } as never}
                        className="text-primary hover:underline"
                      >
                        {templateLabel}
                      </Link>
                    ) : (
                      <span>{templateLabel}</span>
                    )}
                  </div>
                </div>
              ) : null}
              <div className="flex items-start justify-between gap-3">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Exposure
                </span>
                <span className="text-right">{exposureSummary}</span>
              </div>
            </div>

            <div className="space-y-2 rounded-lg bg-muted/10 p-3">
              <div className="flex items-start gap-2">
                {checkResult?.ok && preflightIssueCount === 0 ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                ) : hasValidationDetails ? (
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                ) : (
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0">
                  {!preflightVisible && !checkResult ? (
                    <TooltipProvider delayDuration={150}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="font-medium text-left text-foreground transition-colors hover:text-foreground/80"
                          >
                            {validationSummary}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs text-xs">
                          Check surfaces name, port, and disk issues before deployment.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : (
                    <div className="font-medium">{validationSummary}</div>
                  )}
                  {checkResult?.compose_project_name ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Resolved app name: {checkResult.compose_project_name}
                    </div>
                  ) : null}
                  {checkResult && !checkResult.ok && checkResult.message ? (
                    <div className="mt-1 text-xs text-muted-foreground">{checkResult.message}</div>
                  ) : null}
                </div>
              </div>
              {preflightVisible && preflightIssueCount > 0 ? (
                <div className="space-y-1.5 border-t pt-2 text-xs">
                  {reviewMessages.slice(0, 2).map(message => (
                    <div
                      key={message}
                      className="flex items-start gap-2 text-amber-700 dark:text-amber-400"
                    >
                      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <div>{message}</div>
                    </div>
                  ))}
                  {portItems
                    .filter(item => item.conflict)
                    .slice(0, 2)
                    .map(item => (
                      <div
                        key={`${item.protocol}-${item.port}`}
                        className="flex items-start gap-2 text-amber-700 dark:text-amber-400"
                      >
                        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <div>
                          Port <span className="font-mono">{item.port}</span> / {item.protocol} is{' '}
                          {item.occupied ? 'occupied' : 'reserved'}.
                        </div>
                      </div>
                    ))}
                </div>
              ) : null}
            </div>

            <div className="space-y-2 border-t pt-3">
              <Button
                variant="outline"
                onClick={onCheck}
                disabled={checkDisabled}
                className="h-10 w-full"
              >
                {activeChecking ? 'Checking...' : 'Check'}
              </Button>
              <Button
                onClick={onSubmit}
                disabled={createDisabled || srcUploading}
                className="h-10 w-full"
              >
                {activeSubmitting || srcUploading ? 'Creating...' : 'Create Deployment'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {helpVisible ? (
          <Card className="border-slate-200 dark:border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Help</CardTitle>
              <CardDescription>
                Short answers for the most common questions during deployment creation.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <details className="group rounded-md border bg-muted/20">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
                  <span>FAQ</span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div className="space-y-3 border-t px-3 py-3 text-xs text-muted-foreground">
                  <div>
                    <div className="font-medium text-foreground">Why run Check first?</div>
                    <div className="mt-1">
                      Check runs backend pre-flight validation and can surface blocking issues
                      before an action is created.
                    </div>
                  </div>
                  <div>
                    <div className="font-medium text-foreground">
                      Does Create Deployment run validation again?
                    </div>
                    <div className="mt-1">
                      Yes. The server performs final validation and normalization again when the
                      deployment action is created.
                    </div>
                  </div>
                  <div>
                    <div className="font-medium text-foreground">
                      What should I do if Check reports warnings?
                    </div>
                    <div className="mt-1">
                      Review the warnings, decide whether they are acceptable for this target, and
                      then continue with Create Deployment only if the result is acceptable.
                    </div>
                  </div>
                </div>
              </details>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  )
}
