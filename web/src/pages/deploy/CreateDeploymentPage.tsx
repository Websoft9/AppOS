import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import * as jsYaml from 'js-yaml'
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Eye,
  EyeOff,
  List,
  ShieldAlert,
  X,
} from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useCatalogAppTemplate, type CatalogTemplateField } from '@/lib/catalog-api'
import { iacUploadFile, iacMkdir } from '@/lib/iac-api'
import { pb } from '@/lib/pb'
import type { CreateDeploymentEntryMode } from '@/pages/deploy/actions/action-types'
import { useActionsController } from '@/pages/deploy/actions/useActionsController'
import type {
  RuntimeEnvInputPayload,
  RuntimeInputsPayload,
  SourceBuildPayload,
} from '@/pages/deploy/actions/useActionsController'
import { OrchestrationSection } from '@/pages/deploy/OrchestrationSection'

const SOURCE_LABELS: Record<string, string> = {
  template: 'App Template',
  compose: 'Compose File',
  'git-compose': 'Git Repository',
  'docker-command': 'Docker Command',
  'install-script': 'Source Packages',
}

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

function isTemplateFieldBasic(field: CatalogTemplateField) {
  return field.visibility !== 'system' && field.visibility !== 'advanced'
}

function isTemplateFieldAdvanced(field: CatalogTemplateField) {
  return field.visibility === 'advanced'
}

function isTemplateFieldHidden(field: CatalogTemplateField) {
  return field.visibility === 'system'
}

function isSecretBackedTemplateField(field: CatalogTemplateField) {
  return field.storage_mode === 'secret_backed'
}

function isSecretRefValue(value: string) {
  return value.trim().startsWith('secretRef:')
}

function buildRandomSecretValue(length = 24) {
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

function slugifySecretPart(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'app'
}

function buildTemplateSecretName(
  templateKey: string,
  projectName: string,
  field: CatalogTemplateField
) {
  const appPart = slugifySecretPart(projectName || templateKey)
  const fieldPart = slugifySecretPart(field.key)
  return `app-${appPart}-${fieldPart}`
}

function buildTemplateSecretDescription(
  templateLabel: string,
  projectName: string,
  field: CatalogTemplateField
) {
  const appLabel = projectName.trim() || templateLabel.trim() || 'application'
  return `Generated for ${appLabel} deployment field ${field.label || field.key}`
}

function buildTemplateDefaults(fields: CatalogTemplateField[]): Record<string, string> {
  const defaults: Record<string, string> = {}
  for (const field of fields) {
    const value = field.default
    defaults[field.key] = value == null ? '' : String(value)
  }
  return defaults
}

function coerceTemplateInputValue(field: CatalogTemplateField, value: string): unknown {
  if (field.type === 'port') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : value
  }
  return value
}

