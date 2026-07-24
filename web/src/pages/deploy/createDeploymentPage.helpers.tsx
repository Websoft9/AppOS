import * as jsYaml from 'js-yaml'
import { Link } from '@tanstack/react-router'
import { ChevronRight, CircleHelp, Rocket } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import i18n from '@/lib/i18n'
import type { CatalogTemplateField } from '@/lib/catalog-api'
import type { SoftwareComponentDetail } from '@/lib/software-api'
import type { CreateDeploymentEntryMode } from '@/pages/deploy/actions/action-types'
import type {
  RuntimeEnvInputPayload,
  RuntimeInputsPayload,
  SourceBuildPayload,
} from '@/pages/deploy/actions/useActionsController'
import {
  getDockerDependencyIssue,
  type DockerDependencyIssueCode,
} from '@/components/docker/DockerDependencyAlert'

export const SOURCE_LABELS: Record<string, string> = {
  template: i18n.t('deploy:sources.template', 'App Template'),
  compose: i18n.t('deploy:sources.compose', 'Compose File'),
  'git-compose': i18n.t('deploy:sources.gitCompose', 'Git Repository'),
  'docker-command': i18n.t('deploy:sources.dockerCommand', 'Docker Command'),
  'install-script': i18n.t('deploy:sources.installScript', 'Source Packages'),
}

export type ExposureMode = 'port' | 'domain'

export type TemplateServiceItem = {
  name: string
  role: string
  isPrimary: boolean
  containerPort: string
}

export const EXPOSURE_PORT_MIN = 9001
export const EXPOSURE_PORT_MAX = 9099

export function isTemplateFieldBasic(field: CatalogTemplateField) {
  return field.visibility !== 'system' && field.visibility !== 'advanced'
}

export function isTemplateFieldAdvanced(field: CatalogTemplateField) {
  return field.visibility === 'advanced'
}

export function isTemplateFieldHidden(field: CatalogTemplateField) {
  return field.visibility === 'system'
}

export function isTemplateHttpPortField(field: CatalogTemplateField) {
  return field.key.trim().toLowerCase() === 'http_port'
}

export function isSecretBackedTemplateField(field: CatalogTemplateField) {
  return field.storage_mode === 'secret_backed'
}

export function isDatabasePasswordTemplateField(field: CatalogTemplateField) {
  const key = field.key.trim().toLowerCase()
  const label = String(field.label || '')
    .trim()
    .toLowerCase()
  return key === 'db_password' || (label.includes('database') && label.includes('password'))
}

export function isSecretRefValue(value: string) {
  return value.trim().startsWith('secretRef:')
}

export function buildRandomSecretValue(length = 24) {
  const normalizedLength = Math.min(Math.max(length, 12), 64)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()-_=+'
  const cryptoObject = globalThis.crypto
  if (cryptoObject?.getRandomValues) {
    const bytes = new Uint32Array(normalizedLength)
    cryptoObject.getRandomValues(bytes)
    return Array.from(bytes, value => alphabet[value % alphabet.length]).join('')
  }
  return Array.from(
    { length: normalizedLength },
    () => alphabet[Math.floor(Math.random() * alphabet.length)]
  ).join('')
}

export function buildRandomNumericSuffix(length = 4) {
  const normalizedLength = Math.min(Math.max(length, 3), 6)
  const cryptoObject = globalThis.crypto
  if (cryptoObject?.getRandomValues) {
    const bytes = new Uint8Array(normalizedLength)
    cryptoObject.getRandomValues(bytes)
    return Array.from(bytes, value => String(value % 10)).join('')
  }
  return Array.from({ length: normalizedLength }, () =>
    String(Math.floor(Math.random() * 10))
  ).join('')
}

export function slugifySecretPart(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'app'
}

export function buildTemplateSecretName(
  templateKey: string,
  projectName: string,
  field: CatalogTemplateField
) {
  const appPart = slugifySecretPart(projectName || templateKey)
  const fieldPart = slugifySecretPart(field.key)
  return `app-${appPart}-${fieldPart}`
}

export function buildTemplateSecretDescription(
  templateLabel: string,
  projectName: string,
  field: CatalogTemplateField
) {
  const appLabel = projectName.trim() || templateLabel.trim() || 'application'
  return `Generated for ${appLabel} deployment field ${field.label || field.key}`
}

export function recommendExposurePort(seed: string): string {
  const normalized = seed.trim().toLowerCase()
  if (!normalized) return String(EXPOSURE_PORT_MIN)
  let hash = 0
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0
  }
  const span = EXPOSURE_PORT_MAX - EXPOSURE_PORT_MIN + 1
  return String(EXPOSURE_PORT_MIN + (hash % span))
}

