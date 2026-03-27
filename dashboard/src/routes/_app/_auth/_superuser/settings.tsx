import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useCallback, type FormEvent } from 'react'
import { ClientResponseError } from 'pocketbase'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { pb } from '@/lib/pb'
import { parseExtListInput } from '@/lib/ext-normalize'
import {
  SETTINGS_SCHEMA_API_PATH,
  SETTINGS_ENTRIES_API_PATH,
  settingsActionPath,
  settingsEntryPath,
  type SettingsEntriesListResponse,
  type SettingsEntryId,
  type SettingsSchemaEntry,
  type SettingsSchemaResponse,
  type SettingsSection,
} from '@/lib/settings-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DEFAULT_SECRET_POLICY,
  normalizeSecretPolicy,
  SECRET_ACCESS_MODE_OPTIONS,
  type SecretPolicy,
} from '@/lib/secrets-policy'

// ─── Types ────────────────────────────────────────────────────────────────

interface SpaceQuota {
  maxSizeMB: number
  maxPerUser: number
  maxUploadFiles: number
  shareMaxMinutes: number
  shareDefaultMinutes: number
  uploadAllowExts: string[]
  uploadDenyExts: string[]
  disallowedFolderNames: string[]
}

interface ProxyNetwork {
  httpProxy: string
  httpsProxy: string
  noProxy: string
  username: string
  password: string
}

interface DockerMirror {
  mirrors: string[]
  insecureRegistries: string[]
}

interface RegistryItem {
  host: string
  username: string
  password: string
}

interface DockerRegistries {
  items: RegistryItem[]
}

interface ConnectTerminalGroup {
  idleTimeoutSeconds: number
  maxConnections: number
}

interface TunnelPortRange {
  start: number
  end: number
}

interface DeployPreflightGroup {
  minFreeDiskBytes: number
}

interface IacFilesGroup {
  maxSizeMB: number
  maxZipSizeMB: number
  extensionBlacklist: string
}

function extractFieldError(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }
  if (value && typeof value === 'object') {
    const maybeObj = value as Record<string, unknown>
    if (typeof maybeObj.message === 'string' && maybeObj.message.trim()) {
      return maybeObj.message.trim()
    }
    if (typeof maybeObj.code === 'string' && maybeObj.code.trim()) {
      return maybeObj.code.trim()
    }
  }
  return null
}

function parseConnectTerminalApiErrors(
  payload: unknown
): Partial<Record<keyof ConnectTerminalGroup, string>> {
  const parsed: Partial<Record<keyof ConnectTerminalGroup, string>> = {}
  if (!payload || typeof payload !== 'object') {
    return parsed
  }

  const root = payload as Record<string, unknown>
  const bag =
    root.errors && typeof root.errors === 'object' ? (root.errors as Record<string, unknown>) : root

  const idleError = extractFieldError(bag.idleTimeoutSeconds)
  if (idleError) {
    parsed.idleTimeoutSeconds = idleError
  }

  const maxError = extractFieldError(bag.maxConnections)
  if (maxError) {
    parsed.maxConnections = maxError
  }

  return parsed
}

function parseTunnelPortRangeApiErrors(
  payload: unknown
): Partial<Record<keyof TunnelPortRange, string>> {
  const parsed: Partial<Record<keyof TunnelPortRange, string>> = {}
  if (!payload || typeof payload !== 'object') {
    return parsed
  }

  const root = payload as Record<string, unknown>
  const bag =
    root.errors && typeof root.errors === 'object' ? (root.errors as Record<string, unknown>) : root

  const startError = extractFieldError(bag.start)
  if (startError) {
    parsed.start = startError
  }

  const endError = extractFieldError(bag.end)
  if (endError) {
    parsed.end = endError
  }

  return parsed
}

