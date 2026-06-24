import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  List,
  Loader2,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react'
import { CircleHelp } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useOptionalLayout } from '@/contexts/LayoutContext'
import { inspectServerPort } from '@/lib/connect-api'
import {
  useCatalogAppDetail,
  useCatalogAppTemplate,
  type CatalogTemplateField,
} from '@/lib/catalog-api'
import { getLocale } from '@/lib/i18n'
import { iacUploadFile, iacMkdir } from '@/lib/iac-api'
import { pb } from '@/lib/pb'
import {
  getLocalSoftwareComponent,
  getSoftwareComponent,
  type SoftwareComponentDetail,
} from '@/lib/software-api'
import type { CreateDeploymentEntryMode } from '@/pages/deploy/actions/action-types'
import { useActionsController } from '@/pages/deploy/actions/useActionsController'
import type {
  ExposureIntentPayload,
  RuntimeEnvInputPayload,
  RuntimeInputsPayload,
  SourceBuildPayload,
} from '@/pages/deploy/actions/useActionsController'
import { CreateDeploymentExposureSection } from '@/pages/deploy/CreateDeploymentExposureSection'
import { OrchestrationSection } from '@/pages/deploy/OrchestrationSection'
import { CreateDeploymentReviewPanel } from '@/pages/deploy/CreateDeploymentReviewPanel'
import {
  HelpTip,
  DeployCreateBreadcrumb,
  buildRandomSecretValue,
  buildRuntimeInputsPayload,
  buildSourceBuildPayload,
  buildExposurePortCandidates,
  buildTemplateDefaultAppName,
  buildTemplateDefaults,
  buildTemplateInputPayload,
  buildTemplateSecretDescription,
  buildTemplateSecretName,
  buildTemplateServiceItems,
  dockerFixHref,
  extractComposeServiceNames,
  extractTemplateRequirementDiskGiB,
  hasMissingRequiredTemplateFields,
  isDatabasePasswordTemplateField,
  isSecretBackedTemplateField,
  isSecretRefValue,
  isTemplateFieldAdvanced,
  isTemplateFieldBasic,
  isTemplateFieldHidden,
  isTemplateHttpPortField,
  readDockerReadiness,
  recommendExposurePort,
} from '@/pages/deploy/createDeploymentPage.helpers'

type CreateDeploymentPageProps = {
  prefillMode?: string
  prefillSource?: string
  prefillAppId?: string
  prefillAppKey?: string
  prefillAppName?: string
  prefillServerId?: string
  entryMode?: CreateDeploymentEntryMode
}

type NameAvailabilityResult = {
  ok?: boolean
  project_name?: string
  normalized_name?: string
  message?: string
}

type TemplateSecretState = {
  id: string
  rawValue: string
}

type SectionHeadingProps = {
  title: string
  description: string
  helpText?: string
}

type FormRowProps = {
  label: string
  htmlFor: string
  helpText?: string
  required?: boolean
  children: ReactNode
  hint?: ReactNode
}

const FORM_CONTROL_CLASS = 'w-[30rem] max-w-full'
const FORM_SECTION_CLASS = 'max-w-[40rem]'

function SectionHeading({ title, description, helpText }: SectionHeadingProps) {
  return (
    <div className="px-1">
      <div className="flex items-center gap-1">
        <span className="text-base font-semibold tracking-tight">{title}</span>
        {helpText ? <HelpTip text={helpText} /> : null}
      </div>
      <div className="text-xs text-muted-foreground">{description}</div>
    </div>
  )
}

