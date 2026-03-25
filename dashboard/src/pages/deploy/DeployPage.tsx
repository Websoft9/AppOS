import { useMemo, type ReactNode } from 'react'
import {
  FileCode2,
  GitBranch,
  List,
  MoreVertical,
  Plus,
  RefreshCw,
  TerminalSquare,
  Wrench,
  X,
} from 'lucide-react'
import { getLocale } from '@/lib/i18n'
import { DeleteOperationDialog } from '@/pages/deploy/operations/DeleteOperationDialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AppDetailModal } from '@/components/store/AppDetailModal'
import { OperationHomeView } from '@/pages/deploy/operations/OperationHomeView'
import { OperationListView } from '@/pages/deploy/operations/OperationListView'
import { buildOperationListHref, formatTime, isActiveStatus, statusVariant } from '@/pages/deploy/operations/operation-utils'
import { GitDeploymentDialog } from '@/pages/deploy/entry/GitDeploymentDialog'
import { ManualDeploymentDialog } from '@/pages/deploy/entry/ManualDeploymentDialog'
import type { OperationListSearch, OperationRecord, ManualEntryMode } from '@/pages/deploy/operations/operation-types'
import { useOperationsController } from '@/pages/deploy/operations/useOperationsController'

type DeployPageProps = {
  prefillMode?: string
  prefillSource?: string
  prefillAppId?: string
  prefillAppKey?: string
  prefillAppName?: string
  prefillServerId?: string
  listSearch?: OperationListSearch
  view?: 'home' | 'list'
}

const PAGE_SIZE_OPTIONS = [15, 30, 60, 90] as const

