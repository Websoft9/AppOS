import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ServersPage } from './servers'

const navigateMock = vi.fn()
const getFullListMock = vi.fn()
const sendMock = vi.fn()
const createServerMock = vi.fn()
const updateServerMock = vi.fn()
const getSecretMock = vi.fn()
const updateSecretMock = vi.fn()
const getSystemdStatusMock = vi.fn()
const installMonitorAgentMock = vi.fn()
const updateMonitorAgentMock = vi.fn()
const pingServerStatusMock = vi.fn()
const windowOpenMock = vi.fn()
let searchState: Record<string, unknown> = {}

function isSecretSummaryRequest(path: string) {
  return (
    path.startsWith('/api/collections/secrets/records?') && path.includes('fields=id%2Ctemplate_id')
  )
}

function isMonitorSummaryRequest(path: string) {
  return path.startsWith('/api/collections/monitor_latest_status/records?')
}

function isServerSoftwareRequest(path: string) {
  return path === '/api/servers/server-1/software'
}

function isServerSoftwareComponentRequest(path: string) {
  return path === '/api/servers/server-1/software/docker'
}

function isServerSoftwareCapabilitiesRequest(path: string) {
  return path === '/api/servers/server-1/software/capabilities'
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const messages: Record<string, string> = {
        'hub.title': 'Resources',
        'servers.page.title': 'Servers',
        'servers.page.description': 'SSH deployment targets',
        'servers.page.favoritesOnly': 'Favorites only',
        'servers.page.addServer': 'Add Server',
        'servers.page.searchPlaceholder': 'Search server',
        'servers.page.detailDrawerTitle': 'Server Detail',
        'servers.fields.connectionType': 'Connection Type',
        'servers.fields.enableIt': 'Enable it',
        'servers.fields.enabled': 'Enabled',
        'servers.fields.name': 'Name',
        'servers.fields.host': 'Host',
        'servers.fields.useLocalHost': 'The same host with AppOS',
        'servers.fields.port': 'Port',
        'servers.fields.user': 'User',
        'servers.fields.credentialSecret': 'Credential (Secret)',
        'servers.fields.description': 'Description',
        'servers.placeholders.name': 'my-server',
        'servers.placeholders.host': '192.168.1.1',
        'servers.placeholders.user': 'root',
        'servers.connection.directSsh': 'Direct SSH',
        'servers.connection.reverseTunnel': 'Reverse Tunnel',
        'servers.connection.tunnelShort': 'Tunnel',
        'servers.connection.directDescription': 'AppOS reaches this server over SSH.',
        'servers.connection.tunnelDescription': 'Server connects back from a private network.',
        'servers.help.connectionTypeLabel': 'Connection type help',
        'servers.help.connectionTypeBody': 'Choose how the managed server connects to AppOS.',
        'servers.help.hostLabel': 'Host help',
        'servers.help.hostBody':
          'Enter the IP address or domain name of the server managed by AppOS.',
        'servers.localHost.label': 'The same host with AppOS',
        'servers.localHost.errors.loadCurrentHostname':
          'Failed to resolve the current AppOS hostname',
        'servers.secret.newCredential': 'New credential',
        'servers.secret.editSecret': 'Edit Secret',
        'servers.secret.errors.load': 'Failed to load secret',
        'servers.secret.errors.nameRequired': 'Name is required',
        'servers.secret.errors.update': 'Failed to update secret',
        'servers.columns.name': 'Name',
        'servers.columns.enabled': 'Enabled',
        'servers.columns.mode': 'Mode',
        'servers.columns.connection': 'Connection',
        'servers.columns.monitor': 'Monitor',
        'servers.columns.host': 'Host',
        'servers.columns.user': 'User',
        'servers.columns.secretType': 'Secret Type',
        'servers.columns.lastActivity': 'Last Activity',
        'servers.connectionStates.notConfigured': 'Not Configured',
        'servers.connectionStates.awaitingConnection': 'Awaiting Connection',
        'servers.connectionStates.online': 'Online',
        'servers.connectionStates.paused': 'Paused',
        'servers.connectionStates.needsAttention': 'Needs Attention',
        'servers.connectionStates.configurationReady': 'Configuration is ready for verification.',
        'servers.actions.overviewAlreadyOpen': 'Overview already open',
        'servers.actions.openOverview': 'Open overview',
        'servers.actions.openConnectionDetails': 'Open connection details',
        'servers.actions.serverActions': 'Server actions',
        'servers.actions.openTerminal': 'Open Terminal',
        'servers.actions.testConnection': 'Test Connection',
        'servers.actions.enable': 'Enable',
        'servers.actions.disable': 'Disable',
        'servers.actions.tunnelSetup': 'Tunnel Setup',
        'servers.actions.duplicateServer': 'Duplicate Server',
        'servers.enabled.yes': 'Yes',
        'servers.enabled.no': 'No',
        'servers.detail.restoreWidth': 'Restore detail width',
        'servers.detail.expandWidth': 'Expand detail width',
        'servers.detail.unnamedServer': 'Unnamed Server',
        'servers.detail.backToConnection': 'Back to Connection',
        'servers.tabs.overview': 'Overview',
        'servers.tabs.connection': 'Connection',
        'servers.tabs.components': 'Components',
        'servers.tabs.monitor': 'Monitor',
        'servers.tabs.docker': 'Docker',
        'servers.tabs.runtime': 'Runtime',
        'servers.tabs.ports': 'Ports',
        'servers.tabs.crontab': 'Crontab',
        'servers.tabs.systemd': 'Systemd',
        'servers.monitorTab.heading': 'Monitor',
        'servers.monitorTab.description':
          'Review current resource signals, trend history, and compact server conclusions.',
        'servers.monitorTab.currentValuesRegion': 'Monitor current values and trend history',
        'servers.monitorTab.errors.collectorStatusUnavailable':
          'Unable to read monitor collector service status',
        'servers.monitorTab.state.ok': 'OK',
        'servers.monitorTab.state.attention': 'Action needed',
        'servers.monitorTab.state.checking': 'Checking',
        'servers.monitorTab.state.review': 'Review',
        'servers.monitorTab.time.updatedUnknown': 'Updated —',
        'servers.monitorTab.hints.checking': 'Checking monitoring',
        'servers.monitorTab.hints.awaitingFirstSample':
          'Monitoring active · waiting for first sample',
        'servers.monitorTab.hints.notConnected': 'Monitoring not connected',
        'servers.monitorTab.alert.notConnectedTitle': 'Monitoring is not connected on this server.',
        'servers.monitorTab.alert.notConnectedBody':
          'Install or repair the Monitor Agent addon from Components before relying on monitor data.',
        'servers.monitorTab.actions.refreshStatus': 'Refresh monitor status',
        'servers.monitorTab.actions.openComponents': 'Open Components',
        'servers.monitorTab.actions.installMonitorAgent': 'Install monitor agent',
        'servers.monitorTab.actions.fixMonitorAgent': 'Fix monitor agent',
        'servers.monitorTab.actions.repairMonitorAgent': 'Repair monitor agent',
        'servers.monitorTab.actions.repairMonitorAgentDescription':
          'Reissues monitor write credentials, rewrites the callback address when needed, and restarts the AppOS monitor collector.',
        'servers.monitorTab.actions.openComponentsDescription':
          'Use Repair on the Monitor Agent addon to reissue credentials and refresh the callback address.',
        'servers.monitorTab.conclusions.regionLabel': 'Monitor conclusions',
        'servers.monitorTab.conclusions.title': 'Conclusions',
        'servers.monitorTab.conclusions.subtitle':
          'Compact server insights from usable monitor signals.',
        'servers.monitorTab.conclusions.emptyTitle': 'No conclusions yet.',
        'servers.monitorTab.conclusions.emptyBody':
          'Monitoring data is required before AppOS can analyze this server.',
        'servers.monitorTab.conclusions.dismissedTitle': 'All conclusions dismissed.',
        'servers.monitorTab.conclusions.dismissedBody':
          'Refresh monitor data to rebuild the conclusion list.',
        'servers.monitorTab.conclusions.listLabel': 'Monitor conclusion list',
        'servers.monitorTab.conclusions.deleteTitle': 'Delete conclusion',
        'servers.monitorTab.conclusions.controlReachable.label': 'Control reachable',
        'servers.monitorTab.conclusions.controlReachable.summaryOk': 'AppOS can reach this server.',
        'servers.monitorTab.conclusions.controlReachable.summaryAttention':
          'Server access needs attention.',
        'servers.monitorTab.conclusions.controlReachable.nextOk': 'No action needed.',
        'servers.monitorTab.conclusions.controlReachable.nextAttention':
          'Open the Connection tab and fix access.',
        'servers.monitorTab.conclusions.trendDataAvailable.label': 'Trend data available',
        'servers.monitorTab.conclusions.trendDataAvailable.summaryChecking':
          'Checking monitor data path.',
        'servers.monitorTab.conclusions.trendDataAvailable.summaryReady':
          'Use charts to confirm freshness.',
        'servers.monitorTab.conclusions.trendDataAvailable.detailChecking':
          'AppOS is checking whether the monitor collector can provide usable trend data.',
        'servers.monitorTab.conclusions.trendDataAvailable.detailReady':
          'Trend cards on the left are the source of truth for whether data is current and complete.',
        'servers.monitorTab.conclusions.trendDataAvailable.nextStep':
          'If charts stay empty or stale, open Components to verify the Monitor Agent addon.',
        'servers.monitorTab.conclusions.resourcePressure.label': 'Resource pressure',
        'servers.monitorTab.conclusions.resourcePressure.summary':
          'Review current values and trends.',
        'servers.monitorTab.conclusions.resourcePressure.detail':
          'CPU, memory, disk, and network cards show the current pressure and recent direction.',
        'servers.monitorTab.conclusions.resourcePressure.nextStep':
          'Investigate only when values are high, rising, or missing unexpectedly.',
        'servers.overview.sections.metadata': 'Server Metadata',
        'servers.overview.sections.systemInformation': 'System Information',
        'servers.overview.sections.cloudProvider': 'Cloud Provider',
        'servers.overview.actions.refresh': 'Refresh overview data',
        'servers.overview.actions.edit': 'Edit',
        'servers.overview.fields.id': 'ID',
        'servers.overview.fields.name': 'Name',
        'servers.overview.fields.connectionType': 'Connection Type',
        'servers.overview.fields.host': 'Host',
        'servers.overview.fields.port': 'Port',
        'servers.overview.fields.user': 'User',
        'servers.overview.fields.access': 'Access',
        'servers.overview.fields.tunnelState': 'Tunnel State',
        'servers.overview.fields.credentialType': 'Credential type',
        'servers.overview.fields.createdBy': 'Created by',
        'servers.overview.fields.description': 'Description',
        'servers.overview.fields.created': 'Created',
        'servers.overview.fields.updated': 'Updated',
        'servers.overview.fields.operatingSystem': 'Operating System',
        'servers.overview.fields.kernel': 'Kernel',
        'servers.overview.fields.architecture': 'Architecture',
        'servers.overview.fields.cpuCores': 'CPU Cores',
        'servers.overview.fields.memory': 'Memory',
        'servers.overview.fields.factsObserved': 'Facts Observed',
        'servers.overview.fields.provider': 'Provider',
        'servers.overview.fields.region': 'Region',
        'servers.overview.fields.zone': 'Zone',
        'servers.overview.fields.source': 'Source',
        'servers.overview.connection.direct': 'Direct',
        'servers.overview.credentialTypes.password': 'Password',
        'servers.overview.credentialTypes.sshKey': 'SSH key',
        'servers.overview.cloudSources.cloudInit': 'Cloud-init',
        'servers.overview.cloudSources.metadata': 'Metadata service',
        'servers.overview.cloudSources.manual': 'Manual override',
        'servers.overview.fallback.unavailable': 'Unavailable',
        'servers.overview.empty.noFacts': 'No host facts have been collected for this server yet.',
        'servers.connectionTab.state.connected': 'Connected',
        'servers.connectionTab.state.connecting': 'Connecting',
        'servers.connectionTab.state.needsAttention': 'Needs Attention',
        'servers.connectionTab.reason.tunnelActive': 'Tunnel active',
        'servers.connectionTab.reason.sshVerified': 'SSH verified',
        'servers.connectionTab.reason.waitingFirstConnection': 'Waiting for first connection',
        'servers.connectionTab.reason.readyToTest': 'Ready to test connection',
        'servers.connectionTab.reason.tunnelSetupRequired': 'Tunnel setup required',
        'servers.connectionTab.reason.completeSetup': 'Complete connection setup',
        'servers.connectionTab.reason.connectionPaused': 'Connection paused',
        'servers.connectionTab.reason.connectionLost': 'Connection lost',
        'servers.connectionTab.reason.connectionUnavailable': 'Connection unavailable',
        'servers.connectionTab.hero.tunnelLive': 'Tunnel connection is live',
        'servers.connectionTab.hero.directReady': 'Direct SSH is ready',
        'servers.connectionTab.hero.waitingFirstTunnelCallback':
          'Waiting for the first tunnel callback',
        'servers.connectionTab.hero.setupInProgress': 'Connection setup is in progress',
        'servers.connectionTab.hero.tunnelNeedsAttention': 'Tunnel connection needs attention',
        'servers.connectionTab.hero.connectionNeedsAttention': 'Connection needs attention',
        'servers.connectionTab.subline.remoteAccessAvailable': 'Remote access is available now.',
        'servers.connectionTab.subline.serverReachable': 'The server is reachable now.',
        'servers.connectionTab.subline.restoreAccess': 'Take the next action to restore access.',
        'servers.connectionTab.modeSummary.tunnelRelay': 'Tunnel via AppOS relay',
        'servers.connectionTab.modeSummary.directSsh': 'Direct SSH',
        'servers.connectionTab.sessions.none': 'None',
        'servers.connectionTab.sessions.oneActive': '1 active session',
        'servers.connectionTab.fields.connectionStatus': 'Connection Status',
        'servers.connectionTab.fields.mode': 'Mode',
        'servers.connectionTab.fields.interactiveSession': 'Interactive Session',
        'servers.connectionTab.fields.lastActivity': 'Last Activity',
        'servers.connectionTab.fields.recommendedAction': 'Recommended Action',
        'servers.connectionTab.activity.serverRegistered': 'Server registered',
        'servers.connectionTab.activity.connectionUpdated': 'Connection updated',
        'servers.connectionTab.activity.tunnelSetupStarted': 'Tunnel setup started',
        'servers.connectionTab.activity.connected': 'Connected',
        'servers.connectionTab.activity.sshVerified': 'SSH verified',
        'servers.connectionTab.activity.heartbeatReceived': 'Heartbeat received',
        'servers.connectionTab.activity.lastHealthyCheck': 'Last healthy check',
        'servers.connectionTab.activity.pauseUpdated': 'Pause updated',
        'servers.connectionTab.activity.connectionFailed': 'Connection failed',
        'servers.connectionTab.activity.settingsUpdated': 'Settings updated',
        'servers.connectionTab.activityLog.title': 'Activity Log',
        'servers.connectionTab.activityLog.empty': 'No recent activity is available yet.',
        'servers.connectionTab.activityLog.mostRecent': 'Most recent event',
        'servers.componentsTab.sections.prerequisites': 'Prerequisites',
        'servers.componentsTab.sections.prerequisitesRegion': 'Prerequisites section',
        'servers.componentsTab.sections.prerequisiteTargets': 'Prerequisite targets',
        'servers.componentsTab.sections.addons': 'Addons',
        'servers.componentsTab.sections.addonsRegion': 'Addons section',
        'servers.componentsTab.sections.addonInventory': 'Addon inventory',
        'servers.componentsTab.help.prerequisitesLabel': 'Prerequisites help',
        'servers.componentsTab.help.prerequisitesBody':
          'Core platform requirements that should be ready before AppOS manages workloads on this server.',
        'servers.componentsTab.help.addonsLabel': 'Addons help',
        'servers.componentsTab.help.addonsBody':
          'Optional server-side components that AppOS can inspect, verify, install, or repair after the baseline is ready.',
        'servers.componentsTab.actions.refresh': 'Refresh',
        'servers.componentsTab.actions.refreshComponents': 'Refresh components',
        'servers.componentsTab.columns.name': 'Name',
        'servers.componentsTab.columns.version': 'Version',
        'servers.componentsTab.columns.health': 'Health',
        'servers.componentsTab.columns.actions': 'Actions',
        'servers.componentsTab.actionLabels.default': 'Action',
        'servers.componentsTab.actionLabels.verify': 'Check',
        'servers.componentsTab.actionLabels.recheck': 'Recheck',
        'servers.componentsTab.actionLabels.reinstall': 'Repair',
        'servers.componentsTab.actionLabels.uninstall': 'Remove',
        'servers.componentsTab.actionLabels.install': 'Install',
        'servers.componentsTab.actionLabels.upgrade': 'Upgrade',
        'servers.componentsTab.actionLabels.start': 'Start',
        'servers.componentsTab.actionLabels.restart': 'Restart',
        'servers.componentsTab.actionLabels.stop': 'Stop',
        'servers.componentsTab.groups.recommended': 'Recommended',
        'servers.componentsTab.groups.secondary': 'Secondary',
        'servers.componentsTab.groups.dangerous': 'Dangerous',
        'servers.componentsTab.guidance.stoppedWithStart':
          'This addon is stopped. Use Start to bring it back online.',
        'servers.componentsTab.guidance.stoppedWithoutStart':
          'This addon is stopped. Bring the service back online, then run Check to verify health.',
        'servers.componentsTab.installSources.managed': 'Managed',
        'servers.componentsTab.installSources.foreignPackage': 'Foreign package',
        'servers.componentsTab.installSources.manual': 'Manual',
        'servers.componentsTab.installSources.unknown': 'Unknown',
        'servers.componentsTab.status.running': 'Running',
        'servers.componentsTab.status.stopped': 'Stopped',
        'servers.componentsTab.status.installed': 'Installed',
        'servers.componentsTab.status.notInstalled': 'Not Installed',
        'servers.componentsTab.status.needsAttention': 'Needs Attention',
        'servers.componentsTab.status.unknown': 'Unknown',
        'servers.componentsTab.apposConnection.connected': 'Connected',
        'servers.componentsTab.apposConnection.stale': 'Stale',
        'servers.componentsTab.apposConnection.connecting': 'Connecting',
        'servers.componentsTab.apposConnection.notConnected': 'Not Connected',
        'servers.componentsTab.apposConnection.authFailed': 'Auth Failed',
        'servers.componentsTab.apposConnection.misconfigured': 'Misconfigured',
        'servers.componentsTab.apposConnection.unknown': 'Unknown',
        'servers.componentsTab.prerequisiteStatus.needsAttention': 'Needs Attention',
        'servers.componentsTab.prerequisiteStatus.verified': 'Verified',
        'servers.componentsTab.prerequisiteStatus.detected': 'Detected',
        'servers.componentsTab.prerequisiteStatus.notReady': 'Not Ready',
        'servers.componentsTab.prerequisiteStatus.unknown': 'Unknown',
        'servers.componentsTab.prerequisiteChecks.osSupport': 'OS Support',
        'servers.componentsTab.prerequisiteChecks.privilegedAccess': 'Privileged Access',
        'servers.componentsTab.prerequisiteChecks.networkAccess': 'Network Access',
        'servers.componentsTab.prerequisiteChecks.dependencyReadiness': 'Dependency Readiness',
        'servers.componentsTab.detailRows.serviceStatus': 'Service Status',
        'servers.componentsTab.detailRows.guidance': 'Guidance',
        'servers.componentsTab.detailRows.apposConnection': 'AppOS Connection',
        'servers.componentsTab.detailRows.installed': 'Installed',
        'servers.componentsTab.detailRows.latest': 'Latest',
        'servers.componentsTab.detailRows.artifact': 'Artifact',
        'servers.componentsTab.detailRows.installSource': 'Install Source',
        'servers.componentsTab.detailRows.lastAction': 'Last Action',
        'servers.componentsTab.detailRows.updated': 'Updated',
        'servers.componentsTab.detailRows.issues': 'Issues',
        'servers.componentsTab.detailRows.verification': 'Verification',
        'servers.componentsTab.detailRows.healthReasons': 'Health Reasons',
        'servers.componentsTab.inventory.installed': 'Installed',
        'servers.componentsTab.inventory.latest': 'Latest',
        'servers.componentsTab.inventory.service': 'Service',
        'servers.componentsTab.inventory.appos': 'AppOS',
        'servers.componentsTab.inventory.operation': 'Operation',
        'servers.componentsTab.checklist.checkDockerEngineInstallation':
          'Check Docker Engine installation',
        'servers.componentsTab.checklist.checkDockerEngineVersion': 'Check Docker Engine version',
        'servers.componentsTab.checklist.checkDockerComposeAvailability':
          'Check Docker Compose availability',
        'servers.componentsTab.checklist.checkDockerComposeVersion': 'Check Docker Compose version',
        'servers.componentsTab.operationHistory.loading': 'Loading operation history...',
        'servers.componentsTab.operationHistory.empty': 'No operation history yet.',
        'servers.componentsTab.operationHistory.badges.current': 'Current',
        'servers.componentsTab.operationHistory.errors.load': 'Failed to load operation history',
        'servers.componentsTab.operationHistory.errors.delete':
          'Failed to delete operation history record',
        'servers.componentsTab.operationHistory.actions.refresh': 'Refresh operation history',
        'servers.componentsTab.operationHistory.actions.deleteRecord': 'Delete history record',
        'servers.componentsTab.operationHistory.actions.deleteBlocked':
          'In-flight operations cannot be deleted',
        'servers.componentsTab.panelTabs.checklist': 'Checklist',
        'servers.componentsTab.panelTabs.details': 'Details',
        'servers.componentsTab.panelTabs.liveLog': 'Live Log',
        'servers.componentsTab.panelTabs.history': 'History',
        'servers.componentsTab.panelTitles.operationHistory': 'Operation History',
        'servers.componentsTab.panelTitles.verificationChecklist': 'Verification Checklist',
        'servers.componentsTab.panelTitles.addonDetails': 'Addon Details',
        'servers.componentsTab.badges.streaming': 'Streaming',
        'servers.componentsTab.badges.inProgress': 'In progress',
        'servers.componentsTab.errors.loadPrerequisiteComponents':
          'Failed to load prerequisite components',
        'servers.componentsTab.errors.loadAddonComponents': 'Failed to load addon components',
        'servers.componentsTab.actionFeedback.waitingForFirstMetricsSample':
          'Waiting for the first metrics sample from this server.',
        'servers.componentsTab.actionFeedback.waitingForFirstMetricsSampleWithConnection':
          'Waiting for the first metrics sample; AppOS Connection will show Connecting until trend data arrives.',
        'servers.componentsTab.actionFeedback.now': 'Now',
        'servers.componentsTab.phase.accepted': 'Accepted',
        'servers.componentsTab.phase.preflight': 'Preflight check...',
        'servers.componentsTab.phase.executing': 'Executing...',
        'servers.componentsTab.phase.verifying': 'Verifying...',
        'servers.componentsTab.phase.succeeded': 'Succeeded',
        'servers.componentsTab.phase.failed': 'Failed',
        'servers.componentsTab.phase.attentionRequired': 'Attention required',
        'servers.componentsTab.phase.timeout': 'Timed out, status unknown',
        'servers.componentsTab.phase.timedOut': 'Timed out',
        'servers.componentsTab.dockerFocus.sources.compose': 'Compose',
        'servers.componentsTab.dockerFocus.sources.containers': 'Containers',
        'servers.componentsTab.dockerFocus.sources.images': 'Images',
        'servers.componentsTab.dockerFocus.sources.volumes': 'Volumes',
        'servers.componentsTab.dockerFocus.sources.networks': 'Networks',
        'servers.componentsTab.dockerFocus.sources.overview': 'Overview',
        'servers.componentsTab.logRegions.prerequisiteActionLogEntries':
          'Prerequisite action log entries',
        'servers.componentsTab.logRegions.addonActionLogEntries': 'Addon action log entries',
        'servers.componentsTab.dialogs.confirmDanger.upgradeConsequence':
          'upgrade or replace Docker components',
        'servers.componentsTab.dialogs.confirmDanger.reinstallConsequence':
          'reinstall or replace Docker components',
        'servers.componentsTab.dialogs.confirmDanger.cancel': 'Cancel',
        'servers.componentsTab.dialogs.confirmDanger.continue': 'Continue',
        'servers.componentsTab.dialogs.monitorAddress.title': 'Choose monitor callback address',
        'servers.componentsTab.dialogs.monitorAddress.description':
          'The monitor agent will send metrics back to AppOS. The address detected from this browser session differs from the configured App URL. Choose the address that the target server can reach.',
        'servers.componentsTab.dialogs.monitorAddress.close':
          'Close monitor callback address dialog',
        'servers.componentsTab.dialogs.monitorAddress.detectedAddress': 'Detected address',
        'servers.componentsTab.dialogs.monitorAddress.appUrl': 'App URL',
        'servers.componentsTab.dialogs.monitorAddress.useDetectedAddress': 'Use detected address',
        'servers.componentsTab.dialogs.monitorAddress.useAppUrl': 'Use App URL',
        'servers.componentsTab.dialogs.monitorAddress.errors.loadAppUrl': 'Failed to load App URL',
        'servers.componentsTab.dialogs.monitorAddress.errors.detectCallback':
          'Cannot detect the AppOS callback address from this browser session.',
        'servers.componentsTab.alerts.operationAlreadyInProgress.title':
          'Operation already in progress',
        'servers.componentsTab.alerts.operationAlreadyInProgress.currentPhase': 'Current phase',
        'servers.componentsTab.alerts.operationAlreadyInProgress.lastUpdated': 'Last updated',
        'servers.componentsTab.alerts.operationAlreadyInProgress.openOperationHistory':
          'Open operation history',
        'servers.componentsTab.selectedAddon.title': 'Selected Addon',
        'servers.componentsTab.selectedAddon.selectFromInventory':
          'Select one addon from the inventory.',
        'servers.componentsTab.selectedAddon.empty':
          'Choose a component to inspect status, activity, readiness issues, and available actions.',
        'servers.componentsTab.selectedAddon.inProgress.title': 'Operation in progress',
        'servers.componentsTab.selectedAddon.inProgress.isStill': 'is still',
        'servers.componentsTab.selectedAddon.inProgress.lastUpdated': 'Last updated',
        'servers.componentsTab.prerequisiteCard.summary.checksPassed': 'Checks passed',
        'servers.componentsTab.prerequisiteCard.summary.openDetails':
          'Open details for verification and recovery actions',
        'servers.componentsTab.prerequisiteCard.fields.status': 'Status',
        'servers.componentsTab.prerequisiteCard.fields.version': 'Version',
        'servers.componentsTab.prerequisiteCard.fields.dockerCompose': 'Docker Compose',
        'servers.componentsTab.prerequisiteCard.fields.updated': 'Updated',
        'servers.componentsTab.prerequisiteCard.fallback.unavailable': 'Unavailable',
        'servers.componentsTab.prerequisiteCard.fallback.missing': 'Missing',
        'servers.componentsTab.empty.loadingPrerequisites': 'Loading prerequisites...',
        'servers.componentsTab.empty.noPrerequisites':
          'No prerequisite components are defined for this server.',
        'servers.componentsTab.empty.loadingAddons': 'Loading addons...',
        'servers.componentsTab.empty.noAddons': 'No addon components found for this server.',
        'servers.componentsTab.empty.waitingForOperationUpdates':
          'Waiting for operation updates...',
        'servers.componentsTab.empty.noLiveLogYet':
          'No live log yet. Run an action to stream updates here.',
        'servers.summary.viaTunnel': 'via AppOS tunnel',
        'servers.sessions.oneActive': '1 active terminal session',
        'servers.listSettings.title': 'List settings',
        'servers.listSettings.rowsPerPage': 'Rows per page',
        'servers.listSettings.columns': 'Columns',
        'servers.validation.nameRequired': 'Name is required',
        'servers.validation.userRequired': 'User is required',
        'servers.validation.hostRequiredForDirect': 'Host is required for Direct SSH connections',
        'servers.validation.portRequiredForDirect': 'Port is required for Direct SSH connections',
      }

      if (key === 'servers.page.totalItems') {
        return `Total ${String(options?.count ?? '')} items`
      }
      if (key === 'servers.detail.titleWithName') {
        return `Server Detail | ${String(options?.name ?? '')}`
      }
      if (key === 'servers.monitorTab.time.updatedAt') {
        return `Updated ${String(options?.time ?? '')}`
      }
      if (key === 'servers.monitorTab.empty.noDataYet') {
        return `No monitoring data available yet for ${String(options?.name ?? '')}. Current connectivity status is ${String(options?.status ?? '')}.`
      }
      if (key === 'servers.monitorTab.hints.active') {
        return `Monitoring active${String(options?.subState ?? '')}`
      }
      if (key === 'servers.connectionTab.reason.lastHeartbeat') {
        return `Last heartbeat ${String(options?.time ?? '')}`
      }
      if (key === 'servers.connectionTab.sessions.manyActive') {
        return `${String(options?.count ?? '')} active sessions`
      }
      if (key === 'servers.monitorTab.conclusions.openItem') {
        return `Open conclusion ${String(options?.label ?? '')}`
      }
      if (key === 'servers.monitorTab.conclusions.deleteItem') {
        return `Delete conclusion ${String(options?.label ?? '')}`
      }
      if (key === 'servers.monitorTab.conclusions.controlReachable.detailOk') {
        return `${String(options?.name ?? '')} is reachable through the current server connection.`
      }
      if (key === 'servers.monitorTab.conclusions.controlReachable.detailAttention') {
        return `${String(options?.name ?? '')} may not be reachable. Repair the connection before relying on live operations.`
      }
      if (key === 'servers.actions.openMonitorFor') {
        return `Open monitor for ${String(options?.name ?? '')}`
      }
      if (key === 'servers.monitor.tooltipWithReason') {
        return `Observed monitor target status: ${String(options?.status ?? '')}. ${String(options?.reason ?? '')}`
      }
      if (key === 'servers.monitor.tooltipWithoutReason') {
        return `Observed monitor target status: ${String(options?.status ?? '')}`
      }
      if (key === 'servers.monitor.tooltipSuffix') {
        return `${String(options?.prefix ?? '')}. This reflects the latest monitoring evidence for the server target and may lag behind addon status.`
      }
      if (key === 'servers.sessions.manyActive') {
        return `${String(options?.count ?? '')} active terminal sessions`
      }
      if (key === 'servers.listSettings.rowsPerPageOption') {
        return `${String(options?.count ?? '')} / page`
      }
      if (key === 'servers.runtime.placeholder') {
        return `Runtime details can later include active sessions, deployed workloads, and process information for ${String(options?.name ?? '')}.`
      }
      if (key === 'servers.componentsTab.installSource.summary') {
        return `Install source: ${String(options?.label ?? '')}`
      }
      if (key === 'servers.componentsTab.installSource.summaryWithEvidence') {
        return `Install source: ${String(options?.label ?? '')} (${String(options?.evidence ?? '')})`
      }
      if (key === 'servers.componentsTab.operationHistory.title') {
        return `Operation History (${String(options?.count ?? '')})`
      }
      if (key === 'servers.componentsTab.operationHistory.actions.deleteRecordFor') {
        return `Delete ${String(options?.action ?? '')} operation history record`
      }
      if (key === 'servers.componentsTab.actionFeedback.accepted') {
        return `${String(options?.action ?? '')} accepted`
      }
      if (key === 'servers.componentsTab.actionFeedback.acceptedWithId') {
        return `${String(options?.action ?? '')} accepted (${String(options?.operationId ?? '')})`
      }
      if (key === 'servers.componentsTab.actionFeedback.acceptedForComponent') {
        return `${String(options?.action ?? '')} accepted for ${String(options?.component ?? '')}`
      }
      if (key === 'servers.componentsTab.actionFeedback.acceptedForComponentWithId') {
        return `${String(options?.action ?? '')} accepted for ${String(options?.component ?? '')} (${String(options?.operationId ?? '')})`
      }
      if (key === 'servers.componentsTab.actionFeedback.logEntry') {
        return `${String(options?.time ?? '')} · ${String(options?.action ?? '')}: ${String(options?.phase ?? '')}`
      }
      if (key === 'servers.componentsTab.dialogs.confirmDanger.title') {
        return `Confirm ${String(options?.action ?? '')}`
      }
      if (key === 'servers.componentsTab.dialogs.confirmDanger.description') {
        return `${String(options?.action ?? '')} may ${String(options?.consequence ?? '')} on this server. Continue only if you are ready to interrupt the current runtime.`
      }
      if (key === 'servers.componentsTab.alerts.operationAlreadyInProgress.description') {
        return `${String(options?.name ?? '')} already has an active ${String(options?.action ?? '')} request.`
      }
      if (key === 'servers.componentsTab.phase.failedWithReason') {
        return `Failed: ${String(options?.reason ?? '')}`
      }
      if (key === 'servers.componentsTab.phase.attentionRequiredWithReason') {
        return `Attention required: ${String(options?.reason ?? '')}`
      }
      if (key === 'servers.componentsTab.phase.timeoutWithReason') {
        return `Timed out, status unknown: ${String(options?.reason ?? '')}`
      }
      if (key === 'servers.componentsTab.dockerFocus.title') {
        return `Opened from Docker > ${String(options?.source ?? '')}`
      }
      if (key === 'servers.componentsTab.dockerFocus.history.daemonUnavailable') {
        return `Docker prerequisite recovery was opened from the Docker ${String(options?.source ?? '')} view. Review recent checks and repair history first, then verify the Docker daemon is running before retrying there.`
      }
      if (key === 'servers.componentsTab.dockerFocus.history.permissionDenied') {
        return `Docker prerequisite recovery was opened from the Docker ${String(options?.source ?? '')} view. Review recent checks and repair history first, then fix Docker socket access or privilege setup before retrying there.`
      }
      if (key === 'servers.componentsTab.dockerFocus.history.default') {
        return `Docker prerequisite recovery was opened from the Docker ${String(options?.source ?? '')} view. Review recent checks and repair history before retrying there.`
      }
      if (key === 'servers.componentsTab.dockerFocus.checks.composeMissing') {
        return `Docker prerequisite checks were opened from the Docker ${String(options?.source ?? '')} view. Start by checking Docker Compose availability here, then return to that Docker screen and retry.`
      }
      if (key === 'servers.componentsTab.dockerFocus.checks.dockerMissing') {
        return `Docker prerequisite checks were opened from the Docker ${String(options?.source ?? '')} view. Start by checking Docker Engine installation here, then return to that Docker screen and retry.`
      }
      if (key === 'servers.componentsTab.dockerFocus.checks.default') {
        return `Docker prerequisite checks were opened from the Docker ${String(options?.source ?? '')} view. Fix the baseline requirement here, then return to that Docker screen and retry.`
      }
      if (key === 'servers.componentsTab.inventory.moreActionsFor') {
        return `More actions for ${String(options?.name ?? '')}`
      }
      if (key === 'servers.componentsTab.checklist.checkItem') {
        return `Check ${String(options?.label ?? '')}`
      }
      if (key === 'servers.componentsTab.panelTitles.actionLog') {
        return `${String(options?.action ?? '')} Log`
      }
      if (key === 'servers.componentsTab.prerequisiteCard.detailsFor') {
        return `${String(options?.name ?? '')} details`
      }

      return messages[key] ?? key
    },
    i18n: { changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useSearch: () => searchState,
    useNavigate: () => navigateMock,
  }),
  Link: ({
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode }) => (
    <a {...props}>{children}</a>
  ),
}))

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
    collection: (name: string) => {
      if (name === 'servers') {
        return {
          create: (...args: unknown[]) => createServerMock(...args),
          update: (...args: unknown[]) => updateServerMock(...args),
          delete: vi.fn(),
        }
      }

      if (name === 'secrets') {
        return {
          getFullList: vi.fn(),
          create: vi.fn(),
          getOne: (...args: unknown[]) => getSecretMock(...args),
          update: (...args: unknown[]) => updateSecretMock(...args),
          delete: vi.fn(),
        }
      }

      return {
        getFullList: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      }
    },
  },
}))