// LLM vendor catalog — pre-fills name + endpoint when user selects a vendor
const LLM_VENDORS: { label: string; endpoint: string }[] = [
  { label: 'OpenAI', endpoint: 'https://api.openai.com/v1' },
  { label: 'Anthropic', endpoint: 'https://api.anthropic.com' },
  { label: 'Google Gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta' },
  { label: 'Mistral', endpoint: 'https://api.mistral.ai/v1' },
  { label: 'DeepSeek', endpoint: 'https://api.deepseek.com/v1' },
  { label: 'Groq', endpoint: 'https://api.groq.com/openai/v1' },
  { label: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1' },
  {
    label: 'Azure OpenAI',
    endpoint: 'https://{resource}.openai.azure.com/openai/deployments/{model}',
  },
  { label: 'Ollama', endpoint: 'http://localhost:11434/v1' },
  { label: 'Custom', endpoint: '' },
]

interface LLMProviderItem {
  name: string
  endpoint: string
  apiKey: string
}

// ─── Simple toast helper ───────────────────────────────────────────────────

function useToast() {
  const [toasts, setToasts] = useState<{ id: number; msg: string; ok: boolean }[]>([])
  const show = useCallback((msg: string, ok = true) => {
    const id = Date.now()
    setToasts(t => [...t, { id, msg, ok }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000)
  }, [])
  return { toasts, show }
}

// ─── Toggle (checkbox-based) ───────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  id,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  id?: string
}) {
  return (
    <button
      id={id}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${checked ? 'bg-primary' : 'bg-input'}`}
    >
      <span
        className={`pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`}
      />
    </button>
  )
}

function sectionLabel(section: SettingsSection): string {
  return section === 'system' ? 'System' : 'Workspace'
}

type SectionId = SettingsEntryId

// ─── Module-level defaults (outside component to avoid stale closure captures) ─

const DEFAULT_SPACE_QUOTA: SpaceQuota = {
  maxSizeMB: 10,
  maxPerUser: 100,
  maxUploadFiles: 50,
  shareMaxMinutes: 60,
  shareDefaultMinutes: 30,
  uploadAllowExts: [],
  uploadDenyExts: [],
  disallowedFolderNames: [],
}

const EMPTY_PROXY: ProxyNetwork = {
  httpProxy: '',
  httpsProxy: '',
  noProxy: '',
  username: '',
  password: '',
}

const DEFAULT_CONNECT_TERMINAL: ConnectTerminalGroup = {
  idleTimeoutSeconds: 1800,
  maxConnections: 0,
}

const DEFAULT_TUNNEL_PORT_RANGE: TunnelPortRange = {
  start: 40000,
  end: 49999,
}

const DEFAULT_DEPLOY_PREFLIGHT: DeployPreflightGroup = {
  minFreeDiskBytes: 512 * 1024 * 1024,
}

const DEFAULT_IAC_FILES: IacFilesGroup = {
  maxSizeMB: 10,
  maxZipSizeMB: 50,
  extensionBlacklist: '.exe,.dll,.so,.bin,.deb,.rpm,.apk,.msi,.dmg,.pkg',
}

// ─── Component ────────────────────────────────────────────────────────────

export function SettingsPage() {
  const { toasts, show: showToast } = useToast()
  const [activeSection, setActiveSection] = useState<SectionId>('basic')
  const [schemaEntries, setSchemaEntries] = useState<SettingsSchemaEntry[]>([])
  const [pbLoading, setPbLoading] = useState(true)

  // Basic form
  const [appName, setAppName] = useState('')
  const [appURL, setAppURL] = useState('')
  const [appSaving, setAppSaving] = useState(false)

  // SMTP form
  const [smtpEnabled, setSmtpEnabled] = useState(false)
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState(587)
  const [smtpUsername, setSmtpUsername] = useState('')
  const [smtpPassword, setSmtpPassword] = useState('')
  const [smtpAuthMethod, setSmtpAuthMethod] = useState('')
  const [smtpTls, setSmtpTls] = useState(false)
  const [smtpLocalName, setSmtpLocalName] = useState('')
  const [smtpSaving, setSmtpSaving] = useState(false)
  const [testEmailRecipient, setTestEmailRecipient] = useState('')
  const [testEmailSending, setTestEmailSending] = useState(false)

  // S3 form
  const [s3Enabled, setS3Enabled] = useState(false)
  const [s3Bucket, setS3Bucket] = useState('')
  const [s3Region, setS3Region] = useState('')
  const [s3Endpoint, setS3Endpoint] = useState('')
  const [s3AccessKey, setS3AccessKey] = useState('')
  const [s3Secret, setS3Secret] = useState('')
  const [s3ForcePathStyle, setS3ForcePathStyle] = useState(false)
  const [s3Saving, setS3Saving] = useState(false)
  const [s3Testing, setS3Testing] = useState(false)

  // Logs form
  const [logsMaxDays, setLogsMaxDays] = useState(7)
  const [logsMinLevel, setLogsMinLevel] = useState(5)
  const [logsLogIP, setLogsLogIP] = useState(false)
  const [logsLogAuthId, setLogsLogAuthId] = useState(false)
  const [logsSaving, setLogsSaving] = useState(false)

  // Space quota
  const [spaceQuotaForm, setSpaceQuotaForm] = useState<SpaceQuota>(DEFAULT_SPACE_QUOTA)
  const [spaceQuotaSaving, setSpaceQuotaSaving] = useState(false)
  const [spaceQuotaErrors, setSpaceQuotaErrors] = useState<
    Partial<Record<keyof SpaceQuota, string>>
  >({})
  const [allowExtsText, setAllowExtsText] = useState('')
  const [denyExtsText, setDenyExtsText] = useState('')
  const [disallowedFolderNamesText, setDisallowedFolderNamesText] = useState('')

  // Connect terminal settings
  const [connectTerminalForm, setConnectTerminalForm] =
    useState<ConnectTerminalGroup>(DEFAULT_CONNECT_TERMINAL)
  const [connectTerminalSaving, setConnectTerminalSaving] = useState(false)
  const [connectTerminalErrors, setConnectTerminalErrors] = useState<
    Partial<Record<keyof ConnectTerminalGroup, string>>
  >({})

  const [deployPreflightForm, setDeployPreflightForm] =
    useState<DeployPreflightGroup>(DEFAULT_DEPLOY_PREFLIGHT)
  const [deployPreflightSaving, setDeployPreflightSaving] = useState(false)
  const [deployPreflightErrors, setDeployPreflightErrors] = useState<
    Partial<Record<keyof DeployPreflightGroup, string>>
  >({})

  const [iacFilesForm, setIacFilesForm] = useState<IacFilesGroup>(DEFAULT_IAC_FILES)
  const [iacFilesSaving, setIacFilesSaving] = useState(false)
  const [iacFilesErrors, setIacFilesErrors] = useState<
    Partial<Record<keyof IacFilesGroup, string>>
  >({})

  const [tunnelPortRangeForm, setTunnelPortRangeForm] =
    useState<TunnelPortRange>(DEFAULT_TUNNEL_PORT_RANGE)
  const [tunnelPortRangeSaving, setTunnelPortRangeSaving] = useState(false)
  const [tunnelPortRangeErrors, setTunnelPortRangeErrors] = useState<
    Partial<Record<keyof TunnelPortRange, string>>
  >({})

  // Secrets policy
  const [secretPolicy, setSecretPolicy] = useState<SecretPolicy>(DEFAULT_SECRET_POLICY)
  const [secretPolicySaving, setSecretPolicySaving] = useState(false)
  const [secretPolicyErrors, setSecretPolicyErrors] = useState<
    Partial<Record<keyof SecretPolicy, string>>
  >({})

  // Proxy
  const [proxyNetwork, setProxyNetwork] = useState<ProxyNetwork>(EMPTY_PROXY)
  const [proxyForm, setProxyForm] = useState<ProxyNetwork>(EMPTY_PROXY)
  const [proxySaving, setProxySaving] = useState(false)

  // Docker mirrors (list-based)
  const [mirrors, setMirrors] = useState<string[]>([])
  const [insecureRegs, setInsecureRegs] = useState<string[]>([])
  const [mirrorsSaving, setMirrorsSaving] = useState(false)

  // Docker registries (list of items)
  const [dockerRegistries, setDockerRegistries] = useState<RegistryItem[]>([])
  const [regsSaving, setRegsSaving] = useState(false)

  // LLM providers
  const [llmItems, setLlmItems] = useState<LLMProviderItem[]>([])
  const [llmSaving, setLlmSaving] = useState(false)

  // Secrets picker (for LLM apiKey references)
  const [secretPickerItems, setSecretPickerItems] = useState<{ id: string; name: string }[]>([])

  // Inline create-secret dialog (LLM apiKey)
  const [llmSecretCreateOpen, setLlmSecretCreateOpen] = useState(false)
  const [llmSecretCreateIdx, setLlmSecretCreateIdx] = useState(-1)
  const [llmSecretCreateName, setLlmSecretCreateName] = useState('')
  const [llmSecretCreateKey, setLlmSecretCreateKey] = useState('')
  const [llmSecretCreateSaving, setLlmSecretCreateSaving] = useState(false)
  const [llmSecretCreateError, setLlmSecretCreateError] = useState('')

  const loadSettingsData = useCallback(async () => {
    setPbLoading(true)
    try {
      const [schemaResult, entriesResult] = await Promise.all([
        pb.send<SettingsSchemaResponse>(SETTINGS_SCHEMA_API_PATH, { method: 'GET' }),
        pb.send<SettingsEntriesListResponse>(SETTINGS_ENTRIES_API_PATH, { method: 'GET' }),
      ])

      setSchemaEntries(schemaResult.entries)
      if (schemaResult.entries.length > 0 && !schemaResult.entries.some(entry => entry.id === activeSection)) {
        setActiveSection(schemaResult.entries[0].id)
      }

      const entryMap = new Map(entriesResult.items.map(item => [item.id, item.value]))

      const basic = (entryMap.get('basic') as Partial<{ appName: string; appURL: string }>) ?? {}
      setAppName(basic.appName ?? '')
      setAppURL(basic.appURL ?? '')

      const smtp = (entryMap.get('smtp') as Partial<{
        enabled: boolean
        host: string
        port: number
        username: string
        password: string
        authMethod: string
        tls: boolean
        localName: string
      }>) ?? {}
      setSmtpEnabled(Boolean(smtp.enabled))
      setSmtpHost(smtp.host ?? '')
      setSmtpPort(Number(smtp.port ?? 587))
      setSmtpUsername(smtp.username ?? '')
      setSmtpPassword(smtp.password ?? '')
      setSmtpAuthMethod(smtp.authMethod ?? '')
      setSmtpTls(Boolean(smtp.tls))
      setSmtpLocalName(smtp.localName ?? '')

      const s3 = (entryMap.get('s3') as Partial<{
        enabled: boolean
        bucket: string
        region: string
        endpoint: string
        accessKey: string
        secret: string
        forcePathStyle: boolean
      }>) ?? {}
      setS3Enabled(Boolean(s3.enabled))
      setS3Bucket(s3.bucket ?? '')
      setS3Region(s3.region ?? '')
      setS3Endpoint(s3.endpoint ?? '')
      setS3AccessKey(s3.accessKey ?? '')
      setS3Secret(s3.secret ?? '')
      setS3ForcePathStyle(Boolean(s3.forcePathStyle))

      const logs = (entryMap.get('logs') as Partial<{
        maxDays: number
        minLevel: number
        logIP: boolean
        logAuthId: boolean
      }>) ?? {}
      setLogsMaxDays(Number(logs.maxDays ?? 7))
      setLogsMinLevel(Number(logs.minLevel ?? 5))
      setLogsLogIP(Boolean(logs.logIP))
      setLogsLogAuthId(Boolean(logs.logAuthId))

      const quota = (entryMap.get('space-quota') as Partial<SpaceQuota>) ?? {}
      const mergedQuota = {
        ...DEFAULT_SPACE_QUOTA,
        ...quota,
        uploadAllowExts: Array.isArray(quota.uploadAllowExts) ? quota.uploadAllowExts : [],
        uploadDenyExts: Array.isArray(quota.uploadDenyExts) ? quota.uploadDenyExts : [],
        disallowedFolderNames: Array.isArray(quota.disallowedFolderNames)
          ? quota.disallowedFolderNames
          : [],
      }
      setSpaceQuotaForm(mergedQuota)
      setAllowExtsText(mergedQuota.uploadAllowExts.join(', '))
      setDenyExtsText(mergedQuota.uploadDenyExts.join(', '))
      setDisallowedFolderNamesText(mergedQuota.disallowedFolderNames.join(', '))

      const terminal = (entryMap.get('connect-terminal') as Partial<ConnectTerminalGroup>) ?? {}
      const idleTimeoutSeconds = Number(terminal.idleTimeoutSeconds)
      const maxConnections = Number(terminal.maxConnections)
      setConnectTerminalForm({
        idleTimeoutSeconds:
          Number.isFinite(idleTimeoutSeconds) && idleTimeoutSeconds >= 60
            ? Math.floor(idleTimeoutSeconds)
            : DEFAULT_CONNECT_TERMINAL.idleTimeoutSeconds,
        maxConnections:
          Number.isFinite(maxConnections) && maxConnections >= 0
            ? Math.floor(maxConnections)
            : DEFAULT_CONNECT_TERMINAL.maxConnections,
      })

      const preflight =
        (entryMap.get('deploy-preflight') as Partial<DeployPreflightGroup>) ?? {}
      const minFreeDiskBytes = Number(preflight.minFreeDiskBytes)
      setDeployPreflightForm({
        minFreeDiskBytes:
          Number.isFinite(minFreeDiskBytes) && minFreeDiskBytes >= 0
            ? Math.floor(minFreeDiskBytes)
            : DEFAULT_DEPLOY_PREFLIGHT.minFreeDiskBytes,
      })

      const iacFiles = (entryMap.get('iac-files') as Partial<IacFilesGroup>) ?? {}
      const iacMaxSizeMB = Number(iacFiles.maxSizeMB)
      const iacMaxZipSizeMB = Number(iacFiles.maxZipSizeMB)
      setIacFilesForm({
        maxSizeMB:
          Number.isFinite(iacMaxSizeMB) && iacMaxSizeMB >= 1
            ? Math.floor(iacMaxSizeMB)
            : DEFAULT_IAC_FILES.maxSizeMB,
        maxZipSizeMB:
          Number.isFinite(iacMaxZipSizeMB) && iacMaxZipSizeMB >= 1
            ? Math.floor(iacMaxZipSizeMB)
            : DEFAULT_IAC_FILES.maxZipSizeMB,
        extensionBlacklist:
          typeof iacFiles.extensionBlacklist === 'string'
            ? iacFiles.extensionBlacklist
            : DEFAULT_IAC_FILES.extensionBlacklist,
      })

      const portRange = (entryMap.get('tunnel-port-range') as Partial<TunnelPortRange>) ?? {}
      const start = Number(portRange.start)
      const end = Number(portRange.end)
      setTunnelPortRangeForm({
        start:
          Number.isFinite(start) && start >= 1
            ? Math.floor(start)
            : DEFAULT_TUNNEL_PORT_RANGE.start,
        end: Number.isFinite(end) && end >= 1 ? Math.floor(end) : DEFAULT_TUNNEL_PORT_RANGE.end,
      })

      setSecretPolicy(normalizeSecretPolicy(entryMap.get('secrets-policy')))

      const network = (entryMap.get('proxy-network') as ProxyNetwork) ?? EMPTY_PROXY
      setProxyNetwork(network)
      setProxyForm(network)

      const mirror = (entryMap.get('docker-mirror') as Partial<DockerMirror>) ?? {}
      setMirrors(Array.isArray(mirror.mirrors) ? mirror.mirrors : [])
      setInsecureRegs(Array.isArray(mirror.insecureRegistries) ? mirror.insecureRegistries : [])

      const registries =
        (entryMap.get('docker-registries') as Partial<DockerRegistries>) ?? { items: [] }
      setDockerRegistries(Array.isArray(registries.items) ? registries.items : [])

      const providers =
        (entryMap.get('llm-providers') as Partial<{ items: LLMProviderItem[] }>) ?? { items: [] }
      setLlmItems(Array.isArray(providers.items) ? providers.items : [])
    } catch (err) {
      showToast(
        'Failed to load settings: ' + (err instanceof Error ? err.message : String(err)),
        false
      )
    } finally {
      setPbLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    loadSettingsData()
  }, [loadSettingsData])

  // Load secrets list when LLM section is active (for apiKey secret picker)
  const loadSecretPickerItems = useCallback(async () => {
    try {
      const res = await pb.send<{ items: { id: string; name: string }[] }>(
        '/api/collections/secrets/records?sort=name&fields=id,name&filter=(status=%27active%27)',
        { method: 'GET' }
      )
      setSecretPickerItems(res.items ?? [])
    } catch {
      // ignore — picker just won't show options
    }
  }, [])

  useEffect(() => {
    if (activeSection !== 'llm-providers') return
    void loadSecretPickerItems()
  }, [activeSection, loadSecretPickerItems])

  const handleLlmSecretCreate = async (e: FormEvent) => {
    e.preventDefault()
    setLlmSecretCreateSaving(true)
    setLlmSecretCreateError('')
    try {
      const created = await pb.collection('secrets').create({
        name: llmSecretCreateName,
        template_id: 'api_key',
        scope: 'global',
        payload: { api_key: llmSecretCreateKey },
      })
      // Refresh picker then select the new secret
      await loadSecretPickerItems()
      const idx = llmSecretCreateIdx
      setLlmItems(p =>
        p.map((item, j) => (j === idx ? { ...item, apiKey: `secretRef:${created.id}` } : item))
      )
      setLlmSecretCreateOpen(false)
    } catch (err) {
      setLlmSecretCreateError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setLlmSecretCreateSaving(false)
    }
  }

  // ── Save handlers ──

  const saveApp = async () => {
    setAppSaving(true)
    try {
      await pb.send(settingsEntryPath('basic'), {
        method: 'PATCH',
        body: { appName, appURL },
      })
      showToast('Basic settings saved')
    } catch (err) {
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setAppSaving(false)
    }
  }

  const saveSmtp = async () => {
    setSmtpSaving(true)
    try {
      await pb.send(settingsEntryPath('smtp'), {
        method: 'PATCH',
        body: {
          enabled: smtpEnabled,
          host: smtpHost,
          port: smtpPort,
          username: smtpUsername,
          password: smtpPassword,
          authMethod: smtpAuthMethod,
          tls: smtpTls,
          localName: smtpLocalName,
        },
      })
      showToast('SMTP settings saved')
    } catch (err) {
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setSmtpSaving(false)
    }
  }

  const sendTestEmail = async () => {
    if (!testEmailRecipient) {
      showToast('Enter a recipient email first', false)
      return
    }
    setTestEmailSending(true)
    try {
      await pb.send(settingsActionPath('test-email'), {
        method: 'POST',
        body: {
          template: { subject: 'Test email from AppOS', actionUrl: '', actionName: '' },
          to: [{ address: testEmailRecipient, name: '' }],
        },
      })
      showToast('Test email sent successfully')
    } catch (err) {
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setTestEmailSending(false)
    }
  }

  const saveS3 = async () => {
    setS3Saving(true)
    try {
      await pb.send(settingsEntryPath('s3'), {
        method: 'PATCH',
        body: {
          enabled: s3Enabled,
          bucket: s3Bucket,
          region: s3Region,
          endpoint: s3Endpoint,
          accessKey: s3AccessKey,
          secret: s3Secret,
          forcePathStyle: s3ForcePathStyle,
        },
      })
      showToast('S3 settings saved')
    } catch (err) {
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setS3Saving(false)
    }
  }

  const testS3 = async () => {
    setS3Testing(true)
    try {
      await pb.send(settingsActionPath('test-s3'), { method: 'POST' })
      showToast('S3 connection successful')
    } catch (err) {
      showToast('S3 test failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setS3Testing(false)
    }
  }

  const saveLogs = async () => {
    setLogsSaving(true)
    try {
      await pb.send(settingsEntryPath('logs'), {
        method: 'PATCH',
        body: {
          maxDays: logsMaxDays,
          minLevel: logsMinLevel,
          logIP: logsLogIP,
          logAuthId: logsLogAuthId,
        },
      })
      showToast('Log settings saved')
    } catch (err) {
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setLogsSaving(false)
    }
  }

  const validateSpaceQuota = (): boolean => {
    const errs: Partial<Record<keyof SpaceQuota, string>> = {}
    if (!spaceQuotaForm.maxSizeMB || spaceQuotaForm.maxSizeMB < 1) errs.maxSizeMB = 'Must be ≥ 1'
    if (!spaceQuotaForm.maxPerUser || spaceQuotaForm.maxPerUser < 1) errs.maxPerUser = 'Must be ≥ 1'
    if (
      !spaceQuotaForm.maxUploadFiles ||
      spaceQuotaForm.maxUploadFiles < 1 ||
      spaceQuotaForm.maxUploadFiles > 200
    )
      errs.maxUploadFiles = 'Must be between 1 and 200'
    if (!spaceQuotaForm.shareMaxMinutes || spaceQuotaForm.shareMaxMinutes < 1)
      errs.shareMaxMinutes = 'Must be ≥ 1'
    if (!spaceQuotaForm.shareDefaultMinutes || spaceQuotaForm.shareDefaultMinutes < 1)
      errs.shareDefaultMinutes = 'Must be ≥ 1'
    if (spaceQuotaForm.shareDefaultMinutes > spaceQuotaForm.shareMaxMinutes)
      errs.shareDefaultMinutes = 'Cannot exceed max duration'
    setSpaceQuotaErrors(errs)
    return Object.keys(errs).length === 0
  }

  const saveSpaceQuota = async () => {
    if (!validateSpaceQuota()) return
    setSpaceQuotaSaving(true)
    // Parse raw text inputs into arrays right before save
    const payload: SpaceQuota = {
      ...spaceQuotaForm,
      uploadAllowExts: parseExtListInput(allowExtsText),
      uploadDenyExts: parseExtListInput(denyExtsText),
      disallowedFolderNames: disallowedFolderNamesText
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
    }
    try {
      const res = (await pb.send(settingsEntryPath('space-quota'), {
        method: 'PATCH',
        body: payload,
      })) as { value?: Partial<SpaceQuota> }
      const q = res.value ?? payload
      const merged = {
        ...DEFAULT_SPACE_QUOTA,
        ...q,
        uploadAllowExts: Array.isArray(q.uploadAllowExts) ? q.uploadAllowExts : [],
        uploadDenyExts: Array.isArray(q.uploadDenyExts) ? q.uploadDenyExts : [],
        disallowedFolderNames: Array.isArray(q.disallowedFolderNames)
          ? q.disallowedFolderNames
          : [],
      }
      setSpaceQuotaForm(merged)
      setAllowExtsText(merged.uploadAllowExts.join(', '))
      setDenyExtsText(merged.uploadDenyExts.join(', '))
      setDisallowedFolderNamesText(merged.disallowedFolderNames.join(', '))
      showToast('Space quota saved')
    } catch (err: unknown) {
      showToast('Failed: ' + ((err as { message?: string })?.message ?? String(err)), false)
    } finally {
      setSpaceQuotaSaving(false)
    }
  }

  const saveProxy = async () => {
    setProxySaving(true)
    try {
      await pb.send(settingsEntryPath('proxy-network'), {
        method: 'PATCH',
        body: proxyForm,
      })
      setProxyNetwork(proxyForm)
      showToast('Proxy settings saved')
    } catch (err) {
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setProxySaving(false)
    }
  }

  const validateConnectTerminal = (): boolean => {
    const errors: Partial<Record<keyof ConnectTerminalGroup, string>> = {}
    if (
      !Number.isInteger(connectTerminalForm.idleTimeoutSeconds) ||
      connectTerminalForm.idleTimeoutSeconds < 60
    ) {
      errors.idleTimeoutSeconds = 'Must be an integer ≥ 60 seconds'
    }
    if (
      !Number.isInteger(connectTerminalForm.maxConnections) ||
      connectTerminalForm.maxConnections < 0
    ) {
      errors.maxConnections = 'Must be an integer ≥ 0 (0 means unlimited)'
    }
    setConnectTerminalErrors(errors)
    return Object.keys(errors).length === 0
  }

  const saveConnectTerminal = async () => {
    if (!validateConnectTerminal()) return
    setConnectTerminalSaving(true)
    setConnectTerminalErrors({})
    try {
      await pb.send(settingsEntryPath('connect-terminal'), {
        method: 'PATCH',
        body: {
          idleTimeoutSeconds: connectTerminalForm.idleTimeoutSeconds,
          maxConnections: connectTerminalForm.maxConnections,
        },
      })
      showToast('Connect terminal settings saved')
    } catch (err) {
      if (err instanceof ClientResponseError && (err.status === 400 || err.status === 422)) {
        const inlineErrors = parseConnectTerminalApiErrors(err.response)
        if (Object.keys(inlineErrors).length > 0) {
          setConnectTerminalErrors(inlineErrors)
          showToast('Please fix validation errors and try again.', false)
          return
        }
      }
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setConnectTerminalSaving(false)
    }
  }

  const validateDeployPreflight = (): boolean => {
    const errors: Partial<Record<keyof DeployPreflightGroup, string>> = {}

    if (
      !Number.isInteger(deployPreflightForm.minFreeDiskBytes) ||
      deployPreflightForm.minFreeDiskBytes < 0
    ) {
      errors.minFreeDiskBytes = 'Must be an integer = 0 bytes'
    }

    setDeployPreflightErrors(errors)
    return Object.keys(errors).length === 0
  }

  const saveDeployPreflight = async () => {
    if (!validateDeployPreflight()) return
    setDeployPreflightSaving(true)
    setDeployPreflightErrors({})
    try {
      const res = (await pb.send(settingsEntryPath('deploy-preflight'), {
        method: 'PATCH',
        body: {
          minFreeDiskBytes: deployPreflightForm.minFreeDiskBytes,
        },
      })) as { value?: Partial<DeployPreflightGroup> }
      const preflight = res.value ?? deployPreflightForm
      setDeployPreflightForm({
        minFreeDiskBytes: Number(preflight.minFreeDiskBytes ?? deployPreflightForm.minFreeDiskBytes),
      })
      showToast('Deploy preflight settings saved')
    } catch (err) {
      if (err instanceof ClientResponseError && (err.status === 400 || err.status === 422)) {
        const root = err.response as Record<string, unknown>
        const bag =
          root.errors && typeof root.errors === 'object'
            ? (root.errors as Record<string, unknown>)
            : root
        const nextErrors = {
          minFreeDiskBytes: extractFieldError(bag.minFreeDiskBytes) ?? undefined,
        }
        if (Object.values(nextErrors).some(Boolean)) {
          setDeployPreflightErrors(nextErrors)
          showToast('Please fix validation errors and try again.', false)
          return
        }
      }
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setDeployPreflightSaving(false)
    }
  }

  const validateIacFiles = (): boolean => {
    const errors: Partial<Record<keyof IacFilesGroup, string>> = {}

    if (!Number.isInteger(iacFilesForm.maxSizeMB) || iacFilesForm.maxSizeMB < 1) {
      errors.maxSizeMB = 'Must be an integer >= 1'
    }
    if (!Number.isInteger(iacFilesForm.maxZipSizeMB) || iacFilesForm.maxZipSizeMB < 1) {
      errors.maxZipSizeMB = 'Must be an integer >= 1'
    }
    if (
      !errors.maxSizeMB &&
      !errors.maxZipSizeMB &&
      iacFilesForm.maxZipSizeMB < iacFilesForm.maxSizeMB
    ) {
      errors.maxZipSizeMB = 'Must be >= Max File Size MB'
    }
    if (typeof iacFilesForm.extensionBlacklist !== 'string') {
      errors.extensionBlacklist = 'Must be a string'
    }

    setIacFilesErrors(errors)
    return Object.keys(errors).length === 0
  }

  const saveIacFiles = async () => {
    if (!validateIacFiles()) return
    setIacFilesSaving(true)
    setIacFilesErrors({})
    try {
      const res = (await pb.send(settingsEntryPath('iac-files'), {
        method: 'PATCH',
        body: {
          maxSizeMB: iacFilesForm.maxSizeMB,
          maxZipSizeMB: iacFilesForm.maxZipSizeMB,
          extensionBlacklist: iacFilesForm.extensionBlacklist,
        },
      })) as { value?: Partial<IacFilesGroup> }
      const next = res.value ?? iacFilesForm
      setIacFilesForm({
        maxSizeMB: Number(next.maxSizeMB ?? iacFilesForm.maxSizeMB),
        maxZipSizeMB: Number(next.maxZipSizeMB ?? iacFilesForm.maxZipSizeMB),
        extensionBlacklist:
          typeof next.extensionBlacklist === 'string'
            ? next.extensionBlacklist
            : iacFilesForm.extensionBlacklist,
      })
      showToast('IaC file limits saved')
    } catch (err) {
      if (err instanceof ClientResponseError && (err.status === 400 || err.status === 422)) {
        const root = err.response as Record<string, unknown>
        const bag =
          root.errors && typeof root.errors === 'object'
            ? (root.errors as Record<string, unknown>)
            : root
        const nextErrors = {
          maxSizeMB: extractFieldError(bag.maxSizeMB) ?? undefined,
          maxZipSizeMB: extractFieldError(bag.maxZipSizeMB) ?? undefined,
          extensionBlacklist: extractFieldError(bag.extensionBlacklist) ?? undefined,
        }
        if (Object.values(nextErrors).some(Boolean)) {
          setIacFilesErrors(nextErrors)
          showToast('Please fix validation errors and try again.', false)
          return
        }
      }
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setIacFilesSaving(false)
    }
  }

  const validateTunnelPortRange = (): boolean => {
    const errors: Partial<Record<keyof TunnelPortRange, string>> = {}

    if (!Number.isInteger(tunnelPortRangeForm.start) || tunnelPortRangeForm.start < 1 || tunnelPortRangeForm.start > 65535) {
      errors.start = 'Must be an integer between 1 and 65535'
    }
    if (!Number.isInteger(tunnelPortRangeForm.end) || tunnelPortRangeForm.end < 1 || tunnelPortRangeForm.end > 65535) {
      errors.end = 'Must be an integer between 1 and 65535'
    }
    if (Object.keys(errors).length === 0 && tunnelPortRangeForm.start >= tunnelPortRangeForm.end) {
      errors.end = 'Must be greater than start'
    }
    if (
      Object.keys(errors).length === 0 &&
      tunnelPortRangeForm.start <= 2222 &&
      2222 <= tunnelPortRangeForm.end
    ) {
      errors.start = 'Range must not include tunnel SSH port 2222'
      errors.end = 'Range must not include tunnel SSH port 2222'
    }

    setTunnelPortRangeErrors(errors)
    return Object.keys(errors).length === 0
  }

  const saveTunnelPortRange = async () => {
    if (!validateTunnelPortRange()) return
    setTunnelPortRangeSaving(true)
    setTunnelPortRangeErrors({})
    try {
      const res = (await pb.send(settingsEntryPath('tunnel-port-range'), {
        method: 'PATCH',
        body: {
          start: tunnelPortRangeForm.start,
          end: tunnelPortRangeForm.end,
        },
      })) as { value?: Partial<TunnelPortRange> }
      const portRange = res.value ?? tunnelPortRangeForm
      setTunnelPortRangeForm({
        start: Number(portRange.start ?? tunnelPortRangeForm.start),
        end: Number(portRange.end ?? tunnelPortRangeForm.end),
      })
      showToast('Tunnel settings saved')
    } catch (err) {
      if (err instanceof ClientResponseError && (err.status === 400 || err.status === 422)) {
        const inlineErrors = parseTunnelPortRangeApiErrors(err.response)
        if (Object.keys(inlineErrors).length > 0) {
          setTunnelPortRangeErrors(inlineErrors)
          showToast('Please fix validation errors and try again.', false)
          return
        }
      }
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setTunnelPortRangeSaving(false)
    }
  }

  const saveSecretPolicy = async () => {
    setSecretPolicySaving(true)
    setSecretPolicyErrors({})
    try {
      const res = (await pb.send(settingsEntryPath('secrets-policy'), {
        method: 'PATCH',
        body: secretPolicy,
      })) as { value?: unknown }
      setSecretPolicy(normalizeSecretPolicy(res.value))
      showToast('Secrets policy saved')
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 422) {
        const root = err.response as Record<string, unknown>
        const bag =
          root.errors && typeof root.errors === 'object'
            ? (root.errors as Record<string, unknown>)
            : root
        setSecretPolicyErrors({
          revealDisabled: extractFieldError(bag.revealDisabled) ?? undefined,
          defaultAccessMode: extractFieldError(bag.defaultAccessMode) ?? undefined,
          clipboardClearSeconds: extractFieldError(bag.clipboardClearSeconds) ?? undefined,
        })
      }
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setSecretPolicySaving(false)
    }
  }

  const saveDockerMirrors = async () => {
    setMirrorsSaving(true)
    try {
      await pb.send(settingsEntryPath('docker-mirror'), {
        method: 'PATCH',
        body: {
          mirrors: mirrors.filter(Boolean),
          insecureRegistries: insecureRegs.filter(Boolean),
        },
      })
      showToast('Docker mirror settings saved')
    } catch (err) {
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setMirrorsSaving(false)
    }
  }

  const saveDockerRegistries = async () => {
    setRegsSaving(true)
    try {
      await pb.send(settingsEntryPath('docker-registries'), {
        method: 'PATCH',
        body: { items: dockerRegistries },
      })
      showToast('Docker registries saved')
    } catch (err) {
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setRegsSaving(false)
    }
  }

  const saveLlm = async () => {
    setLlmSaving(true)
    try {
      await pb.send(settingsEntryPath('llm-providers'), {
        method: 'PATCH',
        body: { items: llmItems },
      })
      showToast('LLM providers saved')
    } catch (err) {
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setLlmSaving(false)
    }
  }

  // ─── Render helpers ───────────────────────────────────────────────────────

  const selectClass =
    'h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring'

  const SaveBtn = ({
    onClick,
    saving,
    label = 'Save',
  }: {
    onClick: () => void
    saving: boolean
    label?: string
  }) => (
    <Button onClick={onClick} disabled={saving}>
      {saving ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Saving…
        </>
      ) : (
        label
      )}
    </Button>
  )

  // ─── Section renderers ────────────────────────────────────────────────────

  const renderBasic = () => (
    <Card>
      <CardHeader>
        <CardTitle>Basic</CardTitle>
        <CardDescription>Application name and public URL</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="appName">App Name</Label>
          <Input
            id="appName"
            value={appName}
            onChange={e => setAppName(e.target.value)}
            placeholder="AppOS"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="appURL">App URL</Label>
          <Input
            id="appURL"
            type="url"
            value={appURL}
            onChange={e => setAppURL(e.target.value)}
            placeholder="https://example.com"
          />
        </div>
        <SaveBtn onClick={saveApp} saving={appSaving} />
      </CardContent>
    </Card>
  )

  const renderSmtp = () => (
    <Card>
      <CardHeader>
        <CardTitle>SMTP</CardTitle>
        <CardDescription>Outgoing email configuration</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Toggle id="smtpEnabled" checked={smtpEnabled} onChange={setSmtpEnabled} />
          <Label htmlFor="smtpEnabled">Enable SMTP</Label>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="smtpHost">Host</Label>
            <Input
              id="smtpHost"
              value={smtpHost}
              onChange={e => setSmtpHost(e.target.value)}
              placeholder="smtp.example.com"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="smtpPort">Port</Label>
            <Input
              id="smtpPort"
              type="number"
              value={smtpPort}
              onChange={e => setSmtpPort(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="smtpUsername">Username</Label>
            <Input
              id="smtpUsername"
              value={smtpUsername}
              onChange={e => setSmtpUsername(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="smtpPassword">Password</Label>
            <Input
              id="smtpPassword"
              type="password"
              value={smtpPassword}
              onChange={e => setSmtpPassword(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="smtpAuthMethod">Auth Method</Label>
          <select
            id="smtpAuthMethod"
            className={selectClass}
            value={smtpAuthMethod}
            onChange={e => setSmtpAuthMethod(e.target.value)}
          >
            <option value="">— None —</option>
            <option value="PLAIN">PLAIN</option>
            <option value="LOGIN">LOGIN</option>
            <option value="CRAM-MD5">CRAM-MD5</option>
          </select>
        </div>
        <div className="flex items-center gap-3">
          <Toggle id="smtpTls" checked={smtpTls} onChange={setSmtpTls} />
          <Label htmlFor="smtpTls">Use TLS</Label>
        </div>
        <div className="space-y-1">
          <Label htmlFor="smtpLocalName">Local Name</Label>
          <Input
            id="smtpLocalName"
            value={smtpLocalName}
            onChange={e => setSmtpLocalName(e.target.value)}
            placeholder="localhost"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <SaveBtn onClick={saveSmtp} saving={smtpSaving} />
          <Input
            placeholder="recipient@example.com"
            value={testEmailRecipient}
            onChange={e => setTestEmailRecipient(e.target.value)}
            className="w-56"
          />
          <Button variant="outline" onClick={sendTestEmail} disabled={testEmailSending}>
            {testEmailSending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending…
              </>
            ) : (
              'Send Test Email'
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )

  const renderS3 = () => (
    <Card>
      <CardHeader>
        <CardTitle>S3 Storage</CardTitle>
        <CardDescription>External S3-compatible storage configuration</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Toggle id="s3Enabled" checked={s3Enabled} onChange={setS3Enabled} />
          <Label htmlFor="s3Enabled">Enable S3</Label>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="s3Bucket">Bucket</Label>
            <Input id="s3Bucket" value={s3Bucket} onChange={e => setS3Bucket(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="s3Region">Region</Label>
            <Input id="s3Region" value={s3Region} onChange={e => setS3Region(e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1">
            <Label htmlFor="s3Endpoint">Endpoint</Label>
            <Input
              id="s3Endpoint"
              value={s3Endpoint}
              onChange={e => setS3Endpoint(e.target.value)}
              placeholder="https://s3.example.com"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="s3AccessKey">Access Key</Label>
            <Input
              id="s3AccessKey"
              value={s3AccessKey}
              onChange={e => setS3AccessKey(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="s3Secret">Secret</Label>
            <Input
              id="s3Secret"
              type="password"
              value={s3Secret}
              onChange={e => setS3Secret(e.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Toggle id="s3ForcePathStyle" checked={s3ForcePathStyle} onChange={setS3ForcePathStyle} />
          <Label htmlFor="s3ForcePathStyle">Force Path Style</Label>
        </div>
        <div className="flex gap-2">
          <SaveBtn onClick={saveS3} saving={s3Saving} />
          <Button variant="outline" onClick={testS3} disabled={s3Testing}>
            {s3Testing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Testing…
              </>
            ) : (
              'Test Connection'
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )

  const renderLogs = () => (
    <Card>
      <CardHeader>
        <CardTitle>Logs</CardTitle>
        <CardDescription>Log retention and filtering options</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="logsMaxDays">Max Days</Label>
            <Input
              id="logsMaxDays"
              type="number"
              min={1}
              value={logsMaxDays}
              onChange={e => setLogsMaxDays(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="logsMinLevel">Min Level</Label>
            <select
              id="logsMinLevel"
              className={selectClass}
              value={logsMinLevel}
              onChange={e => setLogsMinLevel(Number(e.target.value))}
            >
              <option value={0}>DEBUG</option>
              <option value={5}>INFO</option>
              <option value={8}>WARN</option>
              <option value={9}>ERROR</option>
            </select>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Toggle id="logsLogIP" checked={logsLogIP} onChange={setLogsLogIP} />
          <Label htmlFor="logsLogIP">Log IP Address</Label>
        </div>
        <div className="flex items-center gap-3">
          <Toggle id="logsLogAuthId" checked={logsLogAuthId} onChange={setLogsLogAuthId} />
          <Label htmlFor="logsLogAuthId">Log Auth ID</Label>
        </div>
        <SaveBtn onClick={saveLogs} saving={logsSaving} />
      </CardContent>
    </Card>
  )

  const renderSpace = () => (
    <Card>
      <CardHeader>
        <CardTitle>Space Quota</CardTitle>
        <CardDescription>Per-user private space limits</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="maxSizeMB">Max File Size (MB)</Label>
            <Input
              id="maxSizeMB"
              type="number"
              min={1}
              value={spaceQuotaForm.maxSizeMB}
              onChange={e => setSpaceQuotaForm(f => ({ ...f, maxSizeMB: Number(e.target.value) }))}
            />
            {spaceQuotaErrors.maxSizeMB && (
              <p className="text-xs text-destructive">{spaceQuotaErrors.maxSizeMB}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="maxPerUser">Max Items per User</Label>
            <Input
              id="maxPerUser"
              type="number"
              min={1}
              value={spaceQuotaForm.maxPerUser}
              onChange={e => setSpaceQuotaForm(f => ({ ...f, maxPerUser: Number(e.target.value) }))}
            />
            {spaceQuotaErrors.maxPerUser && (
              <p className="text-xs text-destructive">{spaceQuotaErrors.maxPerUser}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="maxUploadFiles">Max Files per Upload</Label>
            <Input
              id="maxUploadFiles"
              type="number"
              min={1}
              max={200}
              value={spaceQuotaForm.maxUploadFiles}
              onChange={e =>
                setSpaceQuotaForm(f => ({ ...f, maxUploadFiles: Number(e.target.value) }))
              }
            />
            {spaceQuotaErrors.maxUploadFiles && (
              <p className="text-xs text-destructive">{spaceQuotaErrors.maxUploadFiles}</p>
            )}
          </div>
          <div className="col-span-2 grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="shareDefaultMinutes">Share Default Duration (min)</Label>
              <Input
                id="shareDefaultMinutes"
                type="number"
                min={1}
                value={spaceQuotaForm.shareDefaultMinutes}
                onChange={e =>
                  setSpaceQuotaForm(f => ({ ...f, shareDefaultMinutes: Number(e.target.value) }))
                }
              />
              {spaceQuotaErrors.shareDefaultMinutes && (
                <p className="text-xs text-destructive">{spaceQuotaErrors.shareDefaultMinutes}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="shareMaxMinutes">Share Max Duration (min)</Label>
              <Input
                id="shareMaxMinutes"
                type="number"
                min={1}
                value={spaceQuotaForm.shareMaxMinutes}
                onChange={e =>
                  setSpaceQuotaForm(f => ({ ...f, shareMaxMinutes: Number(e.target.value) }))
                }
              />
              {spaceQuotaErrors.shareMaxMinutes && (
                <p className="text-xs text-destructive">{spaceQuotaErrors.shareMaxMinutes}</p>
              )}
            </div>
          </div>
          <div className="col-span-2 space-y-1">
            <Label htmlFor="uploadAllowExts">Upload Allowlist (extensions, comma-separated)</Label>
            <Input
              id="uploadAllowExts"
              value={allowExtsText}
              onChange={e => setAllowExtsText(e.target.value)}
              onBlur={() => {
                const parsed = parseExtListInput(allowExtsText)
                setAllowExtsText(parsed.join(', '))
                setSpaceQuotaForm(f => ({ ...f, uploadAllowExts: parsed }))
              }}
              placeholder="yaml, yml, json, python"
            />
            <p className="text-xs text-muted-foreground">
              Examples: yaml, yml, json, python (python will be normalized to py).
            </p>
          </div>
          <div className="col-span-2 space-y-1">
            <Label htmlFor="uploadDenyExts">Upload Denylist (extensions, comma-separated)</Label>
            <Input
              id="uploadDenyExts"
              value={denyExtsText}
              onChange={e => setDenyExtsText(e.target.value)}
              onBlur={() => {
                const parsed = parseExtListInput(denyExtsText)
                setDenyExtsText(parsed.join(', '))
                setSpaceQuotaForm(f => ({ ...f, uploadDenyExts: parsed }))
              }}
              placeholder="exe, dll, bat"
              disabled={parseExtListInput(allowExtsText).length > 0}
            />
            <p className="text-xs text-muted-foreground">Examples: exe, dll, bat, cmd.</p>
            {parseExtListInput(allowExtsText).length > 0 && (
              <p className="text-xs text-muted-foreground">
                Allowlist is set, so denylist is ignored.
              </p>
            )}
          </div>
          <div className="col-span-2 space-y-1">
            <Label htmlFor="disallowedFolderNames">Disallowed Folder Names (comma-separated)</Label>
            <Input
              id="disallowedFolderNames"
              value={disallowedFolderNamesText}
              onChange={e => setDisallowedFolderNamesText(e.target.value)}
              placeholder="e.g. private, tmp, archive"
            />
            <p className="text-xs text-muted-foreground">
              Folder names users are not allowed to create at any level. Case-sensitive.
            </p>
          </div>
        </div>
        <SaveBtn onClick={saveSpaceQuota} saving={spaceQuotaSaving} />
      </CardContent>
    </Card>
  )

  const renderProxy = () => (
    <Card>
      <CardHeader>
        <CardTitle>Proxy</CardTitle>
        <CardDescription>HTTP proxy for outbound requests</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="httpProxy">HTTP Proxy</Label>
            <Input
              id="httpProxy"
              value={proxyForm.httpProxy}
              onChange={e => setProxyForm(f => ({ ...f, httpProxy: e.target.value }))}
              placeholder="http://proxy:3128"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="httpsProxy">HTTPS Proxy</Label>
            <Input
              id="httpsProxy"
              value={proxyForm.httpsProxy}
              onChange={e => setProxyForm(f => ({ ...f, httpsProxy: e.target.value }))}
              placeholder="http://proxy:3128"
            />
          </div>
          <div className="col-span-2 space-y-1">
            <Label htmlFor="noProxy">No Proxy</Label>
            <Input
              id="noProxy"
              value={proxyForm.noProxy}
              onChange={e => setProxyForm(f => ({ ...f, noProxy: e.target.value }))}
              placeholder="localhost,127.0.0.1"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="proxyUsername">Username</Label>
            <Input
              id="proxyUsername"
              value={proxyForm.username}
              onChange={e => setProxyForm(f => ({ ...f, username: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="proxyPassword">Password</Label>
            <Input
              id="proxyPassword"
              type="password"
              value={proxyForm.password}
              onChange={e => setProxyForm(f => ({ ...f, password: e.target.value }))}
              placeholder={proxyNetwork.password ? '***' : ''}
            />
          </div>
        </div>
        <SaveBtn onClick={saveProxy} saving={proxySaving} />
      </CardContent>
    </Card>
  )

  const renderConnectTerminal = () => (
    <Card>
      <CardHeader>
        <CardTitle>Connect Terminal</CardTitle>
        <CardDescription>Connection policy for Connect terminal sessions</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="connectIdleTimeout">Terminal Idle Timeout (seconds)</Label>
            <Input
              id="connectIdleTimeout"
              type="number"
              min={60}
              step={1}
              value={connectTerminalForm.idleTimeoutSeconds}
              onChange={event =>
                setConnectTerminalForm(form => ({
                  ...form,
                  idleTimeoutSeconds: Number(event.target.value),
                }))
              }
            />
            {connectTerminalErrors.idleTimeoutSeconds && (
              <p className="text-xs text-destructive">{connectTerminalErrors.idleTimeoutSeconds}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="connectMaxConnections">Max Connections</Label>
            <Input
              id="connectMaxConnections"
              type="number"
              min={0}
              step={1}
              value={connectTerminalForm.maxConnections}
              onChange={event =>
                setConnectTerminalForm(form => ({
                  ...form,
                  maxConnections: Number(event.target.value),
                }))
              }
            />
            <p className="text-xs text-muted-foreground">0 means unlimited.</p>
            {connectTerminalErrors.maxConnections && (
              <p className="text-xs text-destructive">{connectTerminalErrors.maxConnections}</p>
            )}
          </div>
        </div>
        <SaveBtn onClick={saveConnectTerminal} saving={connectTerminalSaving} />
      </CardContent>
    </Card>
  )

  const renderDeployPreflight = () => (
    <Card>
      <CardHeader>
        <CardTitle>Deploy Preflight</CardTitle>
        <CardDescription>Disk-capacity guardrails used during install preflight</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="deployMinFreeDiskBytes">Minimum Free Disk (bytes)</Label>
            <Input
              id="deployMinFreeDiskBytes"
              type="number"
              min={0}
              step={1}
              value={deployPreflightForm.minFreeDiskBytes}
              onChange={event =>
                setDeployPreflightForm(form => ({
                  ...form,
                  minFreeDiskBytes: Number(event.target.value),
                }))
              }
            />
            <p className="text-xs text-muted-foreground">
              Default is 536870912 bytes (0.5 GiB). Creation is blocked when available disk falls below this threshold.
            </p>
            {deployPreflightErrors.minFreeDiskBytes && (
              <p className="text-xs text-destructive">{deployPreflightErrors.minFreeDiskBytes}</p>
            )}
          </div>
        </div>
        <SaveBtn onClick={saveDeployPreflight} saving={deployPreflightSaving} />
      </CardContent>
    </Card>
  )

  const renderIacFiles = () => (
    <Card>
      <CardHeader>
        <CardTitle>IaC Files</CardTitle>
        <CardDescription>
          Limits for IaC file reading and uploads in the workspace browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2">
          <Label htmlFor="iac-max-size-mb">Max File Size MB</Label>
          <Input
            id="iac-max-size-mb"
            type="number"
            value={iacFilesForm.maxSizeMB}
            onChange={e =>
              setIacFilesForm(current => ({
                ...current,
                maxSizeMB: Number(e.target.value),
              }))
            }
          />
          {iacFilesErrors.maxSizeMB && (
            <p className="text-sm text-destructive">{iacFilesErrors.maxSizeMB}</p>
          )}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="iac-max-zip-size-mb">Max ZIP Size MB</Label>
          <Input
            id="iac-max-zip-size-mb"
            type="number"
            value={iacFilesForm.maxZipSizeMB}
            onChange={e =>
              setIacFilesForm(current => ({
                ...current,
                maxZipSizeMB: Number(e.target.value),
              }))
            }
          />
          {iacFilesErrors.maxZipSizeMB && (
            <p className="text-sm text-destructive">{iacFilesErrors.maxZipSizeMB}</p>
          )}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="iac-extension-blacklist">Extension Blacklist</Label>
          <Input
            id="iac-extension-blacklist"
            value={iacFilesForm.extensionBlacklist}
            onChange={e =>
              setIacFilesForm(current => ({
                ...current,
                extensionBlacklist: e.target.value,
              }))
            }
            placeholder=".exe,.dll,.so"
          />
          {iacFilesErrors.extensionBlacklist && (
            <p className="text-sm text-destructive">{iacFilesErrors.extensionBlacklist}</p>
          )}
        </div>

        <div className="flex justify-end">
          <Button onClick={() => void saveIacFiles()} disabled={iacFilesSaving}>
            {iacFilesSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  )

  const renderTunnel = () => (
    <Card>
      <CardHeader>
        <CardTitle>Tunnel</CardTitle>
        <CardDescription>Port pool range for reverse tunnel allocation</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="tunnelPortRangeStart">Start Port</Label>
            <Input
              id="tunnelPortRangeStart"
              type="number"
              min={1}
              max={65535}
              step={1}
              value={tunnelPortRangeForm.start}
              onChange={event =>
                setTunnelPortRangeForm(form => ({
                  ...form,
                  start: Number(event.target.value),
                }))
              }
            />
            {tunnelPortRangeErrors.start && (
              <p className="text-xs text-destructive">{tunnelPortRangeErrors.start}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="tunnelPortRangeEnd">End Port</Label>
            <Input
              id="tunnelPortRangeEnd"
              type="number"
              min={1}
              max={65535}
              step={1}
              value={tunnelPortRangeForm.end}
              onChange={event =>
                setTunnelPortRangeForm(form => ({
                  ...form,
                  end: Number(event.target.value),
                }))
              }
            />
            {tunnelPortRangeErrors.end && (
              <p className="text-xs text-destructive">{tunnelPortRangeErrors.end}</p>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Changes affect future startup and allocation behavior only. Active tunnel sessions are not
          reconfigured in place.
        </p>
        <SaveBtn onClick={saveTunnelPortRange} saving={tunnelPortRangeSaving} />
      </CardContent>
    </Card>
  )

  const renderSecrets = () => (
    <Card>
      <CardHeader>
        <CardTitle>Secrets</CardTitle>
        <CardDescription>Global reveal restrictions and default secret behavior</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Toggle
            id="secretsRevealDisabled"
            checked={secretPolicy.revealDisabled}
            onChange={revealDisabled => setSecretPolicy(policy => ({ ...policy, revealDisabled }))}
          />
          <Label htmlFor="secretsRevealDisabled">Disable all reveal actions</Label>
        </div>
        {secretPolicyErrors.revealDisabled && (
          <p className="text-xs text-destructive">{secretPolicyErrors.revealDisabled}</p>
        )}

        <div className="space-y-1">
          <Label htmlFor="secretsDefaultAccessMode">Default Access Mode</Label>
          <select
            id="secretsDefaultAccessMode"
            className={selectClass}
            value={secretPolicy.defaultAccessMode}
            onChange={e =>
              setSecretPolicy(policy => ({ ...policy, defaultAccessMode: e.target.value }))
            }
          >
            {SECRET_ACCESS_MODE_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {secretPolicyErrors.defaultAccessMode && (
            <p className="text-xs text-destructive">{secretPolicyErrors.defaultAccessMode}</p>
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor="clipboardClearSeconds">Clipboard Clear Delay (seconds)</Label>
          <Input
            id="clipboardClearSeconds"
            type="number"
            min={0}
            value={secretPolicy.clipboardClearSeconds}
            onChange={e =>
              setSecretPolicy(policy => ({
                ...policy,
                clipboardClearSeconds: Number(e.target.value),
              }))
            }
          />
          <p className="text-xs text-muted-foreground">0 disables automatic clipboard clearing.</p>
          {secretPolicyErrors.clipboardClearSeconds && (
            <p className="text-xs text-destructive">{secretPolicyErrors.clipboardClearSeconds}</p>
          )}
        </div>

        <SaveBtn onClick={saveSecretPolicy} saving={secretPolicySaving} />
      </CardContent>
    </Card>
  )

  const renderDockerMirrors = () => (
    <Card>
      <CardHeader>
        <CardTitle>Docker Mirrors</CardTitle>
        <CardDescription>Registry mirror URLs and insecure registries</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Registry Mirrors list */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Registry Mirrors</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setMirrors(m => [...m, ''])}
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> Add
            </Button>
          </div>
          {mirrors.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No mirrors configured. Click Add to add one.
            </p>
          )}
          {mirrors.map((url, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={url}
                onChange={e => setMirrors(m => m.map((v, idx) => (idx === i ? e.target.value : v)))}
                placeholder="https://mirror.example.com"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setMirrors(m => m.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>

        {/* Insecure Registries list */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Insecure Registries</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setInsecureRegs(r => [...r, ''])}
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> Add
            </Button>
          </div>
          {insecureRegs.length === 0 && (
            <p className="text-sm text-muted-foreground">No insecure registries configured.</p>
          )}
          {insecureRegs.map((reg, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={reg}
                onChange={e =>
                  setInsecureRegs(r => r.map((v, idx) => (idx === i ? e.target.value : v)))
                }
                placeholder="my-registry:5000"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setInsecureRegs(r => r.filter((_, idx) => idx !== i))}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>

        <SaveBtn onClick={saveDockerMirrors} saving={mirrorsSaving} />
      </CardContent>
    </Card>
  )

  const renderDockerRegistries = () => (
    <Card>
      <CardHeader>
        <CardTitle>Docker Registries</CardTitle>
        <CardDescription>Private registry credentials</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setDockerRegistries(r => [...r, { host: '', username: '', password: '' }])
            }
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Registry
          </Button>
        </div>
        {dockerRegistries.length === 0 && (
          <p className="text-sm text-muted-foreground">No private registries configured.</p>
        )}
        {dockerRegistries.map((reg, i) => (
          <div key={i} className="flex gap-2 items-end">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Host</Label>
              <Input
                value={reg.host}
                onChange={e =>
                  setDockerRegistries(r =>
                    r.map((item, idx) => (idx === i ? { ...item, host: e.target.value } : item))
                  )
                }
                placeholder="registry.example.com"
              />
            </div>
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Username</Label>
              <Input
                value={reg.username}
                onChange={e =>
                  setDockerRegistries(r =>
                    r.map((item, idx) => (idx === i ? { ...item, username: e.target.value } : item))
                  )
                }
              />
            </div>
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Password</Label>
              <Input
                type="password"
                value={reg.password}
                onChange={e =>
                  setDockerRegistries(r =>
                    r.map((item, idx) => (idx === i ? { ...item, password: e.target.value } : item))
                  )
                }
                placeholder={reg.password === '***' ? '***' : ''}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setDockerRegistries(r => r.filter((_, idx) => idx !== i))}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ))}
        <SaveBtn onClick={saveDockerRegistries} saving={regsSaving} />
      </CardContent>
    </Card>
  )

  const renderLlm = () => {
    const vendorEndpoint = (label: string) =>
      LLM_VENDORS.find(v => v.label === label)?.endpoint ?? ''

    return (
      <>
        <Card>
          <CardHeader>
            <CardTitle>LLM Providers</CardTitle>
            <CardDescription>AI model provider endpoints and credentials</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setLlmItems(p => [
                    ...p,
                    { name: 'OpenAI', endpoint: 'https://api.openai.com/v1', apiKey: '' },
                  ])
                }
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Provider
              </Button>
            </div>
            {llmItems.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No providers configured. Click Add Provider to get started.
              </p>
            )}
            {llmItems.map((prov, i) => {
              // Determine which vendor is selected (match on name field)
              const vendorLabel = LLM_VENDORS.find(v => v.label === prov.name)?.label ?? 'Custom'
              return (
                <div key={i} className="rounded-md border p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1 w-48">
                      <Label className="text-xs">Provider</Label>
                      <select
                        className={selectClass}
                        value={vendorLabel}
                        onChange={e => {
                          const ep = vendorEndpoint(e.target.value)
                          setLlmItems(p =>
                            p.map((item, idx) =>
                              idx === i ? { ...item, name: e.target.value, endpoint: ep } : item
                            )
                          )
                        }}
                      >
                        {LLM_VENDORS.map(v => (
                          <option key={v.label} value={v.label}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setLlmItems(p => p.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Endpoint URL</Label>
                    <Input
                      value={prov.endpoint}
                      onChange={e =>
                        setLlmItems(p =>
                          p.map((item, idx) =>
                            idx === i ? { ...item, endpoint: e.target.value } : item
                          )
                        )
                      }
                      placeholder="https://api.example.com/v1"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">API Key</Label>
                    <div className="flex gap-2 items-center">
                      <select
                        className={selectClass + ' flex-1'}
                        value={
                          prov.apiKey.startsWith('secretRef:')
                            ? prov.apiKey.slice('secretRef:'.length)
                            : ''
                        }
                        onChange={e => {
                          const val = e.target.value
                          setLlmItems(p =>
                            p.map((item, idx) =>
                              idx === i ? { ...item, apiKey: val ? `secretRef:${val}` : '' } : item
                            )
                          )
                        }}
                      >
                        <option value="">Select a secret…</option>
                        {secretPickerItems.map(s => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        title="Create new API key secret"
                        onClick={() => {
                          setLlmSecretCreateIdx(i)
                          setLlmSecretCreateName(`${prov.name} API Key`)
                          setLlmSecretCreateKey('')
                          setLlmSecretCreateError('')
                          setLlmSecretCreateOpen(true)
                        }}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
            <SaveBtn onClick={saveLlm} saving={llmSaving} />
          </CardContent>
        </Card>

        {/* Inline create-secret dialog for LLM API key */}
        <Dialog open={llmSecretCreateOpen} onOpenChange={setLlmSecretCreateOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create API Key Secret</DialogTitle>
              <DialogDescription>
                Create a new secret and select it automatically.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleLlmSecretCreate} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">
                  Name<span className="text-destructive ml-1">*</span>
                </Label>
                <Input
                  value={llmSecretCreateName}
                  onChange={e => setLlmSecretCreateName(e.target.value)}
                  placeholder="OpenAI API Key"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">
                  API Key<span className="text-destructive ml-1">*</span>
                </Label>
                <Input
                  type="password"
                  value={llmSecretCreateKey}
                  onChange={e => setLlmSecretCreateKey(e.target.value)}
                  placeholder="sk-..."
                  required
                />
              </div>
              {llmSecretCreateError && (
                <p className="text-destructive text-sm">{llmSecretCreateError}</p>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setLlmSecretCreateOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={llmSecretCreateSaving}>
                  {llmSecretCreateSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Create
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </>
    )
  }

  const renderSection = () => {
    switch (activeSection) {
      case 'basic':
        return renderBasic()
      case 'smtp':
        return renderSmtp()
      case 's3':
        return renderS3()
      case 'logs':
        return renderLogs()
      case 'space-quota':
        return renderSpace()
      case 'connect-terminal':
        return renderConnectTerminal()
      case 'deploy-preflight':
        return renderDeployPreflight()
      case 'iac-files':
        return renderIacFiles()
      case 'tunnel-port-range':
        return renderTunnel()
      case 'secrets-policy':
        return renderSecrets()
      case 'proxy-network':
        return renderProxy()
      case 'docker-mirror':
        return renderDockerMirrors()
      case 'docker-registries':
        return renderDockerRegistries()
      case 'llm-providers':
        return renderLlm()
    }
  }

  // ─── Main layout ──────────────────────────────────────────────────────────

  const groups: SettingsSection[] = ['system', 'workspace'].filter(group =>
    schemaEntries.some(entry => entry.section === group)
  ) as SettingsSection[]

  return (
    <div className="p-6">
      {/* Toast stack */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`px-4 py-2 rounded-md shadow text-sm text-white ${t.ok ? 'bg-green-600' : 'bg-red-600'}`}
          >
            {t.msg}
          </div>
        ))}
      </div>

      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      {pbLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="flex gap-6 max-w-4xl">
          {/* Left nav */}
          <nav className="w-44 shrink-0 space-y-4">
            {groups.map(group => (
              <div key={group}>
                <p className="px-3 mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {sectionLabel(group)}
                </p>
                <div className="space-y-0.5">
                  {schemaEntries
                    .filter(entry => entry.section === group)
                    .map(item => (
                    <button
                      key={item.id}
                      onClick={() => setActiveSection(item.id)}
                      className={`w-full text-left px-3 py-2 text-sm rounded-md transition-colors ${
                        activeSection === item.id
                          ? 'bg-accent text-accent-foreground font-medium'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                      }`}
                    >
                      {item.title}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>

          {/* Right content */}
          <div className="flex-1 min-w-0">{renderSection()}</div>
        </div>
      )}
    </div>
  )
}

export const Route = createFileRoute('/_app/_auth/_superuser/settings')({
  component: SettingsPage,
})