export function DeployPage({
  prefillMode,
  prefillSource,
  prefillAppId,
  prefillAppKey,
  prefillAppName,
  prefillServerId,
  listSearch,
  view = 'home',
}: DeployPageProps) {
  const locale = getLocale()
  const {
    servers,
    storeShortcuts,
    storePrimaryCategories,
    selectedStoreProduct,
    storeDetailOpen,
    setStoreDetailOpen,
    userApps,
    summary,
    latestOperations,
    manualDialogCopy,
    filterOptions,
    pagedItems,
    totalPages,
    search,
    setSearch,
    loading,
    page,
    setPage,
    pageSize,
    setPageSize,
    selectedIds,
    selectedCount,
    selectedActiveCount,
    activeFilterChips,
    sortField,
    sortDir,
    excludeStatus,
    excludeSource,
    excludeServer,
    setExcludeStatus,
    setExcludeSource,
    setExcludeServer,
    notice,
    setNotice,
    prefillLoading,
    prefillReady,
    createOpen,
    setCreateOpen,
    gitCreateOpen,
    setGitCreateOpen,
    serverId,
    setServerId,
    projectName,
    setProjectName,
    compose,
    setCompose,
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
    pendingDelete,
    setPendingDelete,
    handleSort,
    toggleOperationSelection,
    togglePageSelection,
    allPageSelected,
    somePageSelected,
    removeFilterChip,
    clearAllFilters,
    openDeleteDialogForIds,
    openStoreShortcut,
    deployFromStoreProduct,
    openManualDialog,
    openOperationDetail,
    openLatestOperationDetail,
    getUserLabel,
    getServerLabel,
    getServerHost,
    submitManualOperation,
    submitGitOperation,
    deleteOperations,
    fetchOperations,
  } = useOperationsController({
    prefillMode,
    prefillSource,
    prefillAppId,
    prefillAppKey,
    prefillAppName,
    prefillServerId,
    listSearch,
    view,
  })

  const customEntries: Array<{
    key: ManualEntryMode | 'git-compose'
    title: string
    description: string
    icon: ReactNode
    action: () => void
    variant?: 'default' | 'outline'
  }> = useMemo(() => [
    {
      key: 'compose',
      title: 'Compose File',
      description: 'Paste or review docker-compose YAML. This is the recommended path for standard app stacks.',
      icon: <FileCode2 className="h-4 w-4" />,
      action: () => openManualDialog('compose'),
      variant: 'default',
    },
    {
      key: 'git-compose',
      title: 'Git Repository',
      description: 'Pull a compose file from a repository branch or tag, then create the deployment task.',
      icon: <GitBranch className="h-4 w-4" />,
      action: () => setGitCreateOpen(true),
      variant: 'outline',
    },
    {
      key: 'docker-command',
      title: 'Docker Command',
      description: 'Convert a docker run command into compose-compatible content before submitting the deployment.',
      icon: <TerminalSquare className="h-4 w-4" />,
      action: () => openManualDialog('docker-command'),
      variant: 'outline',
    },
    {
      key: 'install-script',
      title: 'Source Packages',
      description: 'Use user-provided compressed source packages such as zip or tar.gz as the deployment input source.',
      icon: <Wrench className="h-4 w-4" />,
      action: () => openManualDialog('install-script'),
      variant: 'outline',
    },
  ], [openManualDialog, setGitCreateOpen])

  const operationListHref = buildOperationListHref()

  function renderActionMenu(item: OperationRecord) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`More actions for ${item.compose_project_name || item.id}`}>
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => openOperationDetail(item.id)}>View</DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            disabled={isActiveStatus(item.status)}
            onClick={() => setPendingDelete([item])}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{view === 'list' ? 'Action History' : 'Deploy Application'}</h1>
          <p className="text-sm text-muted-foreground">{view === 'list' ? 'Browse lifecycle actions and open execution details.' : 'Choose an application source and start deployment.'}</p>
        </div>
        <div className="flex items-center gap-2">
          {view === 'home' ? (
            <>
              <Button size="icon" title="Deploy" aria-label="Deploy" onClick={() => openManualDialog('compose')}>
                <Plus className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" title="View actions" aria-label="View actions" asChild>
                <a href={operationListHref}>
                  <List className="h-4 w-4" />
                </a>
              </Button>
            </>
          ) : (
            <>
              <Button size="icon" title="Deploy" aria-label="Deploy" asChild>
                <a href="/deploy">
                  <Plus className="h-4 w-4" />
                </a>
              </Button>
              <Button variant="outline" size="icon" title="Refresh" aria-label="Refresh" onClick={() => void fetchOperations()}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {notice ? (
        <Alert variant={notice.variant} className="flex items-center justify-between gap-3 py-3">
          <AlertDescription className="truncate">{notice.message}</AlertDescription>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Close notification" onClick={() => setNotice(null)}>
            <X className="h-4 w-4" />
          </Button>
        </Alert>
      ) : null}

      {view === 'list' ? (
        <OperationListView
          search={search}
          onSearchChange={setSearch}
          loading={loading}
          pagedItems={pagedItems}
          page={page}
          totalPages={totalPages}
          pageSize={pageSize}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          onPageSizeChange={value => {
            setPageSize(value as (typeof PAGE_SIZE_OPTIONS)[number])
            setPage(1)
          }}
          onPreviousPage={() => setPage(current => current - 1)}
          onNextPage={() => setPage(current => current + 1)}
          summary={summary}
          sortField={sortField}
          sortDir={sortDir}
          onSort={handleSort}
          filterOptions={filterOptions}
          excludeStatus={excludeStatus}
          excludeSource={excludeSource}
          excludeServer={excludeServer}
          onStatusFilterChange={setExcludeStatus}
          onSourceFilterChange={setExcludeSource}
          onServerFilterChange={setExcludeServer}
          activeFilterChips={activeFilterChips}
          onRemoveFilterChip={removeFilterChip}
          onClearAllFilters={clearAllFilters}
          getUserLabel={getUserLabel}
          getServerLabel={getServerLabel}
          formatTime={formatTime}
          statusVariant={statusVariant}
          selectedIds={selectedIds}
          selectedCount={selectedCount}
          selectedActiveCount={selectedActiveCount}
          onToggleOperationSelection={toggleOperationSelection}
          onTogglePageSelection={togglePageSelection}
          allPageSelected={allPageSelected}
          somePageSelected={somePageSelected}
          onDeleteSelected={() => openDeleteDialogForIds(Array.from(selectedIds))}
          onOpenOperation={openOperationDetail}
          renderActionMenu={renderActionMenu}
        />
      ) : (
        <OperationHomeView
          prefillLoading={prefillLoading}
          prefillMode={prefillMode}
          prefillAppName={prefillAppName}
          prefillAppId={prefillAppId}
          prefillAppKey={prefillAppKey}
          prefillSource={prefillSource}
          prefillReady={prefillReady}
          storeShortcuts={storeShortcuts}
          customEntries={customEntries}
          latestOperations={latestOperations}
          loading={loading}
          onOpenStoreShortcut={openStoreShortcut}
          getUserLabel={getUserLabel}
          getServerLabel={getServerLabel}
          getServerHost={getServerHost}
          formatTime={formatTime}
          statusVariant={statusVariant}
          onOpenOperation={openLatestOperationDetail}
          renderActionMenu={renderActionMenu}
        />
      )}

      <ManualDeploymentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        dialogCopy={manualDialogCopy}
        servers={servers}
        serverId={serverId}
        onServerIdChange={setServerId}
        projectName={projectName}
        onProjectNameChange={setProjectName}
        compose={compose}
        onComposeChange={setCompose}
        submitting={submitting}
        onSubmit={() => void submitManualOperation()}
      />

      <GitDeploymentDialog
        open={gitCreateOpen}
        onOpenChange={setGitCreateOpen}
        servers={servers}
        serverId={serverId}
        onServerIdChange={setServerId}
        projectName={gitProjectName}
        onProjectNameChange={setGitProjectName}
        repositoryUrl={gitRepositoryUrl}
        onRepositoryUrlChange={setGitRepositoryUrl}
        gitRef={gitRef}
        onGitRefChange={setGitRef}
        composePath={gitComposePath}
        onComposePathChange={setGitComposePath}
        authHeaderName={gitAuthHeaderName}
        onAuthHeaderNameChange={setGitAuthHeaderName}
        authHeaderValue={gitAuthHeaderValue}
        onAuthHeaderValueChange={setGitAuthHeaderValue}
        submitting={gitSubmitting}
        onSubmit={() => void submitGitOperation()}
      />

      <DeleteOperationDialog
        operations={pendingDelete}
        onOpenChange={open => {
          if (!open) setPendingDelete([])
        }}
        onConfirm={operations => {
          void deleteOperations(operations.map(item => item.id))
        }}
      />

      <AppDetailModal
        product={selectedStoreProduct}
        primaryCategories={storePrimaryCategories}
        locale={locale}
        open={storeDetailOpen}
        onClose={() => setStoreDetailOpen(false)}
        userApps={userApps}
        showDeploy
        onDeploy={() => {
          if (selectedStoreProduct) deployFromStoreProduct(selectedStoreProduct)
        }}
      />
    </div>
  )
}