function buildTemplateInputPayload(
  fields: CatalogTemplateField[],
  values: Record<string, string>
): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const field of fields) {
    if (isTemplateFieldHidden(field)) {
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

function hasMissingRequiredTemplateFields(
  fields: CatalogTemplateField[],
  values: Record<string, string>
) {
  return fields.some(
    field => !isTemplateFieldHidden(field) && field.required && !(values[field.key] ?? '').trim()
  )
}

function buildRuntimeInputsPayload(
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

function buildSourceBuildPayload(
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

function extractComposeServiceNames(compose: string): string[] {
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

function HelpTip({ text }: { text: string }) {
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

export function CreateDeploymentPage({
  prefillMode,
  prefillSource,
  prefillAppId,
  prefillAppKey,
  prefillAppName,
  prefillServerId,
  entryMode,
}: CreateDeploymentPageProps) {
  const {
    servers,
    notice,
    setNotice,
    prefillLoading,
    prefillReady,
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
  const [templateSecretState, setTemplateSecretState] = useState<Record<string, TemplateSecretState>>({})
  const [templateSecretRevealState, setTemplateSecretRevealState] = useState<Record<string, boolean>>({})
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
  const [composeYamlError, setComposeYamlError] = useState<string | null>(null)

  const templateFields = templateDetail?.inputs || []
  const templateBasicFields = templateFields.filter(isTemplateFieldBasic)
  const templateAdvancedFields = templateFields.filter(isTemplateFieldAdvanced)
  const templateHiddenFields = templateFields.filter(isTemplateFieldHidden)
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

  useEffect(() => {
    if (!isTemplate) {
      return
    }
    if (prefillAppKey?.trim()) {
      setTemplateKey(prefillAppKey.trim())
    }
  }, [isTemplate, prefillAppKey])

  useEffect(() => {
    if (!isTemplate || !templateDetail) {
      return
    }
    setTemplateInputValues(buildTemplateDefaults(templateDetail.inputs))
    setTemplateSecretState({})
    setTemplateSecretRevealState({})
    if (!projectName.trim()) {
      setProjectName(prefillAppKey || templateDetail.templateKey)
    }
  }, [isTemplate, prefillAppKey, projectName, setProjectName, templateDetail])

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
  }, [prefillAppName, projectName, templateDetail?.manifest.trademark, templateFields, templateInputValues, templateKey, templateSecretState])

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
                ? 'Using an existing AppOS secret reference.'
                : savedSecret && savedSecret.rawValue === rawValue.trim()
                  ? `Stored in AppOS Secrets as ${savedSecret.id}. Changing the value updates the saved secret.`
                  : 'Enter once or generate. AppOS stores it in Secrets and passes only a secret ref during check and create.'}
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
    ? !gitRepositoryUrl.trim() || !gitComposePath.trim() || !serverId || activeSubmitting
    : isTemplate
      ? !templateKey || !serverId || activeSubmitting || hasMissingRequiredTemplateFields(templateFields, templateInputValues)
    : !compose.trim() ||
      !serverId ||
      activeSubmitting ||
      Boolean(composeYamlError) ||
      Boolean(sourceBuildTargetServiceError)
  const checkDisabled = isGit
    ? !gitRepositoryUrl.trim() || !gitComposePath.trim() || !serverId || activeChecking
    : isTemplate
      ? !templateKey || !serverId || activeChecking || hasMissingRequiredTemplateFields(templateFields, templateInputValues)
    : !compose.trim() ||
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
    const normalizedTemplatePayload = isTemplate
      ? await persistSecretBackedTemplateInputs()
      : templateInputPayload
    const preflight = isGit
      ? await checkGitOperation({ silentNotice: true })
      : isTemplate
        ? await checkTemplateOperation(templateKey, normalizedTemplatePayload, { silentNotice: true })
      : await checkManualOperation({ silentNotice: true, runtimeInputs, sourceBuild })

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
      await submitGitOperation()
    } else if (isTemplate) {
      await submitTemplateOperation(templateKey, normalizedTemplatePayload)
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
        sourceBuild
      )
    }
  }, [
    createEntryMode,
    checkGitOperation,
    checkManualOperation,
    checkTemplateOperation,
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
  ])

  const activeServer = servers.find(s => s.id === serverId)

  const resolutionPreview = useMemo(() => {
    switch (createEntryMode) {
      case 'git-compose':
        return { source: 'gitops', adapter: 'git-compose' }
      case 'template':
        return { source: 'manualops', adapter: 'template-render -> manual-compose' }
      case 'install-script':
        return { source: 'manualops', adapter: 'source-build' }
      default:
        return { source: 'manualops', adapter: 'manual-compose' }
    }
  }, [createEntryMode])

  const envCount = envVars.filter(e => e.key.trim()).length
  const composeLineCount = compose.split('\n').length
  const validationItems = [
    { label: 'Target server', passed: serverId.length > 0 },
    ...(isTemplate
      ? [
          { label: 'Template selected', passed: Boolean(templateKey) },
          {
            label: 'Required template inputs',
            passed: !hasMissingRequiredTemplateFields(templateFields, templateInputValues),
          },
        ]
      : []),
    {
      label: isGit ? 'Repository inputs' : 'Compose content',
      passed: isGit
        ? gitRepositoryUrl.trim().length > 0 && gitComposePath.trim().length > 0
        : isTemplate
          ? Boolean(templateKey)
        : compose.trim().length > 0,
    },
    ...(!isGit && !isTemplate && compose.trim()
      ? [{ label: 'YAML syntax', passed: !composeYamlError }]
      : []),
    ...(createEntryMode === 'install-script' && sourceBuildTargetServiceRequired
      ? [{ label: 'Target service selected', passed: !!targetServiceName.trim() }]
      : []),
  ]

  const srcRelativePath = './src/'

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
    serverId,
    appRequiredDiskGiB,
    setCheckResult,
  ])

  const preflightSummary = checkResult?.checks?.ports
  const diskSummary = checkResult?.checks?.disk_space
  const portItems = preflightSummary?.items || []
  const [nameChecking, setNameChecking] = useState(false)
  const [nameResult, setNameResult] = useState<NameAvailabilityResult | null>(null)

  const nameHint = useMemo(() => {
    if (!activeName.trim()) return null
    if (nameChecking) return 'Checking name availability...'
    if (nameResult?.ok === false) return nameResult.message || 'Application name is unavailable'
    if (!nameResult) return 'Name availability check is temporarily unavailable'
    return null
  }, [activeName, nameChecking, nameResult])

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
      setNameChecking(false)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      setNameChecking(true)
      void pb
        .send<NameAvailabilityResult>('/api/actions/install/name-availability', {
          method: 'POST',
          body: { project_name: activeName },
        })
        .then(result => {
          if (!cancelled) {
            setNameResult(result)
          }
        })
        .catch(() => {
          if (!cancelled) {
            setNameResult(null)
          }
        })
        .finally(() => {
          if (!cancelled) {
            setNameChecking(false)
          }
        })
    }, 300)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [activeName])

  return (
    <div className="flex flex-col gap-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Create Deployment</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Define and launch a new application deployment on a target server.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/deploy" search={{} as never}>
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back
            </Link>
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
      {notice ? (
        <Alert variant={notice.variant} className="flex items-center justify-between py-2">
          <AlertDescription>{notice.message}</AlertDescription>
          <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>
            <X className="h-3 w-3" />
          </Button>
        </Alert>
      ) : null}
      {prefillLoading ? (
        <Alert>
          <AlertDescription>
            Loading template for {prefillAppName || prefillAppKey || prefillAppId}...
          </AlertDescription>
        </Alert>
      ) : null}
      {prefillReady ? (
        <Alert>
          <AlertDescription>
            Template loaded for {prefillReady}. Review inputs below.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* ════ Two-column: Form workspace │ Review panel ════ */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        {/* ──── Left: Form workspace ──── */}
        <div className="space-y-5">
          {/* ── Section 1: Info ── */}
          <section className="rounded-lg border bg-card px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <span className="text-base font-semibold">Info</span>
                <HelpTip text="Identify the deployment target. The app name becomes the compose project name and data directory. Leave empty to auto-generate." />
              </div>
              <div className="text-xs text-muted-foreground">
                Application identity and target server
              </div>
            </div>
            <div className={`grid gap-4 pt-4 ${isTemplate ? 'md:grid-cols-2' : 'md:grid-cols-3'}`}>
              <div className="space-y-1.5">
                <Label htmlFor="deploy-name" className="text-xs">
                  App Name{' '}
                  <HelpTip text="Must be unique across the server. Used as compose_project_name and the root of the app data path. Leave empty to auto-generate." />
                </Label>
                <Input
                  id="deploy-name"
                  value={activeName}
                  onChange={e =>
                    isGit ? setGitProjectName(e.target.value) : setProjectName(e.target.value)
                  }
                  placeholder={isGit ? 'Auto-generated from repo name' : 'Auto-generated if empty'}
                />
                {nameHint ? (
                  <div
                    className={`text-[11px] ${nameResult?.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}
                  >
                    {nameHint}
                  </div>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="deploy-server" className="text-xs">
                  Target Location{' '}
                  <HelpTip text="The target server where containers will be created and managed." />
                </Label>
                <select
                  id="deploy-server"
                  className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                  value={serverId}
                  onChange={e => setServerId(e.target.value)}
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
              </div>
              {!isTemplate ? (
                <div className="space-y-1.5">
                  <Label htmlFor="required-disk" className="text-xs">
                    Estimated App Disk (GiB){' '}
                    <HelpTip text="Optional. If provided, preflight blocks creation when estimated requirement exceeds currently available disk space." />
                  </Label>
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
              ) : null}
            </div>
          </section>

          {/* ── Section 2: Source inputs ── */}
          {isTemplate ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Template</CardTitle>
                <CardDescription>
                  {isPinnedTemplate
                    ? 'This deployment is pinned to the app you selected in App Store. Fill only the required basic inputs.'
                    : 'Template deployment must start from App Store so the selected application stays consistent end to end.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!templateKey ? (
                  <div className="rounded-lg border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground">
                    Open the target application from App Store and start deployment there. This flow no longer supports switching apps inside the template form.
                  </div>
                ) : templateLoading ? (
                  <div className="text-xs text-muted-foreground">Loading template contract...</div>
                ) : templateDetail ? (
                  <>
                    <div className="rounded-lg border bg-muted/20 p-3 text-xs">
                      <div className="font-medium">{prefillAppName || templateDetail.manifest.trademark}</div>
                      <div className="mt-1 text-muted-foreground">
                        Template key: {templateDetail.templateKey}
                        {templateDetail.manifest.category ? ` · ${templateDetail.manifest.category}` : ''}
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {templateBasicFields.map(field => (
                        <div key={field.key} className="space-y-1.5">
                          <Label htmlFor={`template-field-${field.key}`} className="text-xs">
                            {field.label || field.key}
                            {field.required ? ' *' : ''}
                          </Label>
                          {renderTemplateFieldInput(field, `template-field-${field.key}`)}
                          <div className="text-[11px] text-muted-foreground">
                            {field.storage_mode === 'secret_backed'
                              ? 'Secret-backed input'
                              : field.storage_mode === 'system_managed'
                                ? 'Managed by the template runtime.'
                                : 'Template input'}
                          </div>
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

          {/* ── Section 3: Advanced Options ── */}
          <details className="group rounded-lg border bg-card">
            <summary className="flex cursor-pointer list-none items-start gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-0 [&:not([open]_&)]:rotate-[-90deg]" />
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-base font-semibold">Advanced Options</span>
                  <HelpTip text="Additional deployment parameters resolved and normalized by the backend before execution." />
                </div>
                <div className="text-xs text-muted-foreground">
                  Exposure, secret-backed inputs, and more
                </div>
              </div>
            </summary>
            <div className="grid gap-3 px-4 pb-4 pl-10 md:grid-cols-2">
              {isTemplate ? (
                <>
                  <div className="rounded-lg border bg-muted/10 p-3">
                    <div className="text-xs font-medium">Advanced Template Inputs</div>
                    <div className="mt-2 space-y-3">
                      {templateAdvancedFields.length === 0 ? (
                        <div className="text-xs text-muted-foreground">No advanced inputs for this template.</div>
                      ) : (
                        templateAdvancedFields.map(field => (
                          <div key={field.key} className="space-y-1.5">
                            <Label htmlFor={`template-advanced-${field.key}`} className="text-xs">
                              {field.label || field.key}
                              {field.required ? ' *' : ''}
                            </Label>
                            {renderTemplateFieldInput(field, `template-advanced-${field.key}`)}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="rounded-lg border bg-muted/10 p-3">
                    <div className="text-xs font-medium">Runtime Notes</div>
                    <div className="mt-2 space-y-2 text-xs text-muted-foreground">
                      <div>
                        Exposure uses the template default:
                        {' '}
                        {templateDetail?.exposure?.kind ? String(templateDetail.exposure.kind) : 'template-defined'}
                      </div>
                      <div>
                        Hidden system inputs:
                        {' '}
                        {templateHiddenFields.length > 0
                          ? templateHiddenFields.map(field => field.key).join(', ')
                          : 'none'}
                      </div>
                      <div className="space-y-1.5 pt-1">
                        <Label htmlFor="required-disk-template" className="text-xs">
                          Estimated App Disk (GiB)
                        </Label>
                        <Input
                          id="required-disk-template"
                          type="number"
                          min="0"
                          step="0.1"
                          value={appRequiredDiskGiB}
                          onChange={e => setAppRequiredDiskGiB(e.target.value)}
                          placeholder="Optional override"
                        />
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <>
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
        <div>
          <div className="space-y-4 xl:sticky xl:top-6">
            <Card className="border-slate-200 dark:border-slate-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Review</CardTitle>
                <CardDescription>
                  Verify the deployment summary before submitting. The backend performs final
                  validation and normalization.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {/* ── Identity ── */}
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Identity
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Source</span>
                      <span>{SOURCE_LABELS[createEntryMode] || createEntryMode}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">App Name</span>
                      <span className="max-w-[200px] truncate">
                        {activeName || 'Auto-generated'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Server</span>
                      <span className="max-w-[200px] truncate">
                        {activeServer ? `${activeServer.label} (${activeServer.host})` : '—'}
                      </span>
                    </div>
                  </div>
                </div>

                <hr className="border-dashed" />

                {/* ── Resolution ── */}
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Resolution
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Lifecycle source</span>
                      <span>{resolutionPreview.source}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Adapter</span>
                      <span>{resolutionPreview.adapter}</span>
                    </div>
                    {isGit && gitRepositoryUrl.trim() ? (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Repository</span>
                        <span className="max-w-[200px] truncate">{gitRepositoryUrl}</span>
                      </div>
                    ) : null}
                    {!isGit ? (
                      isTemplate ? (
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Template</span>
                          <span className="max-w-[200px] truncate">
                            {templateDetail?.manifest.trademark || templateKey || '—'}
                          </span>
                        </div>
                      ) : (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Compose</span>
                        <span>{compose.trim() ? `${composeLineCount} lines` : '—'}</span>
                      </div>
                      )
                    ) : null}
                    {createEntryMode === 'install-script' ? (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Build target service</span>
                        <span className="max-w-[200px] truncate">
                          {targetServiceName || 'Auto / not selected'}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </div>

                <hr className="border-dashed" />

                {/* ── Inputs ── */}
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Inputs
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">{isTemplate ? 'Template inputs' : 'Env variables'}</span>
                      <span>
                        {isTemplate
                          ? `${Object.keys(templateInputPayload).length} set`
                          : envCount > 0
                            ? `${envCount} defined`
                            : 'None'}
                      </span>
                    </div>
                    {isTemplate ? (
                      Object.keys(templateInputPayload).length > 0 ? (
                        <div className="max-h-24 overflow-y-auto rounded-md bg-muted/30 px-2 py-1.5">
                          {templateFields
                            .filter(field => !isTemplateFieldHidden(field) && templateInputPayload[field.key] !== undefined)
                            .map(field => (
                              <div
                                key={field.key}
                                className="truncate font-mono text-xs text-muted-foreground"
                              >
                                {field.key}=
                                {field.storage_mode === 'secret_backed'
                                  ? 'secretRef:...'
                                  : String(templateInputPayload[field.key])}
                              </div>
                            ))}
                        </div>
                      ) : null
                    ) : envCount > 0 ? (
                      <div className="max-h-24 overflow-y-auto rounded-md bg-muted/30 px-2 py-1.5">
                        {envVars
                          .filter(e => e.key.trim())
                          .map((e, i) => (
                            <div
                              key={i}
                              className="truncate font-mono text-xs text-muted-foreground"
                            >
                              {e.key}={e.value.length > 20 ? `${e.value.slice(0, 20)}…` : e.value}
                            </div>
                          ))}
                      </div>
                    ) : null}
                    {!isTemplate ? (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Mount files</span>
                        <span>
                          {srcFiles.length + srcUploaded.length > 0
                            ? `${srcFiles.length + srcUploaded.length} file(s)`
                            : 'None'}
                        </span>
                      </div>
                    ) : null}
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Estimated app disk</span>
                      <span>
                        {appRequiredDiskGiB.trim() ? `${appRequiredDiskGiB.trim()} GiB` : 'Not set'}
                      </span>
                    </div>
                    {!isTemplate && (srcFiles.length > 0 || srcUploaded.length > 0) ? (
                      <div className="rounded-md bg-muted/30 px-2 py-1.5">
                        {[
                          ...srcUploaded.map(n => ({ name: n, done: true })),
                          ...srcFiles.map(f => ({ name: f.name, done: false })),
                        ].map((f, i) => (
                          <div key={i} className="truncate font-mono text-xs text-muted-foreground">
                            {f.done ? <span className="text-emerald-600">✓ </span> : null}
                            {srcRelativePath}
                            {f.name}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>

                <hr className="border-dashed" />

                {/* ── Validation ── */}
                <div className="rounded-lg border bg-slate-50/80 p-3 dark:bg-slate-900/60">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Pre-flight checks
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {validationItems.map(item => (
                      <div key={item.label} className="flex items-center gap-2 text-xs">
                        <CheckCircle2
                          className={
                            item.passed
                              ? 'h-3.5 w-3.5 text-emerald-600'
                              : 'h-3.5 w-3.5 text-slate-400'
                          }
                        />
                        <span>{item.label}</span>
                      </div>
                    ))}
                  </div>
                  {checkResult ? (
                    <div className="mt-3 space-y-2 rounded-md border bg-background/80 p-2.5 text-xs">
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
                      {reviewMessages.length > 0 ? (
                        <div className="space-y-2">
                          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            Warnings
                          </div>
                          <div className="space-y-1.5">
                            {reviewMessages.map(message => (
                              <div
                                key={message}
                                className="rounded-md border border-amber-200/70 bg-amber-50/60 px-2.5 py-2 text-xs leading-5 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200"
                              >
                                {message}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {portItems.length > 0 ? (
                        <div className="space-y-1 rounded-md bg-muted/30 p-2">
                          {portItems.map(item => (
                            <div
                              key={`${item.protocol}-${item.port}`}
                              className="flex items-center justify-between gap-3 text-xs"
                            >
                              <span className="font-mono">
                                {item.port}/{item.protocol}
                              </span>
                              <span
                                className={
                                  item.conflict
                                    ? 'text-amber-700 dark:text-amber-400'
                                    : 'text-emerald-700 dark:text-emerald-400'
                                }
                              >
                                {item.conflict
                                  ? `${item.occupied ? 'occupied' : 'reserved'}${item.occupied && item.reserved ? ' and reserved' : ''}`
                                  : 'available'}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="mt-2 text-[10px] text-muted-foreground">
                      Final validation is performed server-side. Use Check to preview compose
                      validity, duplicate names, and host-port conflicts before creating the action.
                    </div>
                  )}
                </div>

                {/* ── Actions ── */}
                <div className="flex flex-col gap-2 pt-1">
                  <Button
                    variant="outline"
                    onClick={() => {
                      void (async () => {
                        if (isGit) {
                          await checkGitOperation()
                          return
                        }
                        if (isTemplate) {
                          const normalizedTemplatePayload = await persistSecretBackedTemplateInputs()
                          await checkTemplateOperation(templateKey, normalizedTemplatePayload)
                          return
                        }
                        await checkManualOperation({ runtimeInputs, sourceBuild })
                      })()
                    }}
                    disabled={checkDisabled}
                    className="h-10"
                  >
                    {activeChecking ? 'Checking...' : 'Check'}
                  </Button>
                  <Button
                    onClick={() => void handleSubmit()}
                    disabled={createDisabled || srcUploading}
                    className="h-10"
                  >
                    {activeSubmitting || srcUploading ? 'Creating...' : 'Create Deployment'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