export function buildExposurePortCandidates(recommendedPort: string, limit = 5): number[] {
  const parsed = Number(recommendedPort)
  const fallback = EXPOSURE_PORT_MIN
  const base =
    Number.isInteger(parsed) && parsed >= EXPOSURE_PORT_MIN && parsed <= EXPOSURE_PORT_MAX
      ? parsed
      : fallback
  const span = EXPOSURE_PORT_MAX - EXPOSURE_PORT_MIN + 1
  const attempts = Math.min(Math.max(limit, 1), span)

  return Array.from(
    { length: attempts },
    (_, offset) => EXPOSURE_PORT_MIN + ((base - EXPOSURE_PORT_MIN + offset) % span)
  )
}

export function buildTemplateDefaultAppName(templateName: string, templateKey: string): string {
  const base = slugifySecretPart(templateName || templateKey)
  return `${base}-${buildRandomNumericSuffix()}`
}

export function buildTemplateServiceItems(
  templateDetail?: {
    manifest?: { serviceRoles?: Record<string, string> }
    exposure?: Record<string, unknown>
    composeValues?: Record<string, unknown>
  } | null
): TemplateServiceItem[] {
  if (!templateDetail) return []

  const roles = templateDetail.manifest?.serviceRoles || {}
  const exposureService = String(templateDetail.exposure?.service ?? '').trim()
  const composePrimary = String(templateDetail.composeValues?.primaryService ?? '').trim()
  const exposureTargetPort = String(templateDetail.exposure?.targetPort ?? '').trim()
  const rolePrimary = Object.entries(roles).find(([, role]) => role === 'primary')?.[0] || ''
  const primaryService = exposureService || composePrimary || rolePrimary
  const serviceNames = Array.from(
    new Set([
      ...Object.keys(roles),
      ...(exposureService ? [exposureService] : []),
      ...(composePrimary ? [composePrimary] : []),
    ])
  ).filter(Boolean)

  return serviceNames.map(name => ({
    name,
    role: roles[name] || (name === primaryService ? 'primary' : 'service'),
    isPrimary: name === primaryService,
    containerPort: name === primaryService ? exposureTargetPort : '',
  }))
}

export function asObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

export function issueFocusPanel(code?: DockerDependencyIssueCode): 'checklist' | 'history' {
  if (code === 'docker_daemon_unavailable' || code === 'docker_permission_denied') {
    return 'history'
  }
  return 'checklist'
}

export function dockerFixHref(serverId: string, issueCode?: DockerDependencyIssueCode) {
  if (serverId === 'local') {
    return '/platform-components'
  }

  const params = new URLSearchParams({
    server: serverId,
    tab: 'components',
    focusComponent: 'docker',
    focusPanel: issueFocusPanel(issueCode),
    focusSource: 'compose',
  })
  if (issueCode) {
    params.set('focusIssue', issueCode)
  }
  return `/resources/servers?${params.toString()}`
}

export function readDockerReadiness(component: SoftwareComponentDetail) {
  const verificationDetails = asObject(component.verification?.details)
  const engineVersion = String(
    verificationDetails?.engine_version ?? component.detected_version ?? ''
  ).trim()
  const composeAvailable = verificationDetails?.compose_available === true
  const composeVersion = String(verificationDetails?.compose_version ?? '').trim()
  const readinessIssues = component.preflight?.issues ?? []
  const blockingIssue = readinessIssues.find(issue => !issue.startsWith('network_required:')) ?? ''
  const verificationReason = String(component.verification?.reason ?? '').trim()
  const issueCode = getDockerDependencyIssue(verificationReason)?.code
  const blockingMessage =
    blockingIssue ||
    (component.installed_state === 'installed' && !composeAvailable
      ? 'Docker Compose plugin is not available on this target.'
      : '') ||
    verificationReason
  const ready =
    component.installed_state === 'installed' &&
    component.verification_state === 'healthy' &&
    component.preflight?.ok !== false &&
    composeAvailable

  return {
    ready,
    engineVersion,
    composeAvailable,
    composeVersion,
    blockingMessage,
    issueCode,
  }
}

export function buildTemplateDefaults(fields: CatalogTemplateField[]): Record<string, string> {
  const defaults: Record<string, string> = {}
  for (const field of fields) {
    const value = field.default
    const normalizedValue = value == null ? '' : String(value)
    defaults[field.key] =
      normalizedValue || (isDatabasePasswordTemplateField(field) ? buildRandomSecretValue() : '')
  }
  return defaults
}

export function coerceTemplateInputValue(field: CatalogTemplateField, value: string): unknown {
  if (field.type === 'port') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : value
  }
  return value
}