function FormRow({ label, htmlFor, helpText, required, children, hint }: FormRowProps) {
  return (
    <div className="grid gap-2 md:grid-cols-[140px_minmax(0,1fr)] md:gap-3">
      <div className="flex items-center gap-1 md:pt-2">
        <Label htmlFor={htmlFor} className="text-xs font-medium">
          {label}
          {required ? (
            <span aria-hidden="true" className="text-destructive">
              {' '}
              *
            </span>
          ) : null}
        </Label>
        {helpText ? <HelpTip text={helpText} /> : null}
      </div>
      <div>
        {children}
        {hint ? (
          <div className="mt-1 text-[11px] leading-5 text-muted-foreground">{hint}</div>
        ) : null}
      </div>
    </div>
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
  const locale = getLocale()
  const layout = useOptionalLayout()
  const setHeaderRightStartContent = layout?.setHeaderRightStartContent
  const {
    servers,
    notice,
    setNotice,
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
    appRequiredDiskGiB,
    setAppRequiredDiskGiB,
    checkResult,
    setCheckResult,
    checking,
    gitChecking,
    submitting,
    gitSubmitting,
    checkManualOperation,
    checkGitOperation,
    checkTemplateOperation,
    submitManualOperation,
    submitTemplateOperation,
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

  const [templateKey, setTemplateKey] = useState(prefillAppKey || '')
  const [templateInputValues, setTemplateInputValues] = useState<Record<string, string>>({})
  const [templateSecretState, setTemplateSecretState] = useState<
    Record<string, TemplateSecretState>
  >({})
  const [templateSecretRevealState, setTemplateSecretRevealState] = useState<
    Record<string, boolean>
  >({})
  const isGit = createEntryMode === 'git-compose'
  const isTemplate = createEntryMode === 'template'
  const activeName = isGit ? gitProjectName : projectName
  const activeSubmitting = isGit ? gitSubmitting : submitting
  const activeChecking = isGit ? gitChecking : checking
  const { data: templateDetail, isLoading: templateLoading } = useCatalogAppTemplate(
    templateKey || null,
    isTemplate && Boolean(templateKey)
  )
  const { data: templateAppDetail } = useCatalogAppDetail(
    locale,
    templateKey || null,
    isTemplate && Boolean(templateKey)
  )
  const [composeYamlError, setComposeYamlError] = useState<string | null>(null)
  const [dockerReadiness, setDockerReadiness] = useState<SoftwareComponentDetail | null>(null)
  const [dockerReadinessLoading, setDockerReadinessLoading] = useState(false)
  const [dockerReadinessError, setDockerReadinessError] = useState('')

  const templateFields = templateDetail?.inputs || []
  const templateBasicFields = useMemo(
    () =>
      templateFields
        .filter(
          field =>
            isTemplateFieldBasic(field) &&
            !isTemplateHttpPortField(field) &&
            !isDatabasePasswordTemplateField(field)
        )
        .sort((left, right) => {
          const leftIsVersion =
            left.key.trim().toLowerCase() === 'version' ||
            String(left.label || '')
              .trim()
              .toLowerCase() === 'version'
          const rightIsVersion =
            right.key.trim().toLowerCase() === 'version' ||
            String(right.label || '')
              .trim()
              .toLowerCase() === 'version'
          if (leftIsVersion === rightIsVersion) return 0
          return leftIsVersion ? -1 : 1
        }),
    [templateFields]
  )
  const templateAdvancedFields = templateFields.filter(
    field =>
      (isTemplateFieldAdvanced(field) || isDatabasePasswordTemplateField(field)) &&
      !isTemplateHttpPortField(field)
  )
  const templateHiddenFields = templateFields.filter(
    field => isTemplateFieldHidden(field) && !isTemplateHttpPortField(field)
  )
  const templateServiceItems = useMemo(
    () => buildTemplateServiceItems(templateDetail),
    [templateDetail]
  )
  const templatePrimaryService = templateServiceItems.find(item => item.isPrimary) || null
  const templateDatabaseService =
    templateServiceItems.find(item => item.role.toLowerCase() === 'database') || null
  const hasTemplateDatabaseSource = templateFields.some(field =>
    isDatabasePasswordTemplateField(field)
  )
  const templateDisplayName =
    prefillAppName ||
    templateAppDetail?.title ||
    templateDetail?.manifest.trademark ||
    templateDetail?.manifest.name ||
    templateDetail?.templateKey ||
    ''
  const templateDisplayInitial = templateDisplayName.trim().charAt(0).toUpperCase() || 'T'
  const templateVersionField = useMemo(
    () =>
      templateBasicFields.find(
        field =>
          field.key.trim().toLowerCase() === 'version' ||
          String(field.label || '')
            .trim()
            .toLowerCase() === 'version'
      ) || null,
    [templateBasicFields]
  )
  const templateRemainingBasicFields = useMemo(
    () => templateBasicFields.filter(field => field.key !== templateVersionField?.key),
    [templateBasicFields, templateVersionField]
  )
  const templateRequirementDiskGiB = useMemo(
    () => extractTemplateRequirementDiskGiB(templateDetail?.manifest.requirements),
    [templateDetail?.manifest.requirements]
  )
  const templateInputPayload = useMemo(
    () => buildTemplateInputPayload(templateFields, templateInputValues),
    [templateFields, templateInputValues]
  )

  // ── Src file state (shared with OrchestrationSection, uploaded on submit) ──
  const [srcFiles, setSrcFiles] = useState<File[]>([])
  const [srcUploading, setSrcUploading] = useState(false)
  const [srcUploaded, setSrcUploaded] = useState<string[]>([])
  const [runtimeEnvInputs, setRuntimeEnvInputs] = useState<RuntimeEnvInputPayload[]>([])
  const [targetServiceName, setTargetServiceName] = useState('')
  const [helpVisible, setHelpVisible] = useState(false)
  const [preflightVisible, setPreflightVisible] = useState(false)
  const [portExposureEnabled, setPortExposureEnabled] = useState(false)
  const [domainExposureEnabled, setDomainExposureEnabled] = useState(true)
  const [servicePortMappings, setServicePortMappings] = useState<
    Record<string, { enabled: boolean; port: string }>
  >({})

  const composeServiceNames = useMemo(() => {
    if (createEntryMode !== 'install-script' || composeYamlError) return []
    return extractComposeServiceNames(compose)
  }, [compose, composeYamlError, createEntryMode])

  const sourceBuildTargetServiceRequired =
    createEntryMode === 'install-script' && composeServiceNames.length > 1

  const runtimeInputs = useMemo<RuntimeInputsPayload | undefined>(() => {
    return buildRuntimeInputsPayload(
      createEntryMode,
      isGit,
      runtimeEnvInputs,
      srcFiles,
      srcUploaded
    )
  }, [createEntryMode, isGit, runtimeEnvInputs, srcFiles, srcUploaded])
  const sourceBuild = useMemo<SourceBuildPayload | undefined>(() => {
    return buildSourceBuildPayload(createEntryMode, projectName, targetServiceName)
  }, [createEntryMode, projectName, targetServiceName])

  const sourceBuildTargetServiceError =
    sourceBuildTargetServiceRequired && !targetServiceName.trim()
      ? 'Select which service should use the locally built application image.'
      : null
  const recommendedExposurePort = useMemo(
    () => recommendExposurePort(`${serverId}:${activeName}`),
    [activeName, serverId]
  )
  const [effectiveRecommendedExposurePort, setEffectiveRecommendedExposurePort] =
    useState(recommendedExposurePort)
  const [recommendedExposurePortHint, setRecommendedExposurePortHint] = useState<string | null>(
    null
  )
  const [serverSearchQuery, setServerSearchQuery] = useState('')
  const [autoManagePrimaryExposurePort, setAutoManagePrimaryExposurePort] = useState(true)
  const exposureServiceItems = useMemo(
    () =>
      isTemplate && templateServiceItems.length > 0
        ? templateServiceItems
        : [{ name: 'primary', role: 'primary', isPrimary: true }],
    [isTemplate, templateServiceItems]
  )
  const exposurePrimaryService =
    exposureServiceItems.find(item => item.isPrimary) || exposureServiceItems[0] || null

  useEffect(() => {
    if (!portExposureEnabled || !serverId || !activeName.trim()) {
      setEffectiveRecommendedExposurePort(recommendedExposurePort)
      setRecommendedExposurePortHint(null)
      return
    }

    let cancelled = false

    const resolveRecommendedExposurePort = async () => {
      setEffectiveRecommendedExposurePort(recommendedExposurePort)
      setRecommendedExposurePortHint(null)
      const candidates = buildExposurePortCandidates(recommendedExposurePort, 99)

      try {
        for (const candidate of candidates) {
          const result = await inspectServerPort(serverId, candidate, 'all', 'tcp')
          if (cancelled) return

          const occupied = result.occupancy?.occupied === true
          const reserved = result.reservation?.reserved === true
          if (!occupied && !reserved) {
            const nextPort = String(candidate)
            setEffectiveRecommendedExposurePort(nextPort)
            setRecommendedExposurePortHint(
              nextPort === recommendedExposurePort
                ? null
                : `Primary recommended port ${recommendedExposurePort} is already in use or reserved on this server. Suggested ${nextPort} instead.`
            )
            return
          }
        }

        setEffectiveRecommendedExposurePort(recommendedExposurePort)
        setRecommendedExposurePortHint(
          `Primary recommended port ${recommendedExposurePort} may already be in use or reserved on this server. Review it before deploying.`
        )
      } catch {
        if (cancelled) return
        setEffectiveRecommendedExposurePort(recommendedExposurePort)
        setRecommendedExposurePortHint(null)
      }
    }

    void resolveRecommendedExposurePort()

    return () => {
      cancelled = true
    }
  }, [activeName, portExposureEnabled, recommendedExposurePort, serverId])

  useEffect(() => {
    setServicePortMappings(current => {
      const next: Record<string, { enabled: boolean; port: string }> = {}
      for (const service of exposureServiceItems) {
        const previous = current[service.name]
        next[service.name] = {
          enabled: previous?.enabled ?? service.isPrimary,
          port: service.isPrimary
            ? autoManagePrimaryExposurePort
              ? effectiveRecommendedExposurePort
              : (previous?.port ?? effectiveRecommendedExposurePort)
            : (previous?.port ?? ''),
        }
      }
      return next
    })
  }, [autoManagePrimaryExposurePort, effectiveRecommendedExposurePort, exposureServiceItems])

  const primaryPortMapping = exposurePrimaryService
    ? servicePortMappings[exposurePrimaryService.name] || {
        enabled: exposurePrimaryService.isPrimary,
        port: effectiveRecommendedExposurePort,
      }
    : null
  const mappedServiceNames = exposureServiceItems
    .filter(item => servicePortMappings[item.name]?.enabled ?? item.isPrimary)
    .map(item => item.name)
  const parsedExposurePort = useMemo(() => {
    if (!portExposureEnabled || !primaryPortMapping?.enabled) return null
    const trimmed = primaryPortMapping.port.trim()
    if (!trimmed) return null
    const parsed = Number(trimmed)
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) return null
    return parsed
  }, [portExposureEnabled, primaryPortMapping])
  const exposureSelectionError =
    portExposureEnabled && mappedServiceNames.length === 0
      ? 'Enable at least one service row when Server Port Access is selected.'
      : null
  const exposurePortError =
    portExposureEnabled && primaryPortMapping?.enabled && parsedExposurePort == null
      ? 'Enter a valid server port between 1 and 65535.'
      : null
  const extraServiceMappingMessage =
    portExposureEnabled &&
    exposureServiceItems.some(
      item => !item.isPrimary && (servicePortMappings[item.name]?.enabled ?? false)
    )
      ? 'Additional service server-port mappings are listed for planning, but only the primary service mapping is submitted in this release.'
      : null
  const exposureDomainMessage =
    'Domain access currently applies only to the primary service and remains pending for backend submission.'
  const exposureIntent = useMemo<ExposureIntentPayload | undefined>(() => {
    if (portExposureEnabled && parsedExposurePort) {
      return { exposure_type: 'port', is_primary: true, target_port: parsedExposurePort }
    }
    if (!portExposureEnabled && !domainExposureEnabled) {
      return { exposure_type: 'internal_only', is_primary: true }
    }
    return undefined
  }, [domainExposureEnabled, portExposureEnabled, parsedExposurePort])

  useEffect(() => {
    if (!serverId) {
      setDockerReadiness(null)
      setDockerReadinessError('')
      setDockerReadinessLoading(false)
      return
    }

    let cancelled = false
    setDockerReadiness(null)
    setDockerReadinessError('')
    setDockerReadinessLoading(true)

    const load = async () => {
      try {
        const component =
          serverId === 'local'
            ? await getLocalSoftwareComponent('docker')
            : await getSoftwareComponent(serverId, 'docker')
        if (!cancelled) {
          setDockerReadiness(component)
        }
      } catch (error) {
        if (!cancelled) {
          setDockerReadiness(null)
          setDockerReadinessError(
            error instanceof Error ? error.message : 'Failed to check Docker readiness'
          )
        }
      } finally {
        if (!cancelled) {
          setDockerReadinessLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [serverId])

  useEffect(() => {
    if (!isTemplate) {
      return
    }
    if (prefillAppKey?.trim()) {
      setTemplateKey(prefillAppKey.trim())
    }
  }, [isTemplate, prefillAppKey])

  useEffect(() => {
    if (!setHeaderRightStartContent) return undefined
    setHeaderRightStartContent(<DeployCreateBreadcrumb />)
    return () => setHeaderRightStartContent(null)
  }, [setHeaderRightStartContent])

  useEffect(() => {
    if (!isTemplate || !templateDetail) {
      return
    }
    setTemplateInputValues(buildTemplateDefaults(templateDetail.inputs))
    setTemplateSecretState({})
    setTemplateSecretRevealState({})
    const nextSuggestedName = buildTemplateDefaultAppName(
      prefillAppName ||
        templateDetail.manifest.trademark ||
        templateDetail.manifest.name ||
        templateDetail.templateKey,
      templateDetail.templateKey
    )
    if (!projectName.trim()) {
      setProjectName(nextSuggestedName)
    }
    if (!appRequiredDiskGiB.trim()) {
      const nextDisk = extractTemplateRequirementDiskGiB(templateDetail.manifest.requirements)
      if (nextDisk) {
        setAppRequiredDiskGiB(nextDisk)
      }
    }
  }, [
    appRequiredDiskGiB,
    isTemplate,
    prefillAppName,
    projectName,
    setAppRequiredDiskGiB,
    setProjectName,
    templateDetail,
  ])

  const setTemplateInputValue = useCallback((fieldKey: string, value: string) => {
    setTemplateInputValues(current => ({
      ...current,
      [fieldKey]: value,
    }))
  }, [])

  const persistSecretBackedTemplateInputs = useCallback(async () => {
    const nextPayload = buildTemplateInputPayload(templateFields, templateInputValues)
    const nextSecretState = { ...templateSecretState }
    const templateLabel = prefillAppName || templateDetail?.manifest.trademark || templateKey

    for (const field of templateFields) {
      if (isTemplateFieldHidden(field) || !isSecretBackedTemplateField(field)) {
        continue
      }

      const rawValue = String(templateInputValues[field.key] ?? '')
      const trimmedValue = rawValue.trim()
      if (!trimmedValue) {
        delete nextSecretState[field.key]
        continue
      }

      if (isSecretRefValue(trimmedValue)) {
        nextPayload[field.key] = trimmedValue
        delete nextSecretState[field.key]
        continue
      }

      const cached = nextSecretState[field.key]
      let secretId = cached?.id ?? ''

      if (cached?.id && cached.rawValue !== trimmedValue) {
        await pb.send(`/api/secrets/${cached.id}/payload`, {
          method: 'PUT',
          body: { payload: { value: trimmedValue } },
        })
      }

      if (!secretId) {
        const created = await pb.collection('secrets').create({
          name: buildTemplateSecretName(templateKey, projectName, field),
          description: buildTemplateSecretDescription(templateLabel, projectName, field),
          template_id: 'single_value',
          scope: 'global',
          visible_to: ['application'],
          payload: { value: trimmedValue },
        })
        secretId = String(created.id ?? '')
      }

      if (!secretId) {
        throw new Error(`Failed to store secret for ${field.label || field.key}`)
      }

      nextSecretState[field.key] = { id: secretId, rawValue: trimmedValue }
      nextPayload[field.key] = `secretRef:${secretId}`
    }

    setTemplateSecretState(nextSecretState)
    return nextPayload
  }, [
    prefillAppName,
    projectName,
    templateDetail?.manifest.trademark,
    templateFields,
    templateInputValues,
    templateKey,
    templateSecretState,
  ])

  const renderTemplateFieldInput = useCallback(
    (field: CatalogTemplateField, inputId: string) => {
      if (field.type === 'select') {
        return (
          <select
            id={inputId}
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
            value={templateInputValues[field.key] ?? ''}
            onChange={e => setTemplateInputValue(field.key, e.target.value)}
          >
            {(field.options || []).map(option => (
              <option key={String(option)} value={String(option)}>
                {String(option)}
              </option>
            ))}
          </select>
        )
      }

      if (isSecretBackedTemplateField(field)) {
        const rawValue = templateInputValues[field.key] ?? ''
        const savedSecret = templateSecretState[field.key]
        const isExistingRef = isSecretRefValue(rawValue)
        const isRevealed = Boolean(templateSecretRevealState[field.key])

        return (
          <div className="space-y-2">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id={inputId}
                  type={isRevealed ? 'text' : 'password'}
                  value={rawValue}
                  onChange={e => setTemplateInputValue(field.key, e.target.value)}
                  placeholder="Generate or enter a secret value"
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                  title={isRevealed ? 'Hide secret value' : 'Show secret value'}
                  onClick={() =>
                    setTemplateSecretRevealState(current => ({
                      ...current,
                      [field.key]: !isRevealed,
                    }))
                  }
                >
                  {isRevealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setTemplateInputValue(field.key, buildRandomSecretValue())}
              >
                Generate
              </Button>
            </div>
            <div className="text-[11px] text-muted-foreground">
              {isExistingRef
                ? 'Using an existing secret reference.'
                : savedSecret && savedSecret.rawValue === rawValue.trim()
                  ? 'Stored in Secrets. Change to update.'
                  : 'Stored as Secret. Only ref sent.'}
            </div>
          </div>
        )
      }

      return (
        <Input
          id={inputId}
          type={field.type === 'port' ? 'number' : 'text'}
          value={templateInputValues[field.key] ?? ''}
          onChange={e => setTemplateInputValue(field.key, e.target.value)}
          placeholder={field.default == null ? '' : String(field.default)}
          className="w-full"
        />
      )
    },
    [setTemplateInputValue, templateInputValues, templateSecretRevealState, templateSecretState]
  )

  const createDisabled = isGit
    ? !activeName.trim() ||
      !gitRepositoryUrl.trim() ||
      !gitComposePath.trim() ||
      !serverId ||
      activeSubmitting
    : isTemplate
      ? !activeName.trim() ||
        !templateKey ||
        !serverId ||
        activeSubmitting ||
        hasMissingRequiredTemplateFields(templateFields, templateInputValues) ||
        Boolean(exposureSelectionError) ||
        Boolean(extraServiceMappingMessage) ||
        (domainExposureEnabled && !portExposureEnabled) ||
        Boolean(exposurePortError)
      : !activeName.trim() ||
        !compose.trim() ||
        !serverId ||
        activeSubmitting ||
        Boolean(composeYamlError) ||
        Boolean(sourceBuildTargetServiceError) ||
        Boolean(exposureSelectionError) ||
        Boolean(extraServiceMappingMessage) ||
        (domainExposureEnabled && !portExposureEnabled) ||
        Boolean(exposurePortError)
  const checkDisabled = isGit
    ? !activeName.trim() ||
      !gitRepositoryUrl.trim() ||
      !gitComposePath.trim() ||
      !serverId ||
      activeChecking
    : isTemplate
      ? !activeName.trim() ||
        !templateKey ||
        !serverId ||
        activeChecking ||
        hasMissingRequiredTemplateFields(templateFields, templateInputValues)
      : !activeName.trim() ||
        !compose.trim() ||
        !serverId ||
        activeChecking ||
        Boolean(composeYamlError) ||
        Boolean(sourceBuildTargetServiceError)

  useEffect(() => {
    if (createEntryMode !== 'install-script') {
      setTargetServiceName('')
      return
    }
    if (composeServiceNames.length === 1) {
      setTargetServiceName(composeServiceNames[0] ?? '')
      return
    }
    if (composeServiceNames.length === 0) {
      setTargetServiceName('')
      return
    }
    setTargetServiceName(current => (composeServiceNames.includes(current) ? current : ''))
  }, [composeServiceNames, createEntryMode])

  // ── Submit with src uploads ──
  const handleSubmit = useCallback(async () => {
    setPreflightVisible(true)
    const normalizedTemplatePayload = isTemplate
      ? await persistSecretBackedTemplateInputs()
      : templateInputPayload
    const preflight = isGit
      ? await checkGitOperation({ silentNotice: true, exposureIntent })
      : isTemplate
        ? await checkTemplateOperation(templateKey, normalizedTemplatePayload, {
            silentNotice: true,
            exposureIntent,
          })
        : await checkManualOperation({
            silentNotice: true,
            runtimeInputs,
            sourceBuild,
            exposureIntent,
          })

    if (!preflight) {
      return
    }

    if (!preflight.ok) {
      setNotice({
        variant: 'destructive',
        message: `Create blocked by preflight: ${preflight.message}`,
      })
      return
    }

    const uploadedFileNames: string[] = []
    if (!isTemplate && srcFiles.length > 0 && projectName.trim()) {
      setSrcUploading(true)
      try {
        const dir = `apps/${projectName.trim()}/src`
        await iacMkdir(dir)
        for (const file of srcFiles) {
          await iacUploadFile(dir, file)
          uploadedFileNames.push(file.name)
        }
        setSrcUploaded(prev => Array.from(new Set([...prev, ...uploadedFileNames])))
        setSrcFiles(prev => prev.filter(file => !uploadedFileNames.includes(file.name)))
      } catch {
        // continue with deployment even if upload fails
      } finally {
        setSrcUploading(false)
      }
    }
    if (isGit) {
      await submitGitOperation(exposureIntent)
    } else if (isTemplate) {
      await submitTemplateOperation(templateKey, normalizedTemplatePayload, exposureIntent)
    } else {
      await submitManualOperation(
        buildRuntimeInputsPayload(
          createEntryMode,
          isGit,
          runtimeEnvInputs,
          srcFiles,
          srcUploaded,
          uploadedFileNames
        ),
        sourceBuild,
        exposureIntent
      )
    }
  }, [
    createEntryMode,
    checkGitOperation,
    checkManualOperation,
    checkTemplateOperation,
    exposureIntent,
    isGit,
    isTemplate,
    runtimeEnvInputs,
    setNotice,
    srcFiles,
    projectName,
    srcUploaded,
    sourceBuild,
    submitTemplateOperation,
    templateInputPayload,
    templateKey,
    persistSecretBackedTemplateInputs,
    runtimeInputs,
    submitGitOperation,
    submitManualOperation,
    setPreflightVisible,
  ])

  const handleCheck = useCallback(() => {
    setPreflightVisible(true)
    void (async () => {
      if (isGit) {
        await checkGitOperation({ exposureIntent })
        return
      }
      if (isTemplate) {
        const normalizedTemplatePayload = await persistSecretBackedTemplateInputs()
        await checkTemplateOperation(templateKey, normalizedTemplatePayload, {
          exposureIntent,
        })
        return
      }
      await checkManualOperation({ runtimeInputs, sourceBuild, exposureIntent })
    })()
  }, [
    checkGitOperation,
    checkManualOperation,
    checkTemplateOperation,
    exposureIntent,
    isGit,
    isTemplate,
    persistSecretBackedTemplateInputs,
    runtimeInputs,
    sourceBuild,
    setPreflightVisible,
    templateKey,
  ])
  const dockerReadinessState = useMemo(() => {
    if (!serverId) return null
    if (dockerReadinessLoading) {
      return {
        tone: 'loading' as const,
        label: 'Checking',
        title: 'Checking Docker readiness',
        description: 'Reviewing Docker and Compose prerequisites for this target.',
      }
    }
    if (dockerReadinessError) {
      return {
        tone: 'error' as const,
        label: 'Need Fix',
        title: 'Docker readiness check is unavailable',
        description: dockerReadinessError,
      }
    }
    if (!dockerReadiness || dockerReadiness.component_key !== 'docker') {
      return null
    }

    const summary = readDockerReadiness(dockerReadiness)
    if (summary.ready) {
      return {
        tone: 'ready' as const,
        label: 'Ready',
        title: 'Docker prerequisites are ready',
        description:
          [
            summary.engineVersion ? `Engine ${summary.engineVersion}` : '',
            summary.composeVersion ? `Compose ${summary.composeVersion}` : '',
          ]
            .filter(Boolean)
            .join(' · ') || 'Docker Engine and Compose are available on this target.',
      }
    }

    return {
      tone: 'attention' as const,
      label: 'Need Fix',
      title: 'Docker prerequisites need attention',
      description:
        summary.blockingMessage || 'Open prerequisites to repair Docker before deploying.',
      href: dockerFixHref(serverId, summary.issueCode),
      actionLabel:
        serverId === 'local' ? 'Open Platform Components' : 'Open Components > Prerequisites',
    }
  }, [dockerReadiness, dockerReadinessError, dockerReadinessLoading, serverId])

  useEffect(() => {
    setCheckResult(null)
  }, [
    JSON.stringify(templateInputValues),
    templateKey,
    compose,
    gitAuthHeaderName,
    gitAuthHeaderValue,
    gitComposePath,
    gitRef,
    gitRepositoryUrl,
    isGit,
    projectName,
    gitProjectName,
    isTemplate,
    portExposureEnabled,
    domainExposureEnabled,
    JSON.stringify(servicePortMappings),
    serverId,
    appRequiredDiskGiB,
    setCheckResult,
  ])

  const preflightSummary = checkResult?.checks?.ports
  const diskSummary = checkResult?.checks?.disk_space
  const portItems = preflightSummary?.items || []
  const nameRequestSequenceRef = useRef(0)
  const [nameTouched, setNameTouched] = useState(false)
  const [nameResult, setNameResult] = useState<NameAvailabilityResult | null>(null)
  const [nameCheckedValue, setNameCheckedValue] = useState('')

  const nameHint = useMemo(() => {
    if (!nameTouched || !activeName.trim()) return null
    if (nameResult?.ok === false) return nameResult.message || 'Application name is unavailable'
    return null
  }, [activeName, nameResult, nameTouched])

  const reviewMessages = useMemo(() => {
    const messages: string[] = []

    const pushMessage = (message?: string, include?: boolean) => {
      const normalized = message?.trim()
      if (!include || !normalized || messages.includes(normalized)) return
      messages.push(normalized)
    }

    pushMessage(checkResult?.checks?.app_name?.message, checkResult?.checks?.app_name?.ok === false)
    pushMessage(nameResult?.message, nameResult?.ok === false)
    pushMessage(
      preflightSummary?.message,
      Boolean(
        preflightSummary?.conflict ||
        (preflightSummary?.ok === false && preflightSummary?.status !== 'unavailable')
      )
    )
    pushMessage(
      diskSummary?.message,
      Boolean(
        diskSummary?.conflict ||
        (diskSummary?.ok === false && diskSummary?.status !== 'unavailable')
      )
    )

    for (const warning of checkResult?.warnings || []) {
      pushMessage(warning, true)
    }

    return messages
  }, [checkResult, diskSummary, nameResult, preflightSummary])

  const selectedServer = useMemo(
    () => servers.find(item => item.id === serverId) || null,
    [serverId, servers]
  )
  const filteredServers = useMemo(() => {
    const query = serverSearchQuery.trim().toLowerCase()
    if (!query) return servers
    return servers.filter(server => {
      const label = String(server.label ?? '').toLowerCase()
      const host = String(server.host ?? '').toLowerCase()
      return label.includes(query) || host.includes(query)
    })
  }, [serverSearchQuery, servers])
  const targetLabel = selectedServer
    ? selectedServer.label
    : serverId
      ? 'Selected target'
      : 'Not set'
  const exposureSummary = domainExposureEnabled
    ? 'Domain Access'
    : portExposureEnabled
      ? 'Port Access'
      : 'Public access blocked'

  useEffect(() => {
    if (!activeName.trim()) {
      setNameResult(null)
      setNameCheckedValue('')
      return
    }
    if (nameCheckedValue && nameCheckedValue !== activeName.trim()) {
      setNameResult(null)
    }
  }, [activeName, nameCheckedValue])

  const checkNameAvailability = useCallback((name: string) => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setNameResult(null)
      setNameCheckedValue('')
      return Promise.resolve()
    }

    const requestId = nameRequestSequenceRef.current + 1
    nameRequestSequenceRef.current = requestId

    return pb
      .send<NameAvailabilityResult>('/api/actions/install/name-availability', {
        method: 'POST',
        body: { project_name: trimmedName },
      })
      .then(result => {
        if (nameRequestSequenceRef.current !== requestId) return
        setNameResult(result)
        setNameCheckedValue(trimmedName)
      })
      .catch(() => {
        if (nameRequestSequenceRef.current !== requestId) return
        setNameResult(null)
        setNameCheckedValue(trimmedName)
      })
  }, [])

  return (
    <div className="flex flex-col gap-4">
      {!setHeaderRightStartContent ? <DeployCreateBreadcrumb /> : null}

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Create Deployment</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Define and launch a new application deployment on a target server.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 w-9 px-0"
            aria-label="Toggle deployment help"
            aria-expanded={helpVisible}
            onClick={() => setHelpVisible(v => !v)}
          >
            <CircleHelp className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/activity" params={{} as never} search={{} as never}>
              <List className="mr-1 h-4 w-4" />
              Activity
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Alerts ── */}
      {notice?.variant === 'destructive' ? (
        <Alert
          variant={notice.variant}
          className="flex w-full max-w-[66.75rem] items-center justify-between py-2"
        >
          <AlertDescription>{notice.message}</AlertDescription>
          <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>
            <X className="h-3 w-3" />
          </Button>
        </Alert>
      ) : null}

      {/* ════ Two-column: Form workspace │ Review panel ════ */}
      <div className="grid gap-7 xl:grid-cols-[40rem_25rem] xl:justify-start">
        {/* ──── Left: Form workspace ──── */}
        <div className="space-y-6 p-4 xl:p-5">
          {/* ── Section 1: Basic ── */}
          <div>
            <section className="px-1 py-1">
              <div className={`grid gap-4 ${FORM_SECTION_CLASS}`}>
                <FormRow
                  label="App Name"
                  htmlFor="deploy-name"
                  required
                  helpText="Must be unique across the server. Used as compose project name and the app data directory root."
                  hint={
                    nameHint ? (
                      <span className="text-amber-700 dark:text-amber-400">{nameHint}</span>
                    ) : null
                  }
                >
                  <Input
                    id="deploy-name"
                    className={FORM_CONTROL_CLASS}
                    value={activeName}
                    onChange={e => {
                      if (isGit) {
                        setGitProjectName(e.target.value)
                      } else {
                        setProjectName(e.target.value)
                      }
                    }}
                    onBlur={() => {
                      setNameTouched(true)
                      void checkNameAvailability(activeName)
                    }}
                    placeholder={
                      isGit ? 'Required, e.g. repo-app' : 'Required, e.g. wordpress-prod'
                    }
                    required
                  />
                </FormRow>
                <FormRow
                  label="Target Location"
                  htmlFor="deploy-server"
                  required
                  helpText="The target server where containers will be created and managed."
                  hint={
                    servers.length === 0 ? (
                      <span>
                        No servers are available.{' '}
                        <a
                          href="/resources/servers"
                          className="font-medium text-primary underline underline-offset-2"
                        >
                          Add a server
                        </a>
                        .
                      </span>
                    ) : null
                  }
                >
                  <div className="space-y-2">
                    {servers.length > 10 ? (
                      <div className="relative w-[30rem] max-w-full">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={serverSearchQuery}
                          onChange={e => setServerSearchQuery(e.target.value)}
                          placeholder="Search servers by name or host"
                          className="pl-8"
                          aria-label="Search target servers"
                        />
                      </div>
                    ) : null}
                    <div className="flex items-center gap-2">
                      <select
                        id="deploy-server"
                        className={`border-input bg-background h-9 rounded-md border px-3 text-sm ${FORM_CONTROL_CLASS}`}
                        value={serverId}
                        onChange={e => setServerId(e.target.value)}
                        required
                        disabled={servers.length === 0}
                      >
                        <option value="" disabled>
                          {servers.length === 0 ? 'Add a server first…' : 'Select a server…'}
                        </option>
                        {filteredServers.map(s => (
                          <option key={s.id} value={s.id}>
                            {s.label} ({s.host})
                          </option>
                        ))}
                      </select>
                      {dockerReadinessState ? (
                        <TooltipProvider delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              {'href' in dockerReadinessState && dockerReadinessState.href ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-9 shrink-0 gap-1.5 px-3"
                                  asChild
                                >
                                  <a href={dockerReadinessState.href}>
                                    <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />
                                    {dockerReadinessState.label}
                                  </a>
                                </Button>
                              ) : (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-9 shrink-0 gap-1.5 px-3"
                                  disabled
                                  aria-label={dockerReadinessState.title}
                                >
                                  {dockerReadinessState.tone === 'ready' ? (
                                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                                  ) : (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  )}
                                  {dockerReadinessState.label}
                                </Button>
                              )}
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs text-xs">
                              <div className="space-y-1">
                                <div className="font-medium">{dockerReadinessState.title}</div>
                                <div>{dockerReadinessState.description}</div>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : null}
                    </div>
                    {servers.length > 10 && filteredServers.length === 0 ? (
                      <div className="text-xs text-muted-foreground">
                        No servers match the current search.
                      </div>
                    ) : null}
                  </div>
                </FormRow>
              </div>
            </section>
          </div>

          {/* ── Section 2: Source inputs ── */}
          {isTemplate ? (
            <div className="space-y-2 pt-2">
              <div className="px-1 text-xs font-medium text-muted-foreground">App Settings</div>
              <Card className={`border-0 bg-transparent shadow-none ${FORM_SECTION_CLASS}`}>
                <CardContent className="space-y-4 px-1 py-1">
                  {!templateKey ? (
                    <div className="rounded-lg border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground">
                      Open the target application from App Store and start deployment there. This
                      flow no longer supports switching apps inside the template form.
                    </div>
                  ) : templateLoading ? (
                    <div className="text-xs text-muted-foreground">
                      Loading template contract...
                    </div>
                  ) : templateDetail ? (
                    <>
                      <div className="grid gap-4">
                        {templateVersionField ? (
                          <FormRow
                            label={templateVersionField.label || templateVersionField.key}
                            htmlFor={`template-field-${templateVersionField.key}`}
                            required={templateVersionField.required}
                          >
                            <div className={FORM_CONTROL_CLASS}>
                              {renderTemplateFieldInput(
                                templateVersionField,
                                `template-field-${templateVersionField.key}`
                              )}
                            </div>
                          </FormRow>
                        ) : null}
                        {hasTemplateDatabaseSource ? (
                          <FormRow label="Database Source" htmlFor="template-db-source">
                            <select
                              id="template-db-source"
                              className={`border-input bg-background h-9 rounded-md border px-3 text-sm ${FORM_CONTROL_CLASS}`}
                              value="companion"
                              onChange={() => undefined}
                            >
                              <option value="companion">
                                {templateDatabaseService
                                  ? `Template DB (${templateDatabaseService.name})`
                                  : 'Template DB'}
                              </option>
                              <option value="service-instance" disabled>
                                Service Instance DB (coming soon)
                              </option>
                            </select>
                          </FormRow>
                        ) : null}
                        {templateRemainingBasicFields.map(field => (
                          <FormRow
                            key={field.key}
                            label={field.label || field.key}
                            htmlFor={`template-field-${field.key}`}
                            required={field.required}
                            hint={
                              field.key.trim().toLowerCase() === 'version' ||
                              String(field.label || '')
                                .trim()
                                .toLowerCase() === 'version'
                                ? null
                                : field.storage_mode === 'secret_backed'
                                  ? 'Secret-backed input'
                                  : field.storage_mode === 'system_managed'
                                    ? 'Managed by the template runtime.'
                                    : 'Template input'
                            }
                          >
                            <div className={FORM_CONTROL_CLASS}>
                              {renderTemplateFieldInput(field, `template-field-${field.key}`)}
                            </div>
                          </FormRow>
                        ))}
                      </div>
                    </>
                  ) : templateKey ? (
                    <div className="text-xs text-muted-foreground">
                      Template details unavailable.
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          ) : isGit ? (
            /* ── Git-compose inputs ── */
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Repository</CardTitle>
                <CardDescription>
                  Provide the Git repository coordinates. The backend clones, extracts the compose
                  file, and resolves it into an install payload.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="git-url" className="text-xs">
                    Repository URL
                  </Label>
                  <Input
                    id="git-url"
                    value={gitRepositoryUrl}
                    onChange={e => setGitRepositoryUrl(e.target.value)}
                    placeholder="https://github.com/org/repo"
                  />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="git-ref" className="text-xs">
                      Ref
                    </Label>
                    <Input
                      id="git-ref"
                      value={gitRef}
                      onChange={e => setGitRef(e.target.value)}
                      placeholder="main"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="git-path" className="text-xs">
                      Compose Path
                    </Label>
                    <Input
                      id="git-path"
                      value={gitComposePath}
                      onChange={e => setGitComposePath(e.target.value)}
                      placeholder="docker-compose.yml"
                    />
                  </div>
                </div>
                <details className="rounded-md border p-3">
                  <summary className="cursor-pointer text-xs font-medium">
                    Private Repository Access
                  </summary>
                  <div className="mt-3 grid gap-3 md:grid-cols-[180px_1fr]">
                    <div className="space-y-1.5">
                      <Label htmlFor="git-auth-name" className="text-xs">
                        Header Name
                      </Label>
                      <Input
                        id="git-auth-name"
                        value={gitAuthHeaderName}
                        onChange={e => setGitAuthHeaderName(e.target.value)}
                        placeholder="Authorization"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="git-auth-value" className="text-xs">
                        Header Value
                      </Label>
                      <Input
                        id="git-auth-value"
                        value={gitAuthHeaderValue}
                        onChange={e => setGitAuthHeaderValue(e.target.value)}
                        placeholder="Bearer <token>"
                      />
                    </div>
                  </div>
                </details>
              </CardContent>
            </Card>
          ) : (
            <>
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
                onYamlError={setComposeYamlError}
                onRuntimeEnvInputsChange={setRuntimeEnvInputs}
              />
              {createEntryMode === 'install-script' && composeServiceNames.length > 0 ? (
                <section className="rounded-lg border bg-card px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-base font-semibold">Build Target</span>
                      <HelpTip text="Choose which compose service should use the image built from the uploaded source package. Single-service compose files are selected automatically." />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Activation target for the local application image
                    </div>
                  </div>
                  <div className="pt-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="source-build-target-service" className="text-xs">
                        Target Service
                      </Label>
                      <select
                        id="source-build-target-service"
                        className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                        value={targetServiceName}
                        onChange={e => setTargetServiceName(e.target.value)}
                        disabled={composeServiceNames.length === 1}
                      >
                        {composeServiceNames.length > 1 ? (
                          <option value="" disabled>
                            Select a service…
                          </option>
                        ) : null}
                        {composeServiceNames.map(name => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                      <div
                        className={`text-[11px] ${sourceBuildTargetServiceError ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}
                      >
                        {sourceBuildTargetServiceError ||
                          (composeServiceNames.length > 1
                            ? 'The selected service image will be replaced by the locally built application image.'
                            : 'Single-service compose detected. The application image target is selected automatically.')}
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}
            </>
          )}

          <div className={FORM_SECTION_CLASS}>
            <CreateDeploymentExposureSection
              showHeader
              isTemplate={isTemplate}
              templateServiceItems={templateServiceItems}
              portExposureEnabled={portExposureEnabled}
              setPortExposureEnabled={setPortExposureEnabled}
              domainExposureEnabled={domainExposureEnabled}
              setDomainExposureEnabled={setDomainExposureEnabled}
              servicePortMappings={servicePortMappings}
              setServicePortMappings={setServicePortMappings}
              onPrimaryPortManualChange={() => setAutoManagePrimaryExposurePort(false)}
              primaryServiceName={exposurePrimaryService?.name || 'primary'}
              recommendedExposurePort={effectiveRecommendedExposurePort}
              recommendedExposurePortHint={recommendedExposurePortHint}
              exposurePortError={exposurePortError}
              exposureSelectionError={exposureSelectionError}
              exposureDomainMessage={exposureDomainMessage}
              extraServiceMappingMessage={extraServiceMappingMessage}
            />
          </div>

          {/* ── Section 3: Advanced Options ── */}
          <div className="space-y-2">
            <SectionHeading
              title="Advanced"
              description="Optional settings"
              helpText="Additional deployment parameters resolved and normalized by the backend before execution."
            />
            <details
              className={`group ${FORM_SECTION_CLASS} rounded-xl border border-border/60 bg-card/40 px-3 py-2`}
            >
              <summary className="flex cursor-pointer list-none items-center justify-end gap-3 py-1 text-sm font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
                <span className="sr-only">Toggle advanced settings</span>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="grid gap-4 px-1 pb-2 pt-3">
                {isTemplate ? (
                  <>
                    <FormRow
                      label="Estimated App Disk"
                      htmlFor="required-disk"
                      helpText="Optional for manual inputs. Template mode prefills this from the app metadata and still allows an override before preflight."
                    >
                      <div className={`flex items-center gap-2 ${FORM_CONTROL_CLASS}`}>
                        <Input
                          id="required-disk"
                          type="number"
                          min="0"
                          step="0.1"
                          value={appRequiredDiskGiB}
                          onChange={e => setAppRequiredDiskGiB(e.target.value)}
                          placeholder={
                            isTemplate && templateRequirementDiskGiB
                              ? `Default ${templateRequirementDiskGiB}`
                              : 'Optional, e.g. 2'
                          }
                        />
                        <span className="shrink-0 text-sm text-muted-foreground">GiB</span>
                      </div>
                    </FormRow>
                    {templateAdvancedFields.length === 0 ? (
                      <div className="px-1 text-xs text-muted-foreground">
                        No advanced inputs for this template.
                      </div>
                    ) : (
                      templateAdvancedFields.map(field => (
                        <FormRow
                          key={field.key}
                          label={
                            isDatabasePasswordTemplateField(field)
                              ? 'Database Password'
                              : field.label || field.key
                          }
                          htmlFor={`template-advanced-${field.key}`}
                          required={field.required}
                          hint={
                            isDatabasePasswordTemplateField(field)
                              ? 'Auto-generated by default; change only if you need a fixed credential.'
                              : undefined
                          }
                        >
                          <div className={FORM_CONTROL_CLASS}>
                            {renderTemplateFieldInput(field, `template-advanced-${field.key}`)}
                          </div>
                        </FormRow>
                      ))
                    )}
                    <FormRow label="Primary Service" htmlFor="advanced-primary-service">
                      <div
                        id="advanced-primary-service"
                        className="pt-2 text-sm text-muted-foreground"
                      >
                        {templatePrimaryService?.name || 'template-defined'}
                      </div>
                    </FormRow>
                    <FormRow label="Hidden Inputs" htmlFor="advanced-hidden-inputs">
                      <div
                        id="advanced-hidden-inputs"
                        className="pt-2 text-sm text-muted-foreground"
                      >
                        {templateHiddenFields.length > 0
                          ? templateHiddenFields.map(field => field.key).join(', ')
                          : 'none'}
                      </div>
                    </FormRow>
                    <FormRow label="Default Disk" htmlFor="advanced-default-disk">
                      <div
                        id="advanced-default-disk"
                        className="pt-2 text-sm text-muted-foreground"
                      >
                        {templateRequirementDiskGiB
                          ? `${templateRequirementDiskGiB} GiB`
                          : 'not declared'}
                      </div>
                    </FormRow>
                  </>
                ) : (
                  <>
                    <FormRow
                      label="Estimated App Disk"
                      htmlFor="required-disk"
                      helpText="Optional estimate used by preflight when checking whether the selected target has enough free space."
                    >
                      <div className={`flex items-center gap-2 ${FORM_CONTROL_CLASS}`}>
                        <Input
                          id="required-disk"
                          type="number"
                          min="0"
                          step="0.1"
                          value={appRequiredDiskGiB}
                          onChange={e => setAppRequiredDiskGiB(e.target.value)}
                          placeholder="Optional, e.g. 2"
                        />
                        <span className="shrink-0 text-sm text-muted-foreground">GiB</span>
                      </div>
                    </FormRow>
                    <FormRow
                      label="Exposure Rules"
                      htmlFor="advanced-exposure-rules"
                      helpText="Domain, path, or port publication intent for reverse-proxy configuration."
                    >
                      <div
                        id="advanced-exposure-rules"
                        className="pt-2 text-sm text-muted-foreground"
                      >
                        Coming soon
                      </div>
                    </FormRow>
                    <FormRow
                      label="Secret-backed Inputs"
                      htmlFor="advanced-secret-inputs"
                      helpText="Sensitive values managed through the backend secret store, never exposed in plain text."
                    >
                      <div
                        id="advanced-secret-inputs"
                        className="pt-2 text-sm text-muted-foreground"
                      >
                        Coming soon
                      </div>
                    </FormRow>
                  </>
                )}
              </div>
            </details>
          </div>
        </div>

        {/* ──── Right: Review panel ──── */}
        <CreateDeploymentReviewPanel
          appName={activeName}
          targetServerId={serverId || undefined}
          targetLabel={targetLabel}
          templateAppKey={isTemplate ? templateKey || undefined : undefined}
          templateLabel={isTemplate ? templateDisplayName || templateKey || undefined : undefined}
          templateIconUrl={isTemplate ? templateAppDetail?.iconUrl || undefined : undefined}
          templateInitial={isTemplate ? templateDisplayInitial : undefined}
          exposureSummary={exposureSummary}
          preflightVisible={preflightVisible}
          helpVisible={helpVisible}
          checkResult={checkResult}
          reviewMessages={reviewMessages}
          portItems={portItems}
          activeChecking={activeChecking}
          activeSubmitting={activeSubmitting}
          srcUploading={srcUploading}
          checkDisabled={checkDisabled}
          createDisabled={createDisabled}
          onCheck={handleCheck}
          onSubmit={() => void handleSubmit()}
        />
      </div>
    </div>
  )
}