vi.mock('@/lib/connect-api', () => ({
  checkServerStatus: (...args: unknown[]) => pingServerStatusMock(...args),
  getSystemdStatus: (...args: unknown[]) => getSystemdStatusMock(...args),
  installMonitorAgent: (...args: unknown[]) => installMonitorAgentMock(...args),
  serverPower: vi.fn(),
  updateMonitorAgent: (...args: unknown[]) => updateMonitorAgentMock(...args),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'owner@example.com' },
  }),
}))

vi.mock('@/components/connect/DockerPanel', () => ({
  DockerPanel: ({ serverId }: { serverId: string }) => <div>Docker panel for {serverId}</div>,
}))

vi.mock('@/components/servers/ServerPortsPanel', () => ({
  ServerPortsPanel: ({ serverId }: { serverId: string }) => <div>Ports panel for {serverId}</div>,
}))

vi.mock('@/components/servers/ServerCronPanel', () => ({
  ServerCronPanel: ({ serverId }: { serverId: string }) => <div>Crontab panel for {serverId}</div>,
}))

vi.mock('@/components/servers/ServerServicesPanel', () => ({
  ServerServicesPanel: ({ serverId }: { serverId: string }) => (
    <div>Services panel for {serverId}</div>
  ),
}))

vi.mock('@/components/monitor/MonitorTargetPanel', () => ({
  MonitorTargetPanel: ({ targetId }: { targetId: string }) => (
    <div>Monitor panel for {targetId}</div>
  ),
}))

