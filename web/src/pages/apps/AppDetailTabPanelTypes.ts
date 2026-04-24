import type { MutableRefObject, RefObject } from 'react'
import type { ServerConnectionPresentationSpec } from '@/components/servers/server-connection-presentation'
import type { ActionRecord } from '@/pages/deploy/actions/action-types'
import type {
  BackupProjection,
  DockerVolume,
  ResourceInstance,
  RuntimeContainer,
  RuntimeContainerStats,
} from '@/pages/apps/app-detail-utils'
import type { AppExposure, AppInstance, AppLogsResponse, AppRelease } from '@/pages/apps/types'

export type DisplaySectionProps = {
  iconValue: string
  labelValue: string
  tagsValue: string
  tags: string[]
  saving: boolean
  hasChanges: boolean
  onIconChange: (value: string) => void
  onLabelChange: (value: string) => void
  onTagsChange: (value: string) => void
  onSave: () => void
  onReset: () => void
}

export type OverviewTabProps = {
  app: AppInstance
  currentRelease?: AppRelease
  releases: AppRelease[]
  openReleaseDetail: (release: AppRelease) => void
  serverDisplayName: string
  canOpenServerDetail: boolean
  openServerDetail: () => void
  primaryExposure?: AppExposure
  exposures: AppExposure[]
  serverConnectionPresentation: ServerConnectionPresentationSpec | null
  openOperationStatus: () => void
  setTab: (value: string) => void
  displaySection: DisplaySectionProps
}

export type AccessTabProps = {
  app: AppInstance
  primaryExposure?: AppExposure
  effectiveServerHost: string
  primaryDomainUrl: string
  publicAccessUrl: string
  editingAccess: boolean
  accessHintsPresent: boolean
  accessUsernameDraft: string
  accessSecretHintDraft: string
  accessRetrievalMethodDraft: string
  accessNotesDraft: string
  hasAccessDraftChanges: boolean
  accessSaving: boolean
  setEditingAccess: (value: boolean) => void
  setAccessUsernameDraft: (value: string) => void
  setAccessSecretHintDraft: (value: string) => void
  setAccessRetrievalMethodDraft: (value: string) => void
  setAccessNotesDraft: (value: string) => void
  saveAccessHints: () => void
  cancelAccessEditing: () => void
}

export type ActionsTabProps = {
  app: AppInstance
  actionsLoading: boolean
  actionSearch: string
  setActionSearch: (value: string) => void
  actionStatusFilter: string
  setActionStatusFilter: (value: string) => void
  actionTypeFilter: string
  setActionTypeFilter: (value: string) => void
  actionStatusOptions: string[]
  actionTypeOptions: string[]
  scopedActions: ActionRecord[]
  filteredScopedActions: ActionRecord[]
  fetchActionHistory: () => void
  openAllActionsForApp: () => void
  openOperationStatus: () => void
  buildActionDetailHref: (actionId: string) => string
}

export type RuntimeTabProps = {
  app: AppInstance
  runtimeSummary: { total: number; running: number; cpu: number; memory: number }
  runtimeLoading: boolean
  runtimeLoaded: boolean
  relatedRuntimeContainers: RuntimeContainer[]
  runtimeStats: Record<string, RuntimeContainerStats>
  canOpenServerWorkspace: boolean
  openRuntimeContainerLogs: (container: RuntimeContainer) => void
  openServerWorkspace: (options?: {
    panel?: 'none' | 'files' | 'docker'
    path?: string
    lockedRoot?: string
  }) => void
  projectNameCandidates: string[]
  setTab: (value: string) => void
}

export type ComposeTabProps = {
  app: AppInstance
  configLoading: boolean
  fetchConfig: (force?: boolean) => void
  validating: boolean
  validateDraft: () => void
  rollingBack: boolean
  rollbackConfig: () => void
  rollbackMeta: { available: boolean; savedAt?: string; sourceAction?: string }
  openIacWindow: () => void
  saveDisabled: boolean
  saving: boolean
  saveConfig: () => void
  configText: string
  setConfigText: (value: string) => void
  validation: { valid: boolean; message: string; validatedContent: string } | null
  envFilePath: string
  envFileLoading: boolean
  fetchEnvFile: (path: string) => void
  hasEnvFileChanges: boolean
  envFileSaving: boolean
  saveEnvFile: (path: string) => void
  envFileLoaded: boolean
  envFileError: string
  envFileText: string
  setEnvFileText: (value: string) => void
  diffText: string
}

export type ObservabilityTabProps = {
  app: AppInstance
  logsLoading: boolean
  fetchLogs: (showSpinner?: boolean) => void
  runtimeLoaded: boolean
  runtimeSummary: { total: number; running: number; cpu: number; memory: number }
  latestScopedAction?: ActionRecord
  primaryExposure?: AppExposure
  logs: AppLogsResponse | null
  logViewportRef: RefObject<HTMLDivElement | null>
  stickToBottomRef: MutableRefObject<boolean>
}

export type ContainerMountRow = {
  id: string
  containerId: string
  containerName: string
  type: string
  source: string
  destination: string
  writable: boolean
}

export type DataTabProps = {
  app: AppInstance
  dataError: string
  dataLoading: boolean
  dataLoaded: boolean
  matchedInstanceResources: ResourceInstance[]
  matchedDataVolumes: DockerVolume[]
  backupProjection: BackupProjection
  mountProjectionLoading: boolean
  containerMountRows: ContainerMountRow[]
  canOpenServerWorkspace: boolean
  openServerWorkspace: (options?: {
    panel?: 'none' | 'files' | 'docker'
    path?: string
    lockedRoot?: string
  }) => void
}
