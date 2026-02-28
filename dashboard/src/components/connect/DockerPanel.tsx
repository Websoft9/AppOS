import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { RotateCw, TerminalSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { pb } from '@/lib/pb'
import { getApiErrorMessage } from '@/lib/api-error'
import { ContainersTab } from '@/components/docker/ContainersTab'
import { ImagesTab } from '@/components/docker/ImagesTab'
import { NetworksTab } from '@/components/docker/NetworksTab'
import { VolumesTab } from '@/components/docker/VolumesTab'
import { ComposeTab } from '@/components/docker/ComposeTab'
import { TerminalPanel } from '@/components/connect/TerminalPanel'
import { cn } from '@/lib/utils'

interface HostEntry {
  id: string
  label: string
  status: 'online' | 'offline'
  reason?: string
}

interface DockerPanelProps {
  serverId: string
  className?: string
  onOpenFilesAtPath?: (targetPath: string, lockedRootPath: string) => void
}

export function DockerPanel({ serverId, className, onOpenFilesAtPath }: DockerPanelProps) {
  const queryClient = useQueryClient()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [hosts, setHosts] = useState<HostEntry[]>([])
  const [refreshSignal, setRefreshSignal] = useState(0)
  const [activeTab, setActiveTab] = useState<'containers' | 'images' | 'volumes' | 'networks' | 'compose'>('containers')
  const [containerFilter, setContainerFilter] = useState('')
  const [containerFilterNames, setContainerFilterNames] = useState<string[]>([])
  const [composeFilter, setComposeFilter] = useState('')
  const [terminalContainerId, setTerminalContainerId] = useState<string | null>(null)
  const [terminalShell, setTerminalShell] = useState<string>('/bin/sh')
  const [manualShell, setManualShell] = useState(false)
  const [lockedHeight, setLockedHeight] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)

  useEffect(() => {
    pb.send('/api/ext/docker/servers', { method: 'GET' })
      .then((res) => {
        if (Array.isArray(res)) setHosts(res as HostEntry[])
      })
      .catch(() => setHosts([]))
  }, [])

  const activeHost = hosts.find((h) => h.id === serverId)
  const dockerDisabled = activeHost ? activeHost.status !== 'online' : false
  const dockerDisabledReason = activeHost?.reason || `${activeHost?.label ?? 'server'} is offline`

  useEffect(() => {
    const container = document.querySelector('[data-docker-scroll-root="true"]') as HTMLElement | null
    if (container) container.scrollTop = 0
  }, [activeTab])

  useEffect(() => {
    const node = rootRef.current
    if (!node) return

    const syncHeight = () => {
      const parent = node.parentElement
      if (!parent) return
      const next = Math.max(0, Math.floor(parent.clientHeight))
      if (next > 0) setLockedHeight(next)
    }

    syncHeight()

    const parent = node.parentElement
    const observer = parent ? new ResizeObserver(syncHeight) : null
    if (parent && observer) observer.observe(parent)
    window.addEventListener('resize', syncHeight)

    const t1 = window.setTimeout(syncHeight, 0)
    const t2 = window.setTimeout(syncHeight, 100)
    const t3 = window.setTimeout(syncHeight, 260)

    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.clearTimeout(t3)
      window.removeEventListener('resize', syncHeight)
      observer?.disconnect()
    }
  }, [activeTab, refreshSignal, serverId])

  return (
    <div
      ref={rootRef}
      className={cn('flex flex-col gap-3 h-full min-h-0 min-w-0 overflow-hidden', className)}
      style={lockedHeight ? { height: `${lockedHeight}px`, maxHeight: `${lockedHeight}px` } : undefined}
    >
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'containers' | 'images' | 'volumes' | 'networks' | 'compose')} className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden">
        <div className="flex items-center gap-2 shrink-0">
          <TabsList>
            <TabsTrigger value="containers" disabled={dockerDisabled}>Containers</TabsTrigger>
            <TabsTrigger value="images" disabled={dockerDisabled}>Images</TabsTrigger>
            <TabsTrigger value="volumes" disabled={dockerDisabled}>Volumes</TabsTrigger>
            <TabsTrigger value="networks" disabled={dockerDisabled}>Networks</TabsTrigger>
            <TabsTrigger value="compose" disabled={dockerDisabled}>Compose</TabsTrigger>
          </TabsList>

          <div className="flex-1" />

          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={async () => {
              setRefreshing(true)
              setRefreshError(null)
              try {
                await Promise.all([
                  queryClient.invalidateQueries({ queryKey: ['docker', 'containers', serverId] }),
                  queryClient.invalidateQueries({ queryKey: ['docker', 'containers', 'details', serverId] }),
                  queryClient.invalidateQueries({ queryKey: ['docker', 'images', serverId] }),
                  queryClient.invalidateQueries({ queryKey: ['docker', 'networks', serverId] }),
                  queryClient.invalidateQueries({ queryKey: ['docker', 'volumes', serverId] }),
                  queryClient.invalidateQueries({ queryKey: ['docker', 'compose', serverId] }),
                  queryClient.refetchQueries({ queryKey: ['docker', 'containers', serverId], type: 'active' }, { throwOnError: true }),
                  queryClient.refetchQueries({ queryKey: ['docker', 'images', serverId], type: 'active' }, { throwOnError: true }),
                  queryClient.refetchQueries({ queryKey: ['docker', 'networks', serverId], type: 'active' }, { throwOnError: true }),
                  queryClient.refetchQueries({ queryKey: ['docker', 'volumes', serverId], type: 'active' }, { throwOnError: true }),
                  queryClient.refetchQueries({ queryKey: ['docker', 'compose', serverId], type: 'active' }, { throwOnError: true }),
                ])
              } catch (err) {
                setRefreshError(getApiErrorMessage(err, 'Failed to refresh Docker data'))
              } finally {
                setRefreshSignal((signal) => signal + 1)
                setRefreshing(false)
              }
            }}
            disabled={dockerDisabled || refreshing}
          >
            <RotateCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
            Refresh
          </Button>
        </div>

        {dockerDisabled && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Docker is disabled for current server: {dockerDisabledReason}
          </div>
        )}

        {refreshError && (
          <Alert variant="destructive">
            <AlertDescription>{refreshError}</AlertDescription>
          </Alert>
        )}

        <TabsContent value="containers" className="mt-0 h-0 flex-1 min-h-0 min-w-0 overflow-hidden">
          <ContainersTab
            serverId={serverId}
            filterPreset={containerFilter}
            includeNames={containerFilterNames}
            onClearFilterPreset={() => setContainerFilter('')}
            onClearIncludeNames={() => setContainerFilterNames([])}
            onOpenComposeFilter={(name) => {
              if (!name || name === '-') return
              setComposeFilter(name)
              setActiveTab('compose')
            }}
            onOpenTerminal={(id) => setTerminalContainerId(id)}
          />
        </TabsContent>
        <TabsContent value="images" className="mt-0 h-0 flex-1 min-h-0 min-w-0 overflow-hidden">
          <ImagesTab serverId={serverId} />
        </TabsContent>
        <TabsContent value="volumes" className="mt-0 h-0 flex-1 min-h-0 min-w-0 overflow-hidden">
          <VolumesTab
            serverId={serverId}
            refreshSignal={refreshSignal}
            onOpenContainerFilter={(_name, containerNames) => {
              setContainerFilter('')
              setContainerFilterNames(containerNames)
              setActiveTab('containers')
            }}
            onOpenVolumePath={(targetPath, lockedRootPath) => {
              onOpenFilesAtPath?.(targetPath, lockedRootPath)
            }}
          />
        </TabsContent>
        <TabsContent value="networks" className="mt-0 h-0 flex-1 min-h-0 min-w-0 overflow-hidden">
          <NetworksTab serverId={serverId} refreshSignal={refreshSignal} />
        </TabsContent>
        <TabsContent value="compose" className="mt-0 h-0 flex-1 min-h-0 min-w-0 overflow-hidden">
          <ComposeTab
            serverId={serverId}
            filterPreset={composeFilter}
            onClearFilterPreset={() => setComposeFilter('')}
            onOpenContainerFilter={(containerName) => {
              if (!containerName) return
              setContainerFilter(containerName)
              setContainerFilterNames([])
              setActiveTab('containers')
            }}
          />
        </TabsContent>
      </Tabs>

      <Dialog
        open={!!terminalContainerId}
        onOpenChange={(open) => {
          if (!open) setTerminalContainerId(null)
        }}
      >
        <DialogContent className="sm:max-w-4xl h-[80vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-5 pt-4 pb-2">
            <DialogTitle className="flex items-center gap-2 pr-8">
              <TerminalSquare className="h-5 w-5" />
              Container Terminal
              <span className="text-xs font-mono text-muted-foreground ml-2">
                {terminalContainerId?.slice(0, 12)}
              </span>
            </DialogTitle>
            <div className="mt-2 flex items-center gap-2">
              <div className="flex items-center gap-2 mr-1">
                <Checkbox
                  id="docker-manual-shell"
                  checked={manualShell}
                  onCheckedChange={(value) => setManualShell(!!value)}
                  className="h-3.5 w-3.5"
                />
                <label htmlFor="docker-manual-shell" className="text-xs text-muted-foreground cursor-pointer">
                  Manual shell
                </label>
              </div>
              {manualShell && ['/bin/sh', '/bin/bash', '/bin/zsh'].map((shell) => (
                <Button
                  key={shell}
                  variant={terminalShell === shell ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-6 px-2 text-xs font-mono"
                  onClick={() => setTerminalShell(shell)}
                >
                  {shell.split('/').pop()}
                </Button>
              ))}
            </div>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            {terminalContainerId && (
              <TerminalPanel
                key={`${terminalContainerId}-${manualShell ? terminalShell : 'auto'}`}
                containerId={terminalContainerId}
                dockerServerId={serverId}
                shell={manualShell ? terminalShell : undefined}
                className="h-full"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