vi.mock('@/components/servers/TunnelSetupWizard', () => ({
  TunnelSetupWizard: ({ serverId }: { serverId: string }) => (
    <div>Tunnel setup wizard for {serverId}</div>
  ),
}))

vi.mock('@/components/secrets/SecretForm', () => ({
  SecretForm: ({
    templates,
    templateId,
    payload,
    onPayloadChange,
  }: {
    templates: Array<{
      id: string
      fields: Array<{ key: string; label: string; type: string; required?: boolean }>
    }>
    templateId: string
    payload: Record<string, string>
    onPayloadChange: (key: string, value: string) => void
  }) => {
    const selectedTemplate = templates.find(template => template.id === templateId)
    if (!selectedTemplate) return null
    return (
      <div>
        {selectedTemplate.fields.map(field => {
          const label = `${field.label}${field.required ? ' *' : ''}`
          return field.type === 'textarea' ? (
            <label key={field.key}>
              {label}
              <textarea
                aria-label={label}
                value={payload[field.key] ?? ''}
                onChange={event => onPayloadChange(field.key, event.target.value)}
              />
            </label>
          ) : (
            <label key={field.key}>
              {label}
              <input
                aria-label={label}
                type={field.type === 'password' ? 'password' : 'text'}
                value={payload[field.key] ?? ''}
                onChange={event => onPayloadChange(field.key, event.target.value)}
              />
            </label>
          )
        })}
      </div>
    )
  },
}))

