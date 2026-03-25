import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowRight, CircleHelp, Ellipsis, Store, Wrench } from 'lucide-react'
import { getIconUrl } from '@/lib/store-api'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { buildOperationListHref } from '@/pages/deploy/operations/operation-utils'

type StoreShortcut = {
  key: string
  trademark: string
  logo?: {
    imageurl: string
  }
}

type LatestOperationItem = {
  id: string
  compose_project_name: string
  source: string
  status: string
  updated: string
}

type ManualEntryMode = 'compose' | 'docker-command' | 'install-script' | 'store-prefill' | 'installed-prefill'

type CustomEntry = {
  key: ManualEntryMode | 'git-compose'
  title: string
  description: string
  icon: React.ReactNode
  action: () => void
  variant?: 'default' | 'outline'
}

type OperationHomeViewProps<TOperation extends LatestOperationItem> = {
  prefillLoading: boolean
  prefillMode?: string
  prefillAppName?: string
  prefillAppId?: string
  prefillAppKey?: string
  prefillSource?: string
  prefillReady: string
  storeShortcuts: StoreShortcut[]
  customEntries: CustomEntry[]
  latestOperations: TOperation[]
  loading: boolean
  onOpenStoreShortcut: (app: StoreShortcut) => void
  getUserLabel: (item: TOperation) => string
  getServerLabel: (item: TOperation) => string
  getServerHost: (item: TOperation) => string
  formatTime: (value?: string) => string
  statusVariant: (status: string) => 'default' | 'secondary' | 'destructive' | 'outline'
  onOpenOperation: (id: string) => void
  renderActionMenu: (item: TOperation) => React.ReactNode
}

const STORE_GRID_SLOTS = 16

function TitleHelp({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={text}
        >
          <CircleHelp className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className="max-w-[240px] leading-5">
        {text}
      </TooltipContent>
    </Tooltip>
  )
}

function AppLauncherIcon({ app, onOpen }: { app: StoreShortcut; onOpen: (app: StoreShortcut) => void }) {
  const primarySrc = app.logo?.imageurl?.trim() || getIconUrl(app.key)
  const fallbackSrc = getIconUrl(app.key)
  const [src, setSrc] = useState(primarySrc)
  const [usedFallback, setUsedFallback] = useState(primarySrc === fallbackSrc)

  useEffect(() => {
    setSrc(primarySrc)
    setUsedFallback(primarySrc === fallbackSrc)
  }, [fallbackSrc, primarySrc])

  const initials = (app.trademark || app.key).trim().slice(0, 2).toUpperCase()

  return (
    <button
      type="button"
      title={app.trademark}
      className="group flex min-w-0 flex-col items-center gap-2 rounded-xl px-1 py-2 text-center transition-colors hover:bg-sky-100/60 dark:hover:bg-sky-500/10"
      onClick={() => onOpen(app)}
    >
      <div className="flex h-12 w-12 items-center justify-center overflow-hidden">
        {src ? (
          <img
            src={src}
            alt={app.trademark}
            className="h-10 w-10 object-contain"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => {
              if (!usedFallback && fallbackSrc && src !== fallbackSrc) {
                setSrc(fallbackSrc)
                setUsedFallback(true)
                return
              }
              setSrc('')
            }}
          />
        ) : (
          <span className="text-sm font-semibold tracking-wide text-slate-600 dark:text-slate-300">{initials}</span>
        )}
      </div>
      <span className="line-clamp-2 min-h-[2rem] text-[11px] font-medium leading-4 text-slate-700 dark:text-slate-200">{app.trademark}</span>
    </button>
  )
}

function MoreAppsTile() {
  return (
    <Link to="/store" className="group flex min-w-0 flex-col items-center gap-2 rounded-xl px-1 py-2 text-center transition-colors hover:bg-sky-100/60 dark:hover:bg-sky-500/10">
      <span className="flex h-12 w-12 items-center justify-center text-slate-500 transition-colors group-hover:text-sky-700 dark:text-slate-400 dark:group-hover:text-sky-300">
        <Ellipsis className="h-8 w-8" />
      </span>
      <span className="line-clamp-2 min-h-[2rem] text-[11px] font-medium leading-4 text-slate-700 dark:text-slate-200">More Apps</span>
    </Link>
  )
}

