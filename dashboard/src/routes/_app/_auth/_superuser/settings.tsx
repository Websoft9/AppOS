import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useCallback } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { pb } from '@/lib/pb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card'

// ─── Types ────────────────────────────────────────────────────────────────

interface PBSettings {
  meta: {
    appName: string
    appURL: string
    senderName?: string
    senderAddress?: string
    hideControls?: boolean
  }
  smtp: {
    enabled: boolean
    host: string
    port: number
    username: string
    password: string
    authMethod: string
    tls: boolean
    localName: string
  }
  s3: {
    enabled: boolean
    bucket: string
    region: string
    endpoint: string
    accessKey: string
    secret: string
    forcePathStyle: boolean
  }
  logs: {
    maxDays: number
    minLevel: number
    logIP: boolean
    logAuthId: boolean
  }
}

interface SpaceQuota {
  maxSizeMB: number
  maxPerUser: number
  shareMaxMinutes: number
  shareDefaultMinutes: number
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

// LLM vendor catalog — pre-fills name + endpoint when user selects a vendor
const LLM_VENDORS: { label: string; endpoint: string }[] = [
  { label: 'OpenAI',        endpoint: 'https://api.openai.com/v1' },
  { label: 'Anthropic',     endpoint: 'https://api.anthropic.com' },
  { label: 'Google Gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta' },
  { label: 'Mistral',       endpoint: 'https://api.mistral.ai/v1' },
  { label: 'DeepSeek',      endpoint: 'https://api.deepseek.com/v1' },
  { label: 'Groq',          endpoint: 'https://api.groq.com/openai/v1' },
  { label: 'OpenRouter',    endpoint: 'https://openrouter.ai/api/v1' },
  { label: 'Azure OpenAI',  endpoint: 'https://{resource}.openai.azure.com/openai/deployments/{model}' },
  { label: 'Ollama',        endpoint: 'http://localhost:11434/v1' },
  { label: 'Custom',        endpoint: '' },
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

function Toggle({ checked, onChange, id }: { checked: boolean; onChange: (v: boolean) => void; id?: string }) {
  return (
    <button
      id={id}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${checked ? 'bg-primary' : 'bg-input'}`}
    >
      <span className={`pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  )
}


// ─── Nav items ────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { id: 'basic',              group: 'System',  label: 'Basic' },
  { id: 'smtp',               group: 'System',  label: 'SMTP' },
  { id: 's3',                 group: 'System',  label: 'S3 Storage' },
  { id: 'logs',               group: 'System',  label: 'Logs' },
  { id: 'space',              group: 'App',     label: 'Space Quota' },
  { id: 'proxy',              group: 'App',     label: 'Proxy' },
  { id: 'docker-mirrors',     group: 'App',     label: 'Docker Mirrors' },
  { id: 'docker-registries',  group: 'App',     label: 'Docker Registries' },
  { id: 'llm',                group: 'App',     label: 'LLM Providers' },
] as const

type SectionId = typeof NAV_ITEMS[number]['id']

// ─── Module-level defaults (outside component to avoid stale closure captures) ─

const DEFAULT_SPACE_QUOTA: SpaceQuota = {
  maxSizeMB: 10,
  maxPerUser: 100,
  shareMaxMinutes: 60,
  shareDefaultMinutes: 30,
}

const EMPTY_PROXY: ProxyNetwork = {
  httpProxy: '', httpsProxy: '', noProxy: '', username: '', password: '',
}

// ─── Component ────────────────────────────────────────────────────────────

function SettingsPage() {
  const { toasts, show: showToast } = useToast()
  const [activeSection, setActiveSection] = useState<SectionId>('basic')

  // ── PB settings state ──
  const [pbSettings, setPbSettings] = useState<PBSettings | null>(null)
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
  const [spaceQuotaErrors, setSpaceQuotaErrors] = useState<Partial<Record<keyof SpaceQuota, string>>>({})

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

  // ── Load PB settings ──
  const loadPBSettings = useCallback(async () => {
    setPbLoading(true)
    try {
      const data = await pb.send('/api/settings', { method: 'GET' }) as PBSettings
      setPbSettings(data)
      setAppName(data.meta?.appName ?? '')
      setAppURL(data.meta?.appURL ?? '')
      setSmtpEnabled(data.smtp?.enabled ?? false)
      setSmtpHost(data.smtp?.host ?? '')
      setSmtpPort(data.smtp?.port ?? 587)
      setSmtpUsername(data.smtp?.username ?? '')
      setSmtpPassword(data.smtp?.password ?? '')
      setSmtpAuthMethod(data.smtp?.authMethod ?? '')
      setSmtpTls(data.smtp?.tls ?? false)
      setSmtpLocalName(data.smtp?.localName ?? '')
      setS3Enabled(data.s3?.enabled ?? false)
      setS3Bucket(data.s3?.bucket ?? '')
      setS3Region(data.s3?.region ?? '')
      setS3Endpoint(data.s3?.endpoint ?? '')
      setS3AccessKey(data.s3?.accessKey ?? '')
      setS3Secret(data.s3?.secret ?? '')
      setS3ForcePathStyle(data.s3?.forcePathStyle ?? false)
      setLogsMaxDays(data.logs?.maxDays ?? 7)
      setLogsMinLevel(data.logs?.minLevel ?? 5)
      setLogsLogIP(data.logs?.logIP ?? false)
      setLogsLogAuthId(data.logs?.logAuthId ?? false)
    } catch (err) {
      showToast('Failed to load system settings: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setPbLoading(false)
    }
  }, [showToast])

  // ── Load Ext settings ──
  const loadExtSettings = useCallback(async () => {
    try {
      const [filesRes, proxyRes, dockerRes, llmRes] = await Promise.allSettled([
        pb.send('/api/ext/settings/space', { method: 'GET' }),
        pb.send('/api/ext/settings/proxy', { method: 'GET' }),
        pb.send('/api/ext/settings/docker', { method: 'GET' }),
        pb.send('/api/ext/settings/llm', { method: 'GET' }),
      ])
      if (filesRes.status === 'fulfilled') {
        const q = (filesRes.value as { quota: SpaceQuota }).quota ?? DEFAULT_SPACE_QUOTA
        setSpaceQuotaForm(q)
      }
      if (proxyRes.status === 'fulfilled') {
        const n = (proxyRes.value as { network: ProxyNetwork }).network ?? EMPTY_PROXY
        setProxyNetwork(n); setProxyForm(n)
      }
      if (dockerRes.status === 'fulfilled') {
        const dv = dockerRes.value as { mirror?: DockerMirror; registries?: DockerRegistries }
        setMirrors(dv.mirror?.mirrors ?? [])
        setInsecureRegs(dv.mirror?.insecureRegistries ?? [])
        setDockerRegistries(dv.registries?.items ?? [])
      }
      if (llmRes.status === 'fulfilled') {
        const lv = (llmRes.value as { providers: { items: LLMProviderItem[] } }).providers
        setLlmItems(lv?.items ?? [])
      }
    } catch (err) {
      showToast('Failed to load app settings: ' + (err instanceof Error ? err.message : String(err)), false)
    }
  }, [showToast])

  useEffect(() => {
    loadPBSettings()
    loadExtSettings()
  }, [loadPBSettings, loadExtSettings])

  // ── Save handlers ──

  const saveApp = async () => {
    setAppSaving(true)
    try {
      // Use cached settings if available; re-fetch only when not yet loaded to
      // avoid overwriting meta fields (senderName, etc.) not exposed in this form.
      const current = pbSettings ?? await pb.send('/api/settings', { method: 'GET' }) as PBSettings
      await pb.send('/api/settings', {
        method: 'PATCH',
        body: { meta: { ...current.meta, appName, appURL } },
      })
      // Update local state to reflect the saved values so subsequent saves in
      // the same session use an accurate base (not the stale initial fetch).
      setPbSettings({ ...current, meta: { ...current.meta, appName, appURL } })
      showToast('Basic settings saved')
    } catch (err) {
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally { setAppSaving(false) }
  }

  const saveSmtp = async () => {
    setSmtpSaving(true)
    try {
      await pb.send('/api/settings', {
        method: 'PATCH',
        body: { smtp: { enabled: smtpEnabled, host: smtpHost, port: smtpPort, username: smtpUsername, password: smtpPassword, authMethod: smtpAuthMethod, tls: smtpTls, localName: smtpLocalName } },
      })
      showToast('SMTP settings saved')
    } catch (err) {
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally { setSmtpSaving(false) }
  }

  const sendTestEmail = async () => {
    if (!testEmailRecipient) { showToast('Enter a recipient email first', false); return }
    setTestEmailSending(true)
    try {
      await pb.send('/api/settings/test/email', {
        method: 'POST',
        body: { template: { subject: 'Test email from AppOS', actionUrl: '', actionName: '' }, to: [{ address: testEmailRecipient, name: '' }] },
      })
      showToast('Test email sent successfully')
    } catch (err) {
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally { setTestEmailSending(false) }
  }

  const saveS3 = async () => {
    setS3Saving(true)
    try {
      await pb.send('/api/settings', {
        method: 'PATCH',
        body: { s3: { enabled: s3Enabled, bucket: s3Bucket, region: s3Region, endpoint: s3Endpoint, accessKey: s3AccessKey, secret: s3Secret, forcePathStyle: s3ForcePathStyle } },
      })
      showToast('S3 settings saved')
    } catch (err) {
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally { setS3Saving(false) }
  }

  const testS3 = async () => {
    setS3Testing(true)
    try {
      await pb.send('/api/settings/test/s3', { method: 'POST' })
      showToast('S3 connection successful')
    } catch (err) {
      showToast('S3 test failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally { setS3Testing(false) }
  }

  const saveLogs = async () => {
    setLogsSaving(true)
    try {
      await pb.send('/api/settings', { method: 'PATCH', body: { logs: { maxDays: logsMaxDays, minLevel: logsMinLevel, logIP: logsLogIP, logAuthId: logsLogAuthId } } })
      showToast('Log settings saved')
    } catch (err) {
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally { setLogsSaving(false) }
  }

  const validateSpaceQuota = (): boolean => {
    const errs: Partial<Record<keyof SpaceQuota, string>> = {}
    if (!spaceQuotaForm.maxSizeMB || spaceQuotaForm.maxSizeMB < 1) errs.maxSizeMB = 'Must be ≥ 1'
    if (!spaceQuotaForm.maxPerUser || spaceQuotaForm.maxPerUser < 1) errs.maxPerUser = 'Must be ≥ 1'
    if (!spaceQuotaForm.shareMaxMinutes || spaceQuotaForm.shareMaxMinutes < 1) errs.shareMaxMinutes = 'Must be ≥ 1'
    if (!spaceQuotaForm.shareDefaultMinutes || spaceQuotaForm.shareDefaultMinutes < 1) errs.shareDefaultMinutes = 'Must be ≥ 1'
    if (spaceQuotaForm.shareDefaultMinutes > spaceQuotaForm.shareMaxMinutes) errs.shareDefaultMinutes = 'Cannot exceed max duration'
    setSpaceQuotaErrors(errs)
    return Object.keys(errs).length === 0
  }

  const saveSpaceQuota = async () => {
    if (!validateSpaceQuota()) return
    setSpaceQuotaSaving(true)
    try {
      const res = await pb.send('/api/ext/settings/space', { method: 'PATCH', body: { quota: spaceQuotaForm } }) as { quota: SpaceQuota }
      setSpaceQuotaForm(res.quota ?? spaceQuotaForm)
      showToast('Space quota saved')
    } catch (err: unknown) {
      showToast('Failed: ' + ((err as { message?: string })?.message ?? String(err)), false)
    } finally { setSpaceQuotaSaving(false) }
  }

  const saveProxy = async () => {
    setProxySaving(true)
    try {
      await pb.send('/api/ext/settings/proxy', { method: 'PATCH', body: { network: proxyForm } })
      setProxyNetwork(proxyForm)
      showToast('Proxy settings saved')
    } catch (err) {
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally { setProxySaving(false) }
  }

  const saveDockerMirrors = async () => {
    setMirrorsSaving(true)
    try {
      await pb.send('/api/ext/settings/docker', { method: 'PATCH', body: { mirror: { mirrors: mirrors.filter(Boolean), insecureRegistries: insecureRegs.filter(Boolean) } } })
      showToast('Docker mirror settings saved')
    } catch (err) {
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally { setMirrorsSaving(false) }
  }

  const saveDockerRegistries = async () => {
    setRegsSaving(true)
    try {
      await pb.send('/api/ext/settings/docker', { method: 'PATCH', body: { registries: { items: dockerRegistries } } })
      showToast('Docker registries saved')
    } catch (err) {
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally { setRegsSaving(false) }
  }

  const saveLlm = async () => {
    setLlmSaving(true)
    try {
      await pb.send('/api/ext/settings/llm', { method: 'PATCH', body: { providers: { items: llmItems } } })
      showToast('LLM providers saved')
    } catch (err) {
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally { setLlmSaving(false) }
  }

  // ─── Render helpers ───────────────────────────────────────────────────────

  const selectClass = 'h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring'

  const SaveBtn = ({ onClick, saving, label = 'Save' }: { onClick: () => void; saving: boolean; label?: string }) => (
    <Button onClick={onClick} disabled={saving}>
      {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : label}
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
          <Input id="appName" value={appName} onChange={e => setAppName(e.target.value)} placeholder="AppOS" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="appURL">App URL</Label>
          <Input id="appURL" type="url" value={appURL} onChange={e => setAppURL(e.target.value)} placeholder="https://example.com" />
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
            <Input id="smtpHost" value={smtpHost} onChange={e => setSmtpHost(e.target.value)} placeholder="smtp.example.com" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="smtpPort">Port</Label>
            <Input id="smtpPort" type="number" value={smtpPort} onChange={e => setSmtpPort(Number(e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="smtpUsername">Username</Label>
            <Input id="smtpUsername" value={smtpUsername} onChange={e => setSmtpUsername(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="smtpPassword">Password</Label>
            <Input id="smtpPassword" type="password" value={smtpPassword} onChange={e => setSmtpPassword(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="smtpAuthMethod">Auth Method</Label>
          <select id="smtpAuthMethod" className={selectClass} value={smtpAuthMethod} onChange={e => setSmtpAuthMethod(e.target.value)}>
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
          <Input id="smtpLocalName" value={smtpLocalName} onChange={e => setSmtpLocalName(e.target.value)} placeholder="localhost" />
        </div>
        <div className="flex flex-wrap gap-2">
          <SaveBtn onClick={saveSmtp} saving={smtpSaving} />
          <Input placeholder="recipient@example.com" value={testEmailRecipient} onChange={e => setTestEmailRecipient(e.target.value)} className="w-56" />
          <Button variant="outline" onClick={sendTestEmail} disabled={testEmailSending}>
            {testEmailSending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending…</> : 'Send Test Email'}
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
            <Input id="s3Endpoint" value={s3Endpoint} onChange={e => setS3Endpoint(e.target.value)} placeholder="https://s3.example.com" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="s3AccessKey">Access Key</Label>
            <Input id="s3AccessKey" value={s3AccessKey} onChange={e => setS3AccessKey(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="s3Secret">Secret</Label>
            <Input id="s3Secret" type="password" value={s3Secret} onChange={e => setS3Secret(e.target.value)} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Toggle id="s3ForcePathStyle" checked={s3ForcePathStyle} onChange={setS3ForcePathStyle} />
          <Label htmlFor="s3ForcePathStyle">Force Path Style</Label>
        </div>
        <div className="flex gap-2">
          <SaveBtn onClick={saveS3} saving={s3Saving} />
          <Button variant="outline" onClick={testS3} disabled={s3Testing}>
            {s3Testing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Testing…</> : 'Test Connection'}
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
            <Input id="logsMaxDays" type="number" min={1} value={logsMaxDays} onChange={e => setLogsMaxDays(Number(e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="logsMinLevel">Min Level</Label>
            <select id="logsMinLevel" className={selectClass} value={logsMinLevel} onChange={e => setLogsMinLevel(Number(e.target.value))}>
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
            <Input id="maxSizeMB" type="number" min={1} value={spaceQuotaForm.maxSizeMB}
              onChange={e => setSpaceQuotaForm(f => ({ ...f, maxSizeMB: Number(e.target.value) }))} />
            {spaceQuotaErrors.maxSizeMB && <p className="text-xs text-destructive">{spaceQuotaErrors.maxSizeMB}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="maxPerUser">Max Items per User</Label>
            <Input id="maxPerUser" type="number" min={1} value={spaceQuotaForm.maxPerUser}
              onChange={e => setSpaceQuotaForm(f => ({ ...f, maxPerUser: Number(e.target.value) }))} />
            {spaceQuotaErrors.maxPerUser && <p className="text-xs text-destructive">{spaceQuotaErrors.maxPerUser}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="shareMaxMinutes">Share Max Duration (min)</Label>
            <Input id="shareMaxMinutes" type="number" min={1} value={spaceQuotaForm.shareMaxMinutes}
              onChange={e => setSpaceQuotaForm(f => ({ ...f, shareMaxMinutes: Number(e.target.value) }))} />
            {spaceQuotaErrors.shareMaxMinutes && <p className="text-xs text-destructive">{spaceQuotaErrors.shareMaxMinutes}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="shareDefaultMinutes">Share Default Duration (min)</Label>
            <Input id="shareDefaultMinutes" type="number" min={1} value={spaceQuotaForm.shareDefaultMinutes}
              onChange={e => setSpaceQuotaForm(f => ({ ...f, shareDefaultMinutes: Number(e.target.value) }))} />
            {spaceQuotaErrors.shareDefaultMinutes && <p className="text-xs text-destructive">{spaceQuotaErrors.shareDefaultMinutes}</p>}
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
            <Input id="httpProxy" value={proxyForm.httpProxy} onChange={e => setProxyForm(f => ({ ...f, httpProxy: e.target.value }))} placeholder="http://proxy:3128" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="httpsProxy">HTTPS Proxy</Label>
            <Input id="httpsProxy" value={proxyForm.httpsProxy} onChange={e => setProxyForm(f => ({ ...f, httpsProxy: e.target.value }))} placeholder="http://proxy:3128" />
          </div>
          <div className="col-span-2 space-y-1">
            <Label htmlFor="noProxy">No Proxy</Label>
            <Input id="noProxy" value={proxyForm.noProxy} onChange={e => setProxyForm(f => ({ ...f, noProxy: e.target.value }))} placeholder="localhost,127.0.0.1" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="proxyUsername">Username</Label>
            <Input id="proxyUsername" value={proxyForm.username} onChange={e => setProxyForm(f => ({ ...f, username: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="proxyPassword">Password</Label>
            <Input id="proxyPassword" type="password" value={proxyForm.password}
              onChange={e => setProxyForm(f => ({ ...f, password: e.target.value }))}
              placeholder={proxyNetwork.password ? '***' : ''} />
          </div>
        </div>
        <SaveBtn onClick={saveProxy} saving={proxySaving} />
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
            <Button type="button" variant="outline" size="sm"
              onClick={() => setMirrors(m => [...m, ''])}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add
            </Button>
          </div>
          {mirrors.length === 0 && (
            <p className="text-sm text-muted-foreground">No mirrors configured. Click Add to add one.</p>
          )}
          {mirrors.map((url, i) => (
            <div key={i} className="flex gap-2">
              <Input value={url} onChange={e => setMirrors(m => m.map((v, idx) => idx === i ? e.target.value : v))}
                placeholder="https://mirror.example.com" />
              <Button type="button" variant="ghost" size="icon" onClick={() => setMirrors(m => m.filter((_, idx) => idx !== i))}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>

        {/* Insecure Registries list */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Insecure Registries</Label>
            <Button type="button" variant="outline" size="sm"
              onClick={() => setInsecureRegs(r => [...r, ''])}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add
            </Button>
          </div>
          {insecureRegs.length === 0 && (
            <p className="text-sm text-muted-foreground">No insecure registries configured.</p>
          )}
          {insecureRegs.map((reg, i) => (
            <div key={i} className="flex gap-2">
              <Input value={reg} onChange={e => setInsecureRegs(r => r.map((v, idx) => idx === i ? e.target.value : v))}
                placeholder="my-registry:5000" />
              <Button type="button" variant="ghost" size="icon" onClick={() => setInsecureRegs(r => r.filter((_, idx) => idx !== i))}>
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
          <Button type="button" variant="outline" size="sm"
            onClick={() => setDockerRegistries(r => [...r, { host: '', username: '', password: '' }])}>
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
              <Input value={reg.host}
                onChange={e => setDockerRegistries(r => r.map((item, idx) => idx === i ? { ...item, host: e.target.value } : item))}
                placeholder="registry.example.com" />
            </div>
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Username</Label>
              <Input value={reg.username}
                onChange={e => setDockerRegistries(r => r.map((item, idx) => idx === i ? { ...item, username: e.target.value } : item))} />
            </div>
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Password</Label>
              <Input type="password" value={reg.password}
                onChange={e => setDockerRegistries(r => r.map((item, idx) => idx === i ? { ...item, password: e.target.value } : item))}
                placeholder={reg.password === '***' ? '***' : ''} />
            </div>
            <Button type="button" variant="ghost" size="icon"
              onClick={() => setDockerRegistries(r => r.filter((_, idx) => idx !== i))}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ))}
        <SaveBtn onClick={saveDockerRegistries} saving={regsSaving} />
      </CardContent>
    </Card>
  )

  const renderLlm = () => {
    const vendorEndpoint = (label: string) => LLM_VENDORS.find(v => v.label === label)?.endpoint ?? ''

    return (
      <Card>
        <CardHeader>
          <CardTitle>LLM Providers</CardTitle>
          <CardDescription>AI model provider endpoints and credentials</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm"
              onClick={() => setLlmItems(p => [...p, { name: 'OpenAI', endpoint: 'https://api.openai.com/v1', apiKey: '' }])}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Provider
            </Button>
          </div>
          {llmItems.length === 0 && (
            <p className="text-sm text-muted-foreground">No providers configured. Click Add Provider to get started.</p>
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
                        setLlmItems(p => p.map((item, idx) => idx === i
                          ? { ...item, name: e.target.value, endpoint: ep }
                          : item))
                      }}
                    >
                      {LLM_VENDORS.map(v => <option key={v.label} value={v.label}>{v.label}</option>)}
                    </select>
                  </div>
                  <Button type="button" variant="ghost" size="icon"
                    onClick={() => setLlmItems(p => p.filter((_, idx) => idx !== i))}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Endpoint URL</Label>
                  <Input value={prov.endpoint}
                    onChange={e => setLlmItems(p => p.map((item, idx) => idx === i ? { ...item, endpoint: e.target.value } : item))}
                    placeholder="https://api.example.com/v1" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">API Key</Label>
                  <Input type="password" value={prov.apiKey}
                    onChange={e => setLlmItems(p => p.map((item, idx) => idx === i ? { ...item, apiKey: e.target.value } : item))}
                    placeholder={prov.apiKey === '***' ? '***' : 'sk-...'} />
                </div>
              </div>
            )
          })}
          <SaveBtn onClick={saveLlm} saving={llmSaving} />
        </CardContent>
      </Card>
    )
  }

  const renderSection = () => {
    switch (activeSection) {
      case 'basic':             return renderBasic()
      case 'smtp':              return renderSmtp()
      case 's3':                return renderS3()
      case 'logs':              return renderLogs()
      case 'space':             return renderSpace()
      case 'proxy':             return renderProxy()
      case 'docker-mirrors':    return renderDockerMirrors()
      case 'docker-registries': return renderDockerRegistries()
      case 'llm':               return renderLlm()
    }
  }

  // ─── Main layout ──────────────────────────────────────────────────────────

  const groups = [...new Set(NAV_ITEMS.map(n => n.group))]

  return (
    <div className="p-6">
      {/* Toast stack */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} className={`px-4 py-2 rounded-md shadow text-sm text-white ${t.ok ? 'bg-green-600' : 'bg-red-600'}`}>{t.msg}</div>
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
                <p className="px-3 mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{group}</p>
                <div className="space-y-0.5">
                  {NAV_ITEMS.filter(n => n.group === group).map(item => (
                    <button
                      key={item.id}
                      onClick={() => setActiveSection(item.id)}
                      className={`w-full text-left px-3 py-2 text-sm rounded-md transition-colors ${
                        activeSection === item.id
                          ? 'bg-accent text-accent-foreground font-medium'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>

          {/* Right content */}
          <div className="flex-1 min-w-0">
            {renderSection()}
          </div>
        </div>
      )}
    </div>
  )
}

export const Route = createFileRoute('/_app/_auth/_superuser/settings')({
  component: SettingsPage,
})