describe('ServersPage layout', () => {
  beforeEach(() => {
    navigateMock.mockReset()
    getFullListMock.mockReset()
    sendMock.mockReset()
    createServerMock.mockReset()
    updateServerMock.mockReset()
    getSecretMock.mockReset()
    updateSecretMock.mockReset()
    windowOpenMock.mockReset()
    pingServerStatusMock.mockReset()
    getSystemdStatusMock.mockReset()
    installMonitorAgentMock.mockReset()
    updateMonitorAgentMock.mockReset()
    searchState = {}
    vi.stubGlobal('open', windowOpenMock)
    window.open = windowOpenMock as typeof window.open
    window.history.replaceState({}, '', '/resources/servers')
    pingServerStatusMock.mockResolvedValue({ status: 'online' })
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/servers/connection') {
        return Promise.resolve({
          items: [
            {
              id: 'server-1',
              name: 'alpha',
              is_enabled: true,
              connect_type: 'direct',
              host: '10.0.0.1',
              port: 22,
              user: 'root',
              created_by: 'user-1',
              created_by_name: 'owner@example.com',
              credential: 'secret-1',
              credential_type: 'Password',
              facts_json: {
                os: { family: 'linux', distribution: 'ubuntu', version: '24.04' },
                kernel: { release: '6.8.0' },
                architecture: 'amd64',
                cpu: { cores: 4 },
                memory: { total_bytes: 8589934592 },
              },
              facts_observed_at: '2026-04-16T01:02:03Z',
              access: { status: 'unknown', reason: '', checked_at: '', source: 'derived' },
            },
          ],
        })
      }
      if (isSecretSummaryRequest(path)) {
        return Promise.resolve({
          items: [
            {
              id: 'secret-1',
              name: 'ops-password',
              template_id: 'single_value',
            },
          ],
        })
      }
      if (isMonitorSummaryRequest(path)) {
        return Promise.resolve({ items: [] })
      }
      if (isServerSoftwareRequest(path)) {
        return Promise.resolve({ items: [] })
      }
      if (
        path ===
        "/api/collections/secrets/records?filter=(created_source=''||created_source='user')%26%26type!='tunnel_token'%26%26status='active'%26%26(template_id='single_value'||template_id='ssh_key')%26%26(visible_to:length=0||visible_to:each%3F='server')&sort=name"
      ) {
        return Promise.resolve({
          items: [
            {
              id: 'secret-1',
              name: 'ops-password',
              template_id: 'single_value',
            },
          ],
        })
      }
      if (isSecretSummaryRequest(path)) {
        return Promise.resolve({
          items: [
            {
              id: 'secret-1',
              name: 'ops-password',
              template_id: 'single_value',
            },
          ],
        })
      }
      if (isMonitorSummaryRequest(path)) {
        return Promise.resolve({ items: [] })
      }
      if (isServerSoftwareRequest(path)) {
        return Promise.resolve({ items: [] })
      }
      if (path === '/api/collections/groups/records?perPage=500&sort=name') {
        return Promise.resolve({ items: [] })
      }
      if (path === '/api/secrets/templates') {
        return Promise.resolve([
          {
            id: 'single_value',
            label: 'Password',
            description: 'Single secret value',
            fields: [{ key: 'value', label: 'Secret Value', type: 'password', required: true }],
          },
        ])
      }
      if (path === '/api/secrets/secret-1/payload') {
        return Promise.resolve({})
      }
      return Promise.resolve([])
    })
    createServerMock.mockResolvedValue({ id: 'server-new', connect_type: 'direct' })
    getSecretMock.mockResolvedValue({
      id: 'secret-1',
      name: 'ops-password',
      description: 'Original secret',
      template_id: 'single_value',
    })
    updateSecretMock.mockResolvedValue({})
    getSystemdStatusMock.mockResolvedValue({
      server_id: 'server-1',
      service: 'netdata',
      status: {},
      status_text: '',
    })
    installMonitorAgentMock.mockResolvedValue({ status: 'installed' })
    updateMonitorAgentMock.mockResolvedValue({ status: 'updated' })
  })

  afterEach(() => {
    cleanup()
  })

  it('uses the updated page header controls', async () => {
    render(<ServersPage />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Servers' })).toBeInTheDocument()
    })

    expect(screen.queryByRole('link', { name: 'Resources' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Add Server' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filter Mode' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filter Connection' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filter User' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filter Secret Type' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Filter Credential' })).toBeNull()
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toHaveClass('text-left')
    expect(screen.getAllByRole('button', { name: 'More actions' })[0].closest('td')).toHaveClass(
      'text-left'
    )
    expect(screen.getByText('ubuntu 24.04 · amd64')).toBeInTheDocument()
  })

  it('toggles enabled state from the list column', async () => {
    updateServerMock.mockResolvedValue({})

    render(<ServersPage />)

    const toggle = await screen.findByRole('button', { name: /yes/i })
    fireEvent.click(toggle)

    await waitFor(() => {
      expect(updateServerMock).toHaveBeenCalledWith(
        'server-1',
        expect.objectContaining({
          id: 'server-1',
          is_enabled: false,
        })
      )
    })
  })

  it('shows the minimal pager beside search when multiple pages exist', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/servers/connection') {
        return Promise.resolve({
          items: Array.from({ length: 11 }, (_, index) => ({
            id: `server-${index + 1}`,
            name: `server-${index + 1}`,
            connect_type: 'direct',
            host: `10.0.0.${index + 1}`,
            port: 22,
            user: 'root',
            created_by: 'user-1',
            created_by_name: 'owner@example.com',
            credential_type: 'Password',
            access: { status: 'unknown', reason: '', checked_at: '', source: 'derived' },
          })),
        })
      }
      if (isMonitorSummaryRequest(path)) {
        return Promise.resolve({ items: [] })
      }
      if (isServerSoftwareRequest(path)) {
        return Promise.resolve({ items: [] })
      }
      if (path === '/api/collections/groups/records?perPage=500&sort=name') {
        return Promise.resolve({ items: [] })
      }
      if (path === '/api/servers/local/docker-bridge') {
        return Promise.resolve({ interface: 'docker0', address: '172.17.0.1' })
      }
      if (path === '/api/secrets/templates') {
        return Promise.resolve([
          {
            id: 'single_value',
            label: 'Password',
            description: 'Single secret value',
            fields: [{ key: 'value', label: 'Secret Value', type: 'password', required: true }],
          },
        ])
      }
      return Promise.resolve([])
    })

    render(<ServersPage />)

    expect(await screen.findByText('server-1')).toBeInTheDocument()
    expect(screen.getByText('Total 11 items')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeInTheDocument()
    expect(screen.getByText('1/2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'List settings' })).toBeInTheDocument()
  })

  it('moves page size and optional column visibility into list settings', async () => {
    const serverItems = Array.from({ length: 11 }, (_, index) => ({
      id: `server-${index + 1}`,
      name: `server-${index + 1}`,
      connect_type: 'direct',
      host: `10.0.0.${index + 1}`,
      port: 22,
      user: 'root',
      created_by: 'user-1',
      created_by_name: 'owner@example.com',
      credential_type: 'Password',
      access: { status: 'unknown', reason: '', checked_at: '', source: 'derived' },
    }))

    sendMock.mockImplementation((path: string) => {
      if (path === '/api/servers/connection') {
        return Promise.resolve({
          items: serverItems,
        })
      }
      if (isMonitorSummaryRequest(path)) {
        return Promise.resolve({ items: [] })
      }
      if (isServerSoftwareRequest(path)) {
        return Promise.resolve({ items: [] })
      }
      if (path === '/api/collections/groups/records?perPage=500&sort=name') {
        return Promise.resolve({ items: [] })
      }
      if (path === '/api/servers/local/docker-bridge') {
        return Promise.resolve({ interface: 'docker0', address: '172.17.0.1' })
      }
      if (path === '/api/secrets/templates') {
        return Promise.resolve([
          {
            id: 'single_value',
            label: 'Password',
            description: 'Single secret value',
            fields: [{ key: 'value', label: 'Secret Value', type: 'password', required: true }],
          },
        ])
      }
      return Promise.resolve([])
    })

    render(<ServersPage />)

    expect(await screen.findByText('server-1')).toBeInTheDocument()
    expect(screen.getByText('server-10')).toBeInTheDocument()
    expect(screen.queryByText('server-11')).toBeNull()

    const settingsButton = screen.getByRole('button', { name: 'List settings' })

    fireEvent.pointerDown(settingsButton)

    expect(await screen.findByRole('menuitemradio', { name: '10 / page' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemcheckbox', { name: 'Host' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemcheckbox', { name: 'Monitor' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitemradio', { name: '50 / page' }))

    await waitFor(() => {
      expect(screen.getByText('server-11')).toBeInTheDocument()
    })

    fireEvent.pointerDown(settingsButton)
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Host' }))

    await waitFor(() => {
      expect(screen.queryByRole('columnheader', { name: 'Host' })).toBeNull()
    })

    fireEvent.pointerDown(settingsButton)
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Monitor' }))

    await waitFor(() => {
      expect(screen.queryByRole('columnheader', { name: 'Monitor' })).toBeNull()
    })
  }, 15000)

  it('renders the unified Connection column and lifecycle primary actions', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/servers/connection') {
        return Promise.resolve({
          items: [
            {
              id: 'server-1',
              name: 'alpha',
              connect_type: 'direct',
              host: '10.0.0.1',
              port: 22,
              user: 'root',
              created_by: 'user-1',
              created_by_name: 'owner@example.com',
              credential: 'secret-1',
              credential_type: 'Password',
              access: { status: 'unknown', reason: '', checked_at: '', source: 'derived' },
            },
            {
              id: 'server-2',
              name: 'beta',
              connect_type: 'tunnel',
              host: '10.0.0.2',
              port: 22,
              user: 'root',
              created_by: 'user-2',
              created_by_name: 'alice',
              credential: 'secret-1',
              credential_type: 'Password',
              access: {
                status: 'unavailable',
                reason: 'waiting_for_first_connect',
                checked_at: '',
                source: 'tunnel_runtime',
              },
              tunnel: {
                state: 'setup_required',
                status: 'offline',
                waiting_for_first_connect: true,
                services: [],
              },
            },
          ],
        })
      }
      if (path === '/api/collections/groups/records?perPage=500&sort=name') {
        return Promise.resolve({ items: [] })
      }
      if (path === '/api/servers/local/docker-bridge') {
        return Promise.resolve({ interface: 'docker0', address: '172.17.0.1' })
      }
      if (path === '/api/secrets/templates') {
        return Promise.resolve([
          {
            id: 'single_value',
            label: 'Password',
            description: 'Single secret value',
            fields: [{ key: 'value', label: 'Secret Value', type: 'password', required: true }],
          },
        ])
      }
      if (path === '/api/secrets/secret-1/payload') {
        return Promise.resolve({})
      }
      return Promise.resolve([])
    })

    render(<ServersPage />)

    expect(await screen.findByText('alpha')).toBeInTheDocument()
    expect(screen.getByText('Needs Attention')).toBeInTheDocument()
    expect(screen.getByText('Not Configured')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'User' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Secret Type' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Monitor' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Host' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fix Configuration' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start Setup' })).toBeInTheDocument()
  }, 20000)

  it('filters rows by user', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/servers/connection') {
        return Promise.resolve({
          items: [
            {
              id: 'server-1',
              name: 'alpha',
              connect_type: 'direct',
              host: '10.0.0.1',
              port: 22,
              user: 'root',
              access: {
                status: 'available',
                reason: '',
                checked_at: '2026-04-16T01:00:00Z',
                source: 'ssh_probe',
              },
            },
            {
              id: 'server-2',
              name: 'beta',
              connect_type: 'direct',
              host: '10.0.0.2',
              port: 22,
              user: 'ubuntu',
              access: {
                status: 'available',
                reason: '',
                checked_at: '2026-04-16T01:00:00Z',
                source: 'ssh_probe',
              },
            },
          ],
        })
      }
      if (isMonitorSummaryRequest(path)) {
        return Promise.resolve({ items: [] })
      }
      if (path === '/api/collections/groups/records?perPage=500&sort=name') {
        return Promise.resolve({ items: [] })
      }
      if (path === '/api/servers/local/docker-bridge') {
        return Promise.resolve({ interface: 'docker0', address: '172.17.0.1' })
      }
      if (path === '/api/secrets/templates') {
        return Promise.resolve([
          {
            id: 'single_value',
            label: 'Password',
            description: 'Single secret value',
            fields: [{ key: 'value', label: 'Secret Value', type: 'password', required: true }],
          },
        ])
      }
      return Promise.resolve([])
    })

    render(<ServersPage />)

    expect(await screen.findByText('alpha')).toBeInTheDocument()

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Filter User' }))
    fireEvent.click((await screen.findAllByText('ubuntu')).at(-1) as HTMLElement)

    await waitFor(() => {
      expect(screen.getByText('alpha')).toBeInTheDocument()
      expect(screen.queryByText('beta')).toBeNull()
    })
  })

  it('filters rows by secret type and shows a monitor shortcut when monitoring exists', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/servers/connection') {
        return Promise.resolve({
          items: [
            {
              id: 'server-1',
              name: 'alpha',
              connect_type: 'direct',
              host: '10.0.0.1',
              port: 22,
              user: 'root',
              credential: 'secret-1',
              credential_type: 'Password',
              connection: {
                state_code: 'online',
                config_ready: true,
              },
              access: {
                status: 'available',
                reason: '',
                checked_at: '2026-04-16T01:00:00Z',
                source: 'ssh_probe',
              },
            },
            {
              id: 'server-2',
              name: 'beta',
              connect_type: 'direct',
              host: '10.0.0.2',
              port: 22,
              user: 'ubuntu',
              credential: 'secret-2',
              credential_type: 'SSH Key',
              access: {
                status: 'available',
                reason: '',
                checked_at: '2026-04-16T01:00:00Z',
                source: 'ssh_probe',
              },
            },
          ],
        })
      }
      if (isMonitorSummaryRequest(path)) {
        return Promise.resolve({
          items: [
            {
              target_id: 'server-1',
              status: 'online',
              reason: 'netdata ready',
              last_checked_at: '2026-04-16T01:02:00Z',
            },
          ],
        })
      }
      if (path === '/api/collections/groups/records?perPage=500&sort=name') {
        return Promise.resolve({ items: [] })
      }
      if (path === '/api/servers/local/docker-bridge') {
        return Promise.resolve({ interface: 'docker0', address: '172.17.0.1' })
      }
      if (path === '/api/secrets/templates') {
        return Promise.resolve([
          {
            id: 'single_value',
            label: 'Password',
            description: 'Single secret value',
            fields: [{ key: 'value', label: 'Secret Value', type: 'password', required: true }],
          },
        ])
      }
      return Promise.resolve([])
    })

    render(<ServersPage />)

    expect(await screen.findByText('alpha')).toBeInTheDocument()
    const monitorShortcut = screen.getByRole('button', { name: 'Open monitor for alpha' })
    expect(monitorShortcut).toBeInTheDocument()
    expect(monitorShortcut.className).toContain('text-emerald-600')
    expect(monitorShortcut).toHaveAttribute(
      'title',
      'Observed monitor target status: online. netdata ready. This reflects the latest monitoring evidence for the server target and may lag behind addon status.'
    )

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Filter Secret Type' }))
    fireEvent.click((await screen.findAllByText('SSH Key')).at(-1) as HTMLElement)

    await waitFor(() => {
      expect(screen.getByText('alpha')).toBeInTheDocument()
      expect(screen.queryByText('beta')).toBeNull()
    })
  })

  it('places favorite below shutdown in the actions menu', async () => {
    render(<ServersPage />)

    await waitFor(() => {
      expect(screen.getByText('alpha')).toBeInTheDocument()
    })

    fireEvent.pointerDown(screen.getAllByRole('button', { name: 'More actions' })[0])

    expect(await screen.findByText('View Details')).toBeInTheDocument()
    expect(screen.getByText('View Connection')).toBeInTheDocument()
    const menuText =
      (await screen.findByText('Restart')).parentElement?.parentElement?.textContent ?? ''
    expect(menuText.indexOf('Restart')).toBeLessThan(menuText.indexOf('Shutdown'))
    expect(menuText.indexOf('Shutdown')).toBeLessThan(menuText.indexOf('Add Favorite'))
  })

  it('duplicates a server into the add dialog with copied configuration fields', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/servers/connection') {
        return Promise.resolve({
          items: [
            {
              id: 'server-1',
              name: 'alpha',
              connect_type: 'direct',
              host: '10.0.0.1',
              port: 2222,
              user: 'ubuntu',
              description: 'Primary edge node',
              created_by: 'user-1',
              created_by_name: 'owner@example.com',
              credential: 'secret-1',
              credential_type: 'Password',
              access: { status: 'unknown', reason: '', checked_at: '', source: 'derived' },
            },
          ],
        })
      }
      if (isSecretSummaryRequest(path)) {
        return Promise.resolve({
          items: [
            {
              id: 'secret-1',
              name: 'ops-password',
              template_id: 'single_value',
            },
          ],
        })
      }
      if (isMonitorSummaryRequest(path)) {
        return Promise.resolve({ items: [] })
      }
      if (isServerSoftwareRequest(path)) {
        return Promise.resolve({ items: [] })
      }
      if (path === '/api/collections/groups/records?perPage=500&sort=name') {
        return Promise.resolve({ items: [] })
      }
      if (path === '/api/servers/local/docker-bridge') {
        return Promise.resolve({ interface: 'docker0', address: '172.17.0.1' })
      }
      if (path === '/api/secrets/templates') {
        return Promise.resolve([
          {
            id: 'single_value',
            label: 'Password',
            description: 'Single secret value',
            fields: [{ key: 'value', label: 'Secret Value', type: 'password', required: true }],
          },
        ])
      }
      if (
        path ===
        "/api/collections/secrets/records?filter=((created_source=''||created_source='user')%26%26type!='tunnel_token'%26%26status='active'%26%26(template_id='single_value'||template_id='ssh_key'))&sort=name"
      ) {
        return Promise.resolve({
          items: [
            {
              id: 'secret-1',
              name: 'ops-password',
              template_id: 'single_value',
            },
          ],
        })
      }
      return Promise.resolve([])
    })

    render(<ServersPage />)

    expect(await screen.findByText('alpha')).toBeInTheDocument()

    fireEvent.pointerDown(screen.getAllByRole('button', { name: 'More actions' })[0])
    fireEvent.click(await screen.findByText('Duplicate Server'))

    const duplicateDialog = await screen.findByRole('dialog')
    expect(within(duplicateDialog).getByRole('heading', { name: 'Add Server' })).toBeInTheDocument()

    const nameInput = within(duplicateDialog).getByLabelText(/^Name\*/) as HTMLInputElement
    const hostInput = within(duplicateDialog).getByLabelText(/^Host\*/) as HTMLInputElement
    const portInput = within(duplicateDialog).getByLabelText(/^Port\*/) as HTMLInputElement
    const userInput = within(duplicateDialog).getByLabelText(/^User\*/) as HTMLInputElement

    fireEvent.click(within(duplicateDialog).getByRole('button', { name: /Advanced/ }))

    const descriptionInput = within(duplicateDialog).getByLabelText(
      /^Description/
    ) as HTMLTextAreaElement

    expect(nameInput.value).toMatch(/^server-\d{6}$/)
    expect(nameInput.value).not.toBe('alpha')
    expect(hostInput.value).toBe('10.0.0.1')
    expect(portInput.value).toBe('2222')
    expect(userInput.value).toBe('ubuntu')
    expect(descriptionInput.value).toBe('Primary edge node')

    fireEvent.click(within(duplicateDialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(createServerMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: expect.stringMatching(/^server-\d{6}$/),
          connect_type: 'direct',
          host: '10.0.0.1',
          port: 2222,
          user: 'ubuntu',
          credential: 'secret-1',
          description: 'Primary edge node',
          created_by: 'user-1',
        })
      )
    })
  })

  it('routes tunnel servers into the Connection tab and hides the legacy tunnel tab', async () => {
    searchState = { server: 'server-1', tab: 'connection' }

    sendMock.mockImplementation((path: string) => {
      if (path === '/api/servers/connection') {
        return Promise.resolve({
          items: [
            {
              id: 'server-1',
              name: 'alpha',
              connect_type: 'tunnel',
              host: '10.0.0.1',
              port: 22,
              user: 'root',
              created_by: 'user-1',
              created_by_name: 'owner@example.com',
              created: '2026-04-16T00:00:00Z',
              updated: '2026-04-16T01:00:00Z',
              credential_type: 'Password',
              access: {
                status: 'available',
                reason: '',
                checked_at: '2026-04-16T01:00:00Z',
                source: 'tunnel_runtime',
              },
              tunnel: {
                state: 'ready',
                status: 'online',
                waiting_for_first_connect: false,
                services: [{ service_name: 'ssh', tunnel_port: 2201 }],
              },
            },
          ],
        })
      }
      if (isMonitorSummaryRequest(path)) {
        return Promise.resolve({ items: [] })
      }
      if (path === '/api/collections/groups/records?perPage=500&sort=name') {
        return Promise.resolve({ items: [] })
      }
      if (path === '/api/servers/local/docker-bridge') {
        return Promise.resolve({ interface: 'docker0', address: '172.17.0.1' })
      }
      if (path === '/api/secrets/templates') {
        return Promise.resolve([
          {
            id: 'single_value',
            label: 'Password',
            description: 'Single secret value',
            fields: [{ key: 'value', label: 'Secret Value', type: 'password', required: true }],
          },
        ])
      }
      if (path === '/api/secrets/secret-1/payload') {
        return Promise.resolve({})
      }
      return Promise.resolve([])
    })

    render(<ServersPage />)

    expect(await screen.findByRole('tab', { name: 'Connection' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Tunnel' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Server actions' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Connection', selected: true })).toBeInTheDocument()
  })

  it('replaces the current detail drawer content with tunnel setup instead of opening a nested modal', async () => {
    searchState = { server: 'server-1', tab: 'connection' }

    sendMock.mockImplementation((path: string) => {
      if (path === '/api/servers/connection') {
        return Promise.resolve({
          items: [
            {
              id: 'server-1',
              name: 'alpha',
              connect_type: 'tunnel',
              host: '10.0.0.1',
              port: 22,
              user: 'root',
              created_by: 'user-1',
              created_by_name: 'owner@example.com',
              created: '2026-04-16T00:00:00Z',
              updated: '2026-04-16T01:00:00Z',
              credential_type: 'Password',
              connection: {
                state_code: 'not_configured',
                reason_code: 'tunnel_setup_required',
                config_ready: true,
              },
              access: {
                status: 'unavailable',
                reason: 'waiting_for_first_connect',
                checked_at: '',
                source: 'tunnel_runtime',
              },
              tunnel: {
                state: 'setup_required',
                status: 'offline',
                waiting_for_first_connect: true,
                services: [],
              },
            },
          ],
        })
      }
      if (isMonitorSummaryRequest(path)) {
        return Promise.resolve({ items: [] })
      }
      if (path === '/api/collections/groups/records?perPage=500&sort=name') {
        return Promise.resolve({ items: [] })
      }
      if (path === '/api/servers/local/docker-bridge') {
        return Promise.resolve({ interface: 'docker0', address: '172.17.0.1' })
      }
      if (path === '/api/secrets/templates') {
        return Promise.resolve([])
      }
      return Promise.resolve([])
    })

    render(<ServersPage />)

    expect(
      await screen.findByRole('tab', { name: 'Connection', selected: true })
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start Setup' }))

    expect(await screen.findByText('Tunnel setup wizard for server-1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to Connection' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Overview' })).toBeNull()
  })

  it('hides the tunnel tab for direct servers', async () => {
    render(<ServersPage />)

    await waitFor(() => expect(screen.getByText('alpha')).toBeInTheDocument())
    fireEvent.pointerDown(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'View Details' }))

    await waitFor(() => {
      expect(screen.getByText('Overview')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Server actions' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Tunnel' })).toBeNull()
    expect(screen.queryByText('Tunnel Services')).toBeNull()
  })

  it('opens the overview tab and toggles the detail drawer width control', async () => {
    searchState = { server: 'server-1', tab: 'overview' }

    render(<ServersPage />)

    expect(await screen.findByRole('tab', { name: 'Overview', selected: true })).toBeInTheDocument()
    expect(screen.getByText('Server Detail | alpha')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore detail width' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Restore detail width' }))

    expect(await screen.findByRole('button', { name: 'Expand detail width' })).toBeInTheDocument()
  })

  it('opens terminal from server detail actions in a new browser tab and overview can launch edit', async () => {
    searchState = { server: 'server-1', tab: 'overview' }

    render(<ServersPage />)

    expect(await screen.findByRole('tab', { name: 'Overview', selected: true })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/resources/servers',
      search: expect.any(Function),
    })

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Server actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open Terminal' }))

    await waitFor(() => {
      expect(windowOpenMock).toHaveBeenCalledWith(
        'http://localhost:3000/terminal/server/server-1',
        '_blank',
        'noopener,noreferrer'
      )
    })
  })

  it('opens the ports tab in server detail', async () => {
    searchState = { server: 'server-1', tab: 'ports' }

    render(<ServersPage />)

    expect(await screen.findByRole('tab', { name: 'Ports', selected: true })).toBeInTheDocument()
    expect(screen.getByText('Ports panel for server-1')).toBeInTheDocument()
  })

  it('opens the systemd tab in server detail', async () => {
    searchState = { server: 'server-1', tab: 'systemd' }

    render(<ServersPage />)

    expect(await screen.findByRole('tab', { name: 'Systemd', selected: true })).toBeInTheDocument()
    expect(screen.getByText('Services panel for server-1')).toBeInTheDocument()
  })

  it('opens the crontab tab in server detail', async () => {
    searchState = { server: 'server-1', tab: 'cron' }

    render(<ServersPage />)

    expect(await screen.findByRole('tab', { name: 'Crontab', selected: true })).toBeInTheDocument()
    expect(screen.getByText('Crontab panel for server-1')).toBeInTheDocument()
  })

  it('opens the monitor tab and renders monitor-specific content', async () => {
    searchState = { server: 'server-1', tab: 'monitor' }

    render(<ServersPage />)

    expect(await screen.findByRole('tab', { name: 'Monitor', selected: true })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Monitor' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Monitor conclusions' })).toBeInTheDocument()
    expect(screen.getByText('Monitor panel for server-1')).toBeInTheDocument()
  })

  it('places the components tab between connection and monitor', async () => {
    searchState = { server: 'server-1', tab: 'overview' }

    render(<ServersPage />)

    const tabs = await screen.findAllByRole('tab')
    const labels = tabs.map(tab => tab.textContent?.trim() ?? '')
    const connectionIndex = labels.indexOf('Connection')
    const componentsIndex = labels.indexOf('Components')
    const monitorIndex = labels.indexOf('Monitor')

    expect(connectionIndex).toBeGreaterThanOrEqual(0)
    expect(componentsIndex).toBe(connectionIndex + 1)
    expect(monitorIndex).toBe(componentsIndex + 1)
  })

  it('opens the components tab and renders components-specific content', async () => {
    searchState = { server: 'server-1', tab: 'components' }

    sendMock.mockImplementation((path: string) => {
      if (path === '/api/servers/connection') {
        return Promise.resolve({
          items: [
            {
              id: 'server-1',
              name: 'alpha',
              connect_type: 'direct',
              host: '10.0.0.1',
              port: 22,
              user: 'root',
              created_by: 'user-1',
              created_by_name: 'owner@example.com',
              credential: 'secret-1',
              credential_type: 'Password',
              created: '2026-04-16T00:00:00Z',
              updated: '2026-04-16T01:00:00Z',
              facts_json: {
                os: { family: 'linux', distribution: 'ubuntu', version: '24.04' },
                kernel: { release: '6.8.0' },
                architecture: 'amd64',
                cpu: { cores: 4 },
                memory: { total_bytes: 8589934592 },
              },
              facts_observed_at: '2026-04-16T01:02:03Z',
              access: { status: 'unknown', reason: '', checked_at: '', source: 'derived' },
            },
          ],
        })
      }
      if (isMonitorSummaryRequest(path)) {
        return Promise.resolve({ items: [] })
      }
      if (isServerSoftwareCapabilitiesRequest(path)) {
        return Promise.resolve({
          items: [
            {
              capability: 'container_runtime',
              component_key: 'docker',
              installed_state: 'installed',
              ready: true,
              readiness: {
                ok: true,
                os_supported: true,
                privilege_ok: true,
                network_ok: true,
                dependency_ready: true,
              },
            },
          ],
        })
      }
      if (isServerSoftwareComponentRequest(path)) {
        return Promise.resolve({
          component_key: 'docker',
          label: 'Docker Engine',
          target_type: 'server',
          template_kind: 'package',
          installed_state: 'installed',
          detected_version: '27.0.1',
          install_source: 'managed',
          source_evidence: 'apt:docker-ce',
          verification_state: 'healthy',
          verification: {
            state: 'healthy',
            checked_at: '2026-04-16T02:03:04Z',
            details: {
              engine_version: '27.0.1',
              compose_available: true,
              compose_version: '2.27.0',
            },
          },
          preflight: {
            ok: true,
            os_supported: true,
            privilege_ok: true,
            network_ok: true,
            dependency_ready: true,
          },
          available_actions: ['verify', 'upgrade'],
        })
      }
      if (isServerSoftwareRequest(path)) {
        return Promise.resolve({
          items: [
            {
              component_key: 'docker',
              label: 'Docker Engine',
              target_type: 'server',
              template_kind: 'package',
              installed_state: 'installed',
              detected_version: '27.0.1',
              install_source: 'managed',
              source_evidence: 'apt:docker-ce',
              verification_state: 'healthy',
              verification: {
                state: 'healthy',
                checked_at: '2026-04-16T02:03:04Z',
                details: {
                  engine_version: '27.0.1',
                  compose_available: true,
                  compose_version: '2.27.0',
                },
              },
              preflight: {
                ok: true,
                os_supported: true,
                privilege_ok: true,
                network_ok: true,
                dependency_ready: true,
              },
              available_actions: ['verify', 'upgrade'],
            },
            {
              component_key: 'reverse-proxy',
              label: 'Reverse Proxy',
              target_type: 'server',
              template_kind: 'package',
              installed_state: 'installed',
              detected_version: '1.27.0',
              packaged_version: '1.27.1',
              verification_state: 'degraded',
              preflight: {
                ok: false,
                os_supported: true,
                privilege_ok: true,
                network_ok: true,
                dependency_ready: false,
                issues: ['dependency_not_ready: docker is not ready'],
              },
              last_action: { action: 'verify', result: 'failed', at: '2026-04-16T02:03:04Z' },
              available_actions: ['verify', 'reinstall', 'uninstall'],
            },
          ],
        })
      }
      if (path === '/api/collections/groups/records?perPage=500&sort=name') {
        return Promise.resolve({ items: [] })
      }
      if (path === '/api/servers/local/docker-bridge') {
        return Promise.resolve({ interface: 'docker0', address: '172.17.0.1' })
      }
      if (path === '/api/secrets/templates') {
        return Promise.resolve([
          {
            id: 'single_value',
            label: 'Password',
            description: 'Single secret value',
            fields: [{ key: 'value', label: 'Secret Value', type: 'password', required: true }],
          },
        ])
      }
      return Promise.resolve([])
    })

    render(<ServersPage />)

    expect(
      await screen.findByRole('tab', { name: 'Components', selected: true })
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Prerequisites' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Addons' })).toBeInTheDocument()
  })

  it('shows the migrated Docker tab in server detail', async () => {
    searchState = { server: 'server-1', tab: 'docker' }

    render(<ServersPage />)

    expect(await screen.findByRole('tab', { name: 'Docker' })).toBeInTheDocument()
    expect(screen.getByText('Docker panel for server-1')).toBeInTheDocument()
  })

  it('edits the selected credential secret without leaving the server dialog', async () => {
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/servers/connection') {
        return Promise.resolve({ items: [] })
      }
      if (
        path ===
        "/api/collections/secrets/records?filter=(created_source=''||created_source='user')%26%26type!='tunnel_token'%26%26status='active'%26%26(template_id='single_value'||template_id='ssh_key')%26%26(visible_to:length=0||visible_to:each%3F='server')&sort=name"
      ) {
        return Promise.resolve({
          items: [
            {
              id: 'secret-1',
              name: 'ops-password',
              template_id: 'single_value',
            },
          ],
        })
      }
      if (path === '/api/collections/groups/records?perPage=500&sort=name') {
        return Promise.resolve({ items: [] })
      }
      if (path === '/api/servers/local/docker-bridge') {
        return Promise.resolve({ interface: 'docker0', address: '172.17.0.1' })
      }
      if (path === '/api/secrets/templates') {
        return Promise.resolve([
          {
            id: 'single_value',
            label: 'Password',
            description: 'Single secret value',
            fields: [{ key: 'value', label: 'Secret Value', type: 'password', required: true }],
          },
        ])
      }
      if (path === '/api/secrets/secret-1/payload') {
        return Promise.resolve({})
      }
      return Promise.resolve([])
    })

    render(<ServersPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Add Server' }))

    expect(await screen.findByRole('heading', { name: 'Add Server' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Credential (Secret)' }))
    fireEvent.click(await screen.findByRole('button', { name: /ops-password/i }))

    const editSecretButton = await screen.findByRole('button', { name: 'Edit Secret' })
    fireEvent.click(editSecretButton)

    expect(await screen.findByRole('heading', { name: 'Edit Credential' })).toBeInTheDocument()
    expect(getSecretMock).toHaveBeenCalledWith('secret-1')

    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'ops-password-v2' } })
    fireEvent.change(screen.getByLabelText('Secret Value *'), { target: { value: 'new-pass' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Credential' }))

    await waitFor(() => {
      expect(updateSecretMock).toHaveBeenCalledWith('secret-1', {
        name: 'ops-password-v2',
        description: 'Original secret',
      })
      expect(sendMock).toHaveBeenCalledWith('/api/secrets/secret-1/payload', {
        method: 'PUT',
        body: { payload: { value: 'new-pass' } },
      })
      expect(screen.queryByRole('heading', { name: 'Edit Credential' })).toBeNull()
    })
    expect(screen.getByRole('heading', { name: 'Add Server' })).toBeInTheDocument()
  }, 10000)

  it('renders connection type as cards, pre-fills a generated name, and uses the simplified credential action', async () => {
    render(<ServersPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Add Server' }))

    expect(await screen.findByRole('dialog')).toHaveClass('sm:max-w-4xl')
    expect(screen.getByRole('button', { name: 'Connection type help' })).toBeInTheDocument()
    expect(screen.queryByText('Choose how the managed server connects to AppOS.')).toBeNull()
    expect(screen.getByRole('radio', { name: /Direct SSH/i })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.getByRole('radio', { name: /Reverse Tunnel/i })).toHaveAttribute(
      'aria-checked',
      'false'
    )
    expect(screen.getByDisplayValue(/^server-\d{6}$/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Description')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }))

    expect(screen.getByText('Enable it')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Enable it' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.getByLabelText('Description')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Credential (Secret)' }))
    expect(await screen.findByRole('button', { name: 'New credential' })).toBeInTheDocument()
  }, 20000)

  it('requests only user-manageable secrets for server credentials', async () => {
    render(<ServersPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Add Server' }))
    fireEvent.click(screen.getByRole('button', { name: 'Credential (Secret)' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(
        "/api/collections/secrets/records?filter=(created_source=''||created_source='user')%26%26type!='tunnel_token'%26%26status='active'%26%26(template_id='single_value'||template_id='ssh_key')%26%26(visible_to:length=0||visible_to:each%3F='server')&sort=name",
        {}
      )
    })
  })

  it('shows help text only after clicking the question buttons and toggles it closed on second click', async () => {
    render(<ServersPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Add Server' }))

    const connectionHelpButton = screen.getByRole('button', { name: 'Connection type help' })
    const hostHelpButton = screen.getByRole('button', { name: 'Host help' })

    expect(screen.queryByText('Choose how the managed server connects to AppOS.')).toBeNull()
    expect(
      screen.queryByText('Enter the IP address or domain name of the server managed by AppOS.')
    ).toBeNull()

    fireEvent.click(connectionHelpButton)
    expect(
      await screen.findByText('Choose how the managed server connects to AppOS.')
    ).toBeInTheDocument()

    fireEvent.click(connectionHelpButton)
    await waitFor(() => {
      expect(screen.queryByText('Choose how the managed server connects to AppOS.')).toBeNull()
    })

    fireEvent.click(hostHelpButton)
    expect(
      await screen.findByText('Enter the IP address or domain name of the server managed by AppOS.')
    ).toBeInTheDocument()

    fireEvent.click(hostHelpButton)
    await waitFor(() => {
      expect(
        screen.queryByText('Enter the IP address or domain name of the server managed by AppOS.')
      ).toBeNull()
    })
  })

  it('requires host for direct ssh but allows tunnel submission without host or port', async () => {
    render(<ServersPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Add Server' }))

    const createDialog = await screen.findByRole('dialog')
    const nameInput = within(createDialog).getByLabelText(/^Name\*/) as HTMLInputElement
    const hostInput = within(createDialog).getByLabelText(/^Host\*/) as HTMLInputElement
    const portInput = within(createDialog).getByLabelText(/^Port\*/) as HTMLInputElement
    const userInput = within(createDialog).getByLabelText(/^User\*/) as HTMLInputElement

    fireEvent.change(nameInput, { target: { value: 'edge-node' } })
    fireEvent.change(userInput, { target: { value: 'root' } })
    fireEvent.change(hostInput, { target: { value: '' } })
    fireEvent.change(portInput, { target: { value: '22' } })
    expect(hostInput).toBeRequired()
    expect(portInput).toBeRequired()
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Create' }))

    expect(createServerMock).not.toHaveBeenCalled()

    fireEvent.click(within(createDialog).getByRole('radio', { name: /Reverse Tunnel/i }))

    fireEvent.click(within(createDialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(createServerMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'edge-node',
          user: 'root',
          connect_type: 'tunnel',
        })
      )
    })

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    createServerMock.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Add Server' }))
    const secondCreateDialog = await screen.findByRole('dialog')
    fireEvent.change(within(secondCreateDialog).getByLabelText(/^Name\*/), {
      target: { value: 'edge-node-2' },
    })
    fireEvent.change(within(secondCreateDialog).getByLabelText(/^User\*/), {
      target: { value: 'root' },
    })
    fireEvent.change(within(secondCreateDialog).getByLabelText(/^Port\*/), {
      target: { value: '' },
    })
    fireEvent.click(within(secondCreateDialog).getByRole('radio', { name: /Reverse Tunnel/i }))
    fireEvent.click(within(secondCreateDialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(createServerMock).toHaveBeenCalledTimes(1)
    })
  })

  it('fills and locks the host with the current browser hostname and persists is_local', async () => {
    render(<ServersPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Add Server' }))

    const createDialog = await screen.findByRole('dialog')
    fireEvent.change(within(createDialog).getByLabelText(/^Name\*/), {
      target: { value: 'local-edge' },
    })
    fireEvent.change(within(createDialog).getByLabelText(/^User\*/), {
      target: { value: 'root' },
    })

    fireEvent.click(screen.getByRole('checkbox', { name: 'The same host with AppOS' }))

    const hostInput = screen.getByLabelText(/^Host\*/) as HTMLInputElement

    await waitFor(() => {
      expect(hostInput.value).toBe(window.location.hostname)
    })

    expect(hostInput).toHaveAttribute('readonly')

    fireEvent.click(within(createDialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(createServerMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'local-edge',
          user: 'root',
          host: window.location.hostname,
          is_local: true,
          created_by: 'user-1',
        })
      )
    })
  })
})
