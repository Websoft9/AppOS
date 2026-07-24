import { useMemo, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
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
import { useTranslation } from 'react-i18next'
import { getLocale } from '@/lib/i18n'
import { ActionControlDialog } from '@/pages/deploy/actions/ActionControlDialog'
import { DeleteActionDialog } from '@/pages/deploy/actions/DeleteActionDialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AppDetailModal } from '@/components/store/AppDetailModal'
import { ActionHomeView } from '@/pages/deploy/actions/ActionHomeView'
import { ActionListView } from '@/pages/deploy/actions/ActionListView'
import { formatTime, isActiveStatus, statusVariant } from '@/pages/deploy/actions/action-utils'
import type {
  ActionListSearch,
  ActionRecord,
  CreateDeploymentEntryMode,
} from '@/pages/deploy/actions/action-types'
import { useActionsController } from '@/pages/deploy/actions/useActionsController'

type DeployPageProps = {
  prefillMode?: string
  prefillSource?: string
  prefillAppId?: string
  prefillAppKey?: string
  prefillAppName?: string
  prefillServerId?: string
  listSearch?: ActionListSearch
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
  const { t } = useTranslation('deploy')
  const locale = getLocale()
  const {
    storeShortcuts,
    storePrimaryCategories,
    selectedStoreProduct,
    storeDetailOpen,
    setStoreDetailOpen,
    userApps,
    summary,
    latestOperations,
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
    pendingDelete,
    setPendingDelete,
    pendingActionControl,
    setPendingActionControl,
    actionControlSubmitting,
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
    deleteOperations,
    openActionControl,
    submitActionControl,
    canCancelAction,
    canForceFailAction,
    canResumeAction,
    fetchOperations,
  } = useActionsController({
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
    key: CreateDeploymentEntryMode
    title: string
    description: string
    icon: ReactNode
    action: () => void
    variant?: 'default' | 'outline'
  }> = useMemo(
    () => [
      {
        key: 'compose',
        title: t('customEntries.compose.title', { defaultValue: 'Compose File' }),
        description: t('customEntries.compose.description', {
          defaultValue:
            'Paste or review docker-compose YAML. This is the recommended path for standard app stacks.',
        }),
        icon: <FileCode2 className="h-4 w-4" />,
        action: () => openManualDialog('compose'),
        variant: 'outline',
      },
      {
        key: 'git-compose',
        title: t('customEntries.gitCompose.title', { defaultValue: 'Git Repository' }),
        description: t('customEntries.gitCompose.description', {
          defaultValue:
            'Pull a compose file from a repository branch or tag, then create the deployment task.',
        }),
        icon: <GitBranch className="h-4 w-4" />,
        action: () => openManualDialog('git-compose'),
        variant: 'outline',
      },
      {
        key: 'docker-command',
        title: t('customEntries.dockerCommand.title', { defaultValue: 'Docker Command' }),
        description: t('customEntries.dockerCommand.description', {
          defaultValue:
            'Convert a docker run command into compose-compatible content before submitting the deployment.',
        }),
        icon: <TerminalSquare className="h-4 w-4" />,
        action: () => openManualDialog('docker-command'),
        variant: 'outline',
      },
      {
        key: 'install-script',
        title: t('customEntries.installScript.title', { defaultValue: 'Source Packages' }),
        description: t('customEntries.installScript.description', {
          defaultValue:
            'Use user-provided compressed source packages such as zip or tar.gz as the deployment input source.',
        }),
        icon: <Wrench className="h-4 w-4" />,
        action: () => openManualDialog('install-script'),
        variant: 'outline',
      },
    ],
    [openManualDialog, t]
  )
  function renderActionMenu(item: ActionRecord) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('actions.moreActionsFor', {
              defaultValue: 'More actions for {{name}}',
              name: item.compose_project_name || item.id,
            })}
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => openOperationDetail(item.id)}>
            {t('actions.view', { defaultValue: 'View' })}
          </DropdownMenuItem>
          {canCancelAction(item) ? (
            <DropdownMenuItem onClick={() => openActionControl(item, 'cancel')}>
              {t('actions.cancel', { defaultValue: 'Cancel' })}
            </DropdownMenuItem>
          ) : null}
          {canForceFailAction(item) ? (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => openActionControl(item, 'force-fail')}
            >
              {t('actions.forceFail', { defaultValue: 'Force Fail' })}
            </DropdownMenuItem>
          ) : null}
          {canResumeAction(item) ? (
            <DropdownMenuItem onClick={() => openActionControl(item, 'resume')}>
              {t('actions.resume', { defaultValue: 'Resume' })}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            variant="destructive"
            disabled={isActiveStatus(item.status)}
            onClick={() => setPendingDelete([item])}
          >
            {t('actions.delete', { defaultValue: 'Delete' })}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {view === 'list'
              ? t('pages.activity', { defaultValue: 'Activity' })
              : t('pages.deployApplication', { defaultValue: 'Deploy Application' })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {view === 'list'
              ? t('page.listDescription', {
                  defaultValue: 'Browse deployment activity and open execution details.',
                })
              : t('page.homeDescription', {
                  defaultValue: 'Choose an application source and start deployment.',
                })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {view === 'home' ? (
            <>
              <Button
                size="icon"
                title={t('page.deploy', { defaultValue: 'Deploy' })}
                aria-label={t('page.deploy', { defaultValue: 'Deploy' })}
                onClick={() => openManualDialog('compose')}
              >
                <Plus className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                title={t('page.viewActivity', { defaultValue: 'View activity' })}
                aria-label={t('page.viewActivity', { defaultValue: 'View activity' })}
                asChild
              >
                <Link to="/activity" params={{} as never} search={{} as never}>
                  <List className="h-4 w-4" />
                </Link>
              </Button>
            </>
          ) : (
            <>
              <Button
                size="icon"
                title={t('page.deploy', { defaultValue: 'Deploy' })}
                aria-label={t('page.deploy', { defaultValue: 'Deploy' })}
                asChild
              >
                <Link to="/deploy" search={{} as never}>
                  <Plus className="h-4 w-4" />
                </Link>
              </Button>
              <Button
                variant="outline"
                size="icon"
                title={t('page.refresh', { defaultValue: 'Refresh' })}
                aria-label={t('page.refresh', { defaultValue: 'Refresh' })}
                onClick={() => void fetchOperations()}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {notice ? (
        <Alert variant={notice.variant} className="flex items-center justify-between gap-3 py-3">
          <AlertDescription className="truncate">{notice.message}</AlertDescription>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            aria-label={t('page.closeNotification', { defaultValue: 'Close notification' })}
            onClick={() => setNotice(null)}
          >
            <X className="h-4 w-4" />
          </Button>
        </Alert>
      ) : null}

      {view === 'list' && listSearch?.appId ? (
        <Alert>
          <AlertDescription className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <span>
              {t('page.scopedActivity', {
                defaultValue:
                  'Showing activity scoped to app {{appId}}. Search, sorting, and filters apply within this app only.',
                appId: listSearch.appId,
              })}
            </span>
            <Button variant="outline" size="sm" asChild>
              <Link to="/activity" params={{} as never} search={{} as never}>
                {t('page.clearAppScope', { defaultValue: 'Clear App Scope' })}
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {view === 'list' ? (
        <ActionListView
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
        <ActionHomeView
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

      <DeleteActionDialog
        operations={pendingDelete}
        onOpenChange={open => {
          if (!open) setPendingDelete([])
        }}
        onConfirm={operations => {
          void deleteOperations(operations.map(item => item.id))
        }}
      />

      <ActionControlDialog
        pending={pendingActionControl}
        busy={actionControlSubmitting}
        onOpenChange={open => {
          if (!open) setPendingActionControl(null)
        }}
        onConfirm={pending => {
          void submitActionControl(pending)
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