export function buildTemplateInputPayload(
  fields: CatalogTemplateField[],
  values: Record<string, string>
): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const field of fields) {
    if (isTemplateFieldHidden(field) || isTemplateHttpPortField(field)) {
      continue
    }
    const rawValue = values[field.key] ?? ''
    if (!field.required && rawValue.trim() === '') {
      continue
    }
    payload[field.key] = coerceTemplateInputValue(field, rawValue)
  }
  return payload
}

export function hasMissingRequiredTemplateFields(
  fields: CatalogTemplateField[],
  values: Record<string, string>
) {
  return fields.some(
    field =>
      !isTemplateFieldHidden(field) &&
      !isTemplateHttpPortField(field) &&
      field.required &&
      !(values[field.key] ?? '').trim()
  )
}

export function buildRuntimeInputsPayload(
  createEntryMode: CreateDeploymentEntryMode,
  isGit: boolean,
  runtimeEnvInputs: RuntimeEnvInputPayload[],
  srcFiles: File[],
  srcUploaded: string[],
  uploadedFileNames: string[] = []
): RuntimeInputsPayload | undefined {
  if (isGit) return undefined

  const uploadedNameSet = new Set(uploadedFileNames)
  const files = [
    ...srcUploaded.map(name => ({
      name,
      kind:
        createEntryMode === 'install-script'
          ? ('source-package' as const)
          : ('mount-file' as const),
      source_path: `./src/${name}`,
      mount_path: createEntryMode === 'install-script' ? undefined : `./src/${name}`,
      uploaded: true,
    })),
    ...srcFiles.map(file => ({
      name: file.name,
      kind:
        createEntryMode === 'install-script'
          ? ('source-package' as const)
          : ('mount-file' as const),
      source_path: `./src/${file.name}`,
      mount_path: createEntryMode === 'install-script' ? undefined : `./src/${file.name}`,
      uploaded: uploadedNameSet.has(file.name),
    })),
  ]

  if (runtimeEnvInputs.length === 0 && files.length === 0) return undefined

  return {
    ...(runtimeEnvInputs.length > 0 ? { env: runtimeEnvInputs } : {}),
    ...(files.length > 0 ? { files } : {}),
  }
}

export function buildSourceBuildPayload(
  createEntryMode: CreateDeploymentEntryMode,
  projectName: string,
  targetServiceName?: string
): SourceBuildPayload | undefined {
  if (createEntryMode !== 'install-script') return undefined

  const trimmedName = projectName.trim()
  if (!trimmedName) return undefined

  return {
    source_kind: 'uploaded-package',
    source_ref: `apps/${trimmedName}/src`,
    workspace_ref: `apps/${trimmedName}/src`,
    builder_strategy: 'buildpacks',
    ...(targetServiceName?.trim()
      ? { deploy_inputs: { service_name: targetServiceName.trim() } }
      : {}),
    artifact_publication: {
      mode: 'local',
      image_name: `apps/${trimmedName}`,
    },
  }
}

export function extractComposeServiceNames(compose: string): string[] {
  const trimmed = compose.trim()
  if (!trimmed) return []

  try {
    const doc = jsYaml.load(trimmed)
    if (!doc || typeof doc !== 'object') return []
    const services = (doc as { services?: unknown }).services
    if (!services || typeof services !== 'object' || Array.isArray(services)) return []
    return Object.keys(services as Record<string, unknown>)
      .map(name => name.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

export function HelpTip({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <CircleHelp className="ml-1 inline h-3.5 w-3.5 cursor-help text-muted-foreground/60 hover:text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function DeployCreateBreadcrumb() {
  return (
    <nav
      aria-label={i18n.t('deploy:breadcrumb.ariaLabel', 'Breadcrumb')}
      className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground"
    >
      <Link
        to="/deploy"
        search={{} as never}
        className="inline-flex min-w-0 items-center gap-1.5 truncate transition-colors hover:text-foreground"
      >
        <Rocket className="h-4 w-4 shrink-0" />
        <span className="truncate">{i18n.t('deploy:breadcrumb.deploy', 'Deploy')}</span>
      </Link>
      <ChevronRight className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate font-medium text-foreground">
        {i18n.t('deploy:breadcrumb.create', 'Create')}
      </span>
    </nav>
  )
}

export function extractTemplateRequirementDiskGiB(requirements?: Record<string, unknown>): string {
  if (!requirements) return ''
  const raw = requirements.diskGb ?? requirements.storageGb
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return String(raw)
  if (typeof raw === 'string') {
    const parsed = Number(raw)
    if (Number.isFinite(parsed) && parsed > 0) return String(parsed)
  }
  return ''
}
