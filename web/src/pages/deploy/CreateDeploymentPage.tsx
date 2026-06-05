import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, ChevronDown, Eye, EyeOff, List, Loader2, ShieldAlert, X } from 'lucide-react'
import { CircleHelp } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useOptionalLayout } from '@/contexts/LayoutContext'
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
  const isPinnedTemplate = isTemplate && Boolean(prefillAppKey?.trim())
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
  const [helpOpen, setHelpOpen] = useState(false)
  const [preflightVisible, setPreflightVisible] = useState(false)
  const [portExposureEnabled, setPortExposureEnabled] = useState(false)
  const [domainExposureEnabled, setDomainExposureEnabled] = useState(false)
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
    setServicePortMappings(current => {
      const next: Record<string, { enabled: boolean; port: string }> = {}
      for (const service of exposureServiceItems) {
        const previous = current[service.name]
        next[service.name] = {
          enabled: previous?.enabled ?? service.isPrimary,
          port: previous?.port ?? (service.isPrimary ? recommendedExposurePort : ''),
        }
      }
      return next
    })
  }, [exposureServiceItems, recommendedExposurePort])

  const primaryPortMapping = exposurePrimaryService
    ? servicePortMappings[exposurePrimaryService.name] || {
        enabled: exposurePrimaryService.isPrimary,
        port: recommendedExposurePort,
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
    !portExposureEnabled && !domainExposureEnabled
      ? 'Select at least one exposure option.'
      : portExposureEnabled && mappedServiceNames.length === 0
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
    return undefined
  }, [portExposureEnabled, parsedExposurePort])

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
            aria-label="Open deployment help"
            onClick={() => setHelpOpen(true)}
          >
            <CircleHelp className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/actions" params={{} as never} search={{} as never}>
              <List className="mr-1 h-4 w-4" />
              History
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Alerts ── */}
      {notice?.variant === 'destructive' ? (
        <Alert
          variant={notice.variant}
          className="flex max-w-2xl items-center justify-between py-2"
        >
          <AlertDescription>{notice.message}</AlertDescription>
          <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>
            <X className="h-3 w-3" />
          </Button>
        </Alert>
      ) : null}

      {/* ════ Two-column: Form workspace │ Review panel ════ */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        {/* ──── Left: Form workspace ──── */}
        <div className="space-y-5">
          {/* ── Section 1: Basic ── */}
          <section className="rounded-lg border bg-card px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <span className="text-base font-semibold">Basic</span>
                <HelpTip text="Set the deployment name and choose the target server." />
              </div>
              <div className="text-xs text-muted-foreground">
                Application identity and target server
              </div>
            </div>
            <div className="grid gap-4 pt-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="deploy-name" className="text-xs">
                  App Name{' '}
                  <span aria-hidden="true" className="text-destructive">
                    *
                  </span>
                  <HelpTip text="Must be unique across the server. Used as compose project name and the app data directory root." />
                </Label>
                <Input
                  id="deploy-name"
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
                  placeholder={isGit ? 'Required, e.g. repo-app' : 'Required, e.g. wordpress-prod'}
                  required
                />
                {nameHint ? (
                  <div className="text-[11px] text-amber-700 dark:text-amber-400">{nameHint}</div>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="deploy-server" className="text-xs">
                  Target Location{' '}
                  <span aria-hidden="true" className="text-destructive">
                    *
                  </span>
                  <HelpTip text="The target server where containers will be created and managed." />
                </Label>
                <div className="flex items-center gap-2">
                  <select
                    id="deploy-server"
                    className="border-input bg-background h-9 min-w-0 flex-1 rounded-md border px-3 text-sm"
                    value={serverId}
                    onChange={e => setServerId(e.target.value)}
                    required
                  >
                    <option value="" disabled>
                      Select a server…
                    </option>
                    {servers.map(s => (
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
              </div>
            </div>
          </section>

          {/* ── Section 2: Source inputs ── */}
          {isTemplate ? (
            <Card>
              <CardHeader className="pb-2.5">
                <div className="flex items-start justify-between gap-4">
                  <CardTitle className="flex min-w-0 items-center gap-1 pt-0.5 text-sm leading-5">
                    Template Selection
                    <HelpTip
                      text={
                        isPinnedTemplate
                          ? 'This deployment is pinned to the app you selected in App Store. Fill only the required basic inputs.'
                          : 'Template deployment must start from App Store so the selected application stays consistent end to end.'
                      }
                    />
                  </CardTitle>
                  {templateKey && templateDisplayName ? (
                    <div className="flex shrink-0 items-center gap-2 pt-0.5 text-sm font-medium leading-5 text-foreground">
                      {templateAppDetail?.iconUrl ? (
                        <img
                          src={templateAppDetail.iconUrl}
                          alt={`${templateDisplayName} logo`}
                          className="h-5 w-5 shrink-0 rounded-sm bg-muted object-cover ring-1 ring-border/60"
                        />
                      ) : (
                        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-muted text-[10px] font-semibold text-foreground ring-1 ring-border/60">
                          {templateDisplayInitial}
                        </div>
                      )}
                      <div className="truncate leading-5">{templateDisplayName}</div>
                    </div>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {!templateKey ? (
                  <div className="rounded-lg border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground">
                    Open the target application from App Store and start deployment there. This flow
                    no longer supports switching apps inside the template form.
                  </div>
                ) : templateLoading ? (
                  <div className="text-xs text-muted-foreground">Loading template contract...</div>
                ) : templateDetail ? (
                  <>
                    <div className="grid gap-3 md:grid-cols-2">
                      {templateVersionField ? (
                        <div className="space-y-1.5">
                          <Label
                            htmlFor={`template-field-${templateVersionField.key}`}
                            className="text-xs"
                          >
                            {templateVersionField.label || templateVersionField.key}
                            {templateVersionField.required ? ' *' : ''}
                          </Label>
                          {renderTemplateFieldInput(
                            templateVersionField,
                            `template-field-${templateVersionField.key}`
                          )}
                        </div>
                      ) : null}
                      {hasTemplateDatabaseSource ? (
                        <div className="space-y-1.5">
                          <Label htmlFor="template-db-source" className="text-xs">
                            Database Source
                          </Label>
                          <select
                            id="template-db-source"
                            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
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
                        </div>
                      ) : null}
                      {templateRemainingBasicFields.map(field => (
                        <div key={field.key} className="space-y-1.5">
                          <Label htmlFor={`template-field-${field.key}`} className="text-xs">
                            {field.label || field.key}
                            {field.required ? ' *' : ''}
                          </Label>
                          {renderTemplateFieldInput(field, `template-field-${field.key}`)}
                          {field.key.trim().toLowerCase() === 'version' ||
                          String(field.label || '')
                            .trim()
                            .toLowerCase() === 'version' ? null : (
                            <div className="text-[11px] text-muted-foreground">
                              {field.storage_mode === 'secret_backed'
                                ? 'Secret-backed input'
                                : field.storage_mode === 'system_managed'
                                  ? 'Managed by the template runtime.'
                                  : 'Template input'}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                ) : templateKey ? (
                  <div className="text-xs text-muted-foreground">Template details unavailable.</div>
                ) : null}
              </CardContent>
            </Card>
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

          <CreateDeploymentExposureSection
            isTemplate={isTemplate}
            templateServiceItems={templateServiceItems}
            portExposureEnabled={portExposureEnabled}
            setPortExposureEnabled={setPortExposureEnabled}
            domainExposureEnabled={domainExposureEnabled}
            setDomainExposureEnabled={setDomainExposureEnabled}
            servicePortMappings={servicePortMappings}
            setServicePortMappings={setServicePortMappings}
            primaryServiceName={exposurePrimaryService?.name || 'primary'}
            recommendedExposurePort={recommendedExposurePort}
            exposurePortError={exposurePortError}
            exposureSelectionError={exposureSelectionError}
            exposureDomainMessage={exposureDomainMessage}
            extraServiceMappingMessage={extraServiceMappingMessage}
          />

          {/* ── Section 3: Advanced Options ── */}
          <details className="group rounded-lg border bg-card">
            <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-base font-semibold">Advanced Options</span>
                  <HelpTip text="Additional deployment parameters resolved and normalized by the backend before execution." />
                </div>
                <div className="text-xs text-muted-foreground">
                  Password overrides, runtime notes, and deferred controls
                </div>
              </div>
              <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-0 [&:not([open]_&)]:rotate-[-90deg]" />
            </summary>
            <div className="grid gap-3 px-4 pb-4 md:grid-cols-2">
              {isTemplate ? (
                <>
                  <div className="rounded-lg border bg-muted/10 p-3">
                    <Label htmlFor="required-disk" className="text-xs font-medium">
                      Estimated App Disk (GiB){' '}
                      <HelpTip text="Optional for manual inputs. Template mode prefills this from the app metadata and still allows an override before preflight." />
                    </Label>
                    <div className="mt-2 space-y-1.5">
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
                      <div className="text-[11px] text-muted-foreground">
                        Override the template default only when preflight should reserve a different
                        disk estimate.
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg border bg-muted/10 p-3">
                    <div className="text-xs font-medium">Advanced Template Inputs</div>
                    <div className="mt-2 space-y-3">
                      {templateAdvancedFields.length === 0 ? (
                        <div className="text-xs text-muted-foreground">
                          No advanced inputs for this template.
                        </div>
                      ) : (
                        templateAdvancedFields.map(field => (
                          <div key={field.key} className="space-y-1.5">
                            <Label htmlFor={`template-advanced-${field.key}`} className="text-xs">
                              {isDatabasePasswordTemplateField(field)
                                ? 'Database Password'
                                : field.label || field.key}
                              {field.required ? ' *' : ''}
                            </Label>
                            {renderTemplateFieldInput(field, `template-advanced-${field.key}`)}
                            {isDatabasePasswordTemplateField(field) ? (
                              <div className="text-[11px] text-muted-foreground">
                                Auto-generated by default. Change it only when you need a fixed
                                database credential.
                              </div>
                            ) : null}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="rounded-lg border bg-muted/10 p-3">
                    <div className="text-xs font-medium">Runtime Notes</div>
                    <div className="mt-2 space-y-2 text-xs text-muted-foreground">
                      <div>
                        Primary template service:{' '}
                        {templatePrimaryService?.name || 'template-defined'}
                      </div>
                      <div>
                        Hidden system inputs:{' '}
                        {templateHiddenFields.length > 0
                          ? templateHiddenFields.map(field => field.key).join(', ')
                          : 'none'}
                      </div>
                      <div>
                        Estimated app disk default:{' '}
                        {templateRequirementDiskGiB
                          ? `${templateRequirementDiskGiB} GiB`
                          : 'not declared'}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="rounded-lg border bg-muted/10 p-3">
                    <Label htmlFor="required-disk" className="text-xs font-medium">
                      Estimated App Disk (GiB){' '}
                      <HelpTip text="Optional estimate used by preflight when checking whether the selected target has enough free space." />
                    </Label>
                    <div className="mt-2 space-y-1.5">
                      <Input
                        id="required-disk"
                        type="number"
                        min="0"
                        step="0.1"
                        value={appRequiredDiskGiB}
                        onChange={e => setAppRequiredDiskGiB(e.target.value)}
                        placeholder="Optional, e.g. 2"
                      />
                    </div>
                  </div>
                  <div className="rounded-lg border bg-muted/10 p-3">
                    <div className="text-xs font-medium">
                      Exposure Intent{' '}
                      <HelpTip text="Domain, path, or port publication intent for reverse-proxy configuration." />
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">Coming soon</div>
                  </div>
                  <div className="rounded-lg border bg-muted/10 p-3">
                    <div className="text-xs font-medium">
                      Secret-backed Inputs{' '}
                      <HelpTip text="Sensitive values managed through the backend secret store, never exposed in plain text." />
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">Coming soon</div>
                  </div>
                </>
              )}
            </div>
          </details>
        </div>

        {/* ──── Right: Review panel ──── */}
        <CreateDeploymentReviewPanel
          preflightVisible={preflightVisible}
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

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Deployment Help</DialogTitle>
            <DialogDescription>
              Short answers for the most common questions during deployment creation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
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
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
