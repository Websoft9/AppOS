import { CheckCircle2, ChevronDown, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { InstallPreflightResult } from '@/pages/deploy/actions/useActionsController'

type CreateDeploymentReviewPanelProps = {
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
  return (
    <div>
      <div className="space-y-4 xl:sticky xl:top-6">
        <Card className="border-slate-200 dark:border-slate-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Action</CardTitle>
            <CardDescription>Check first, then create when ready.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex flex-col gap-2">
              <Button variant="outline" onClick={onCheck} disabled={checkDisabled} className="h-10">
                {activeChecking ? 'Checking...' : 'Check'}
              </Button>
              <Button onClick={onSubmit} disabled={createDisabled || srcUploading} className="h-10">
                {activeSubmitting || srcUploading ? 'Creating...' : 'Create Deployment'}
              </Button>
            </div>

            {preflightVisible ? (
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Pre-flight checks
                </div>
                {checkResult ? (
                  <div className="space-y-2 text-xs">
                    <div className="flex items-start gap-2">
                      {checkResult.ok ? (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 text-amber-600" />
                      )}
                      <div className="min-w-0">
                        <div className="font-medium">{checkResult.message}</div>
                        {checkResult.compose_project_name ? (
                          <div className="text-xs text-muted-foreground">
                            Resolved app name: {checkResult.compose_project_name}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    {reviewMessages.map(message => (
                      <div
                        key={message}
                        className="flex items-start gap-2 text-amber-700 dark:text-amber-400"
                      >
                        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <div>{message}</div>
                      </div>
                    ))}
                    {portItems.map(item => (
                      <div key={`${item.protocol}-${item.port}`} className="flex items-start gap-2">
                        {item.conflict ? (
                          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                        ) : (
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                        )}
                        <div>
                          <span className="font-mono">
                            {item.port}/{item.protocol}
                          </span>
                          <span className="text-muted-foreground"> - </span>
                          <span
                            className={
                              item.conflict
                                ? 'text-amber-700 dark:text-amber-400'
                                : 'text-muted-foreground'
                            }
                          >
                            {item.conflict
                              ? `${item.occupied ? 'occupied' : 'reserved'}${item.occupied && item.reserved ? ' and reserved' : ''}`
                              : 'available'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">
                    {activeChecking || activeSubmitting
                      ? 'Checking current inputs...'
                      : 'No pre-flight result for the current inputs yet.'}
                  </div>
                )}
              </div>
            ) : null}
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
                      Check runs backend pre-flight validation and can surface blocking issues before
                      an action is created.
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