export function OperationHomeView<TOperation extends LatestOperationItem>({
  prefillLoading,
  prefillMode,
  prefillAppName,
  prefillAppId,
  prefillAppKey,
  prefillSource,
  prefillReady,
  storeShortcuts,
  customEntries,
  latestOperations,
  loading,
  onOpenStoreShortcut,
  getUserLabel,
  getServerLabel,
  getServerHost,
  formatTime,
  statusVariant,
  onOpenOperation,
  renderActionMenu,
}: OperationHomeViewProps<TOperation>) {
  return (
    <div className="space-y-6">
      {prefillLoading ? (
        <Alert>
          <AlertDescription>
            {prefillMode === 'installed'
              ? `Loading current compose config for ${prefillAppName || prefillAppId}...`
              : `Loading deploy template for ${prefillAppName || prefillAppKey}...`}
          </AlertDescription>
        </Alert>
      ) : null}
      {prefillReady ? (
        <Alert>
          <AlertDescription>
            {prefillMode === 'installed'
              ? `${prefillSource === 'upgrade' ? 'Upgrade' : 'Redeploy'} handoff is ready for ${prefillReady}. The shared deployment form has been prefilled with the current installed compose config.`
              : `App Store handoff is ready for ${prefillReady}. The shared deployment form has been prefilled with its compose template.`}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-sky-200 bg-linear-to-br from-sky-50 via-white to-cyan-50/70 dark:border-sky-900/60 dark:from-slate-950 dark:via-slate-900 dark:to-sky-950/40">
          <CardHeader className="space-y-3">
            <div className="flex items-center gap-2 text-lg font-semibold text-slate-950 dark:text-slate-50">
              <Store className="h-4 w-4 text-sky-600 dark:text-sky-300" />
              <span>Install from Store</span>
              <TitleHelp text="Use a Store application shortcut for a fast deploy handoff, or open App Store to browse more applications." />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-4 gap-x-2 gap-y-3 sm:grid-cols-8">
              {storeShortcuts.length === 0
                ? Array.from({ length: STORE_GRID_SLOTS }).map((_, index) => (
                    <div key={`store-placeholder-${index}`} className="h-[76px] rounded-xl bg-white/30 dark:bg-white/5" />
                  ))
                : storeShortcuts.map(app => (
                    <AppLauncherIcon key={app.key} app={app} onOpen={onOpenStoreShortcut} />
                  ))}
              {storeShortcuts.length > 0 ? <MoreAppsTile /> : null}
            </div>
            <div className="flex flex-col gap-3 rounded-2xl border border-sky-100 bg-white/70 px-4 py-3 dark:border-sky-900/50 dark:bg-white/5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100">Need more templates?</div>
                <div className="text-xs text-muted-foreground">Browse 300+ installable app templates, then hand off directly into deployment.</div>
              </div>
              <Button asChild className="justify-between sm:min-w-[180px]">
                <Link to="/store">
                  Open App Store
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950/60">
          <CardHeader className="space-y-3">
            <div className="flex items-center gap-2 text-lg font-semibold text-slate-950 dark:text-slate-50">
              <Wrench className="h-4 w-4 text-slate-700 dark:text-slate-300" />
              <span>Custom Deployment</span>
              <TitleHelp text="Use Compose, a Git repository, a Docker command, or user-provided source packages such as zip and tar.gz as deployment inputs." />
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2">
              {customEntries.map(item => (
                <button
                  key={item.key}
                  type="button"
                  className={cn(
                    'flex h-full flex-col rounded-2xl border px-4 py-4 text-left transition-colors',
                    item.variant === 'default'
                      ? 'border-sky-600 bg-sky-600 text-white hover:bg-sky-500 dark:border-sky-500 dark:bg-sky-500 dark:hover:bg-sky-400'
                      : 'border-slate-200 bg-slate-50/70 hover:border-slate-300 hover:bg-slate-100/80 dark:border-slate-800 dark:bg-slate-900/70 dark:hover:border-slate-700 dark:hover:bg-slate-900'
                  )}
                  onClick={item.action}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className={cn('inline-flex h-9 w-9 items-center justify-center rounded-xl', item.variant === 'default' ? 'bg-white/15 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200 dark:bg-slate-950 dark:text-slate-200 dark:ring-slate-700')}>
                      {item.icon}
                    </span>
                    <ArrowRight className={cn('h-4 w-4', item.variant === 'default' ? 'text-white/80' : 'text-slate-400 dark:text-slate-500')} />
                  </div>
                  <div className={cn('mt-4 text-sm font-semibold', item.variant === 'default' ? 'text-white' : 'text-slate-950 dark:text-slate-100')}>
                    {item.title}
                  </div>
                  <div className={cn('mt-1 text-xs leading-5', item.variant === 'default' ? 'text-white/80' : 'text-muted-foreground dark:text-slate-400')}>
                    {item.description}
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Latest Actions</CardTitle>
          <Button variant="outline" size="sm" asChild>
            <a href={buildOperationListHref()}>View action history</a>
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">Loading actions...</div>
          ) : latestOperations.length === 0 ? (
            <div className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground">No action records yet.</div>
          ) : (
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Action</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Server</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead className="w-[84px] text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {latestOperations.map(item => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="min-w-0">
                          <button
                            type="button"
                            className="truncate font-medium text-foreground hover:text-primary hover:underline"
                            onClick={() => onOpenOperation(item.id)}
                          >
                            {item.compose_project_name || item.id}
                          </button>
                          <div className="mt-1 font-mono text-xs text-muted-foreground">{item.id}</div>
                        </div>
                      </TableCell>
                      <TableCell>{getUserLabel(item)}</TableCell>
                      <TableCell>{item.source}</TableCell>
                      <TableCell>
                        <div className="font-medium">{getServerLabel(item)}</div>
                        <div className="text-xs text-muted-foreground">{getServerHost(item)}</div>
                      </TableCell>
                      <TableCell><Badge variant={statusVariant(item.status)}>{item.status}</Badge></TableCell>
                      <TableCell>{formatTime(item.updated)}</TableCell>
                      <TableCell className="text-right">{renderActionMenu(item)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}