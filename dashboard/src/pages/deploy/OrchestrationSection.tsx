import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  CircleHelp,
  Eraser,
  FolderUp,
  Link2,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useYamlValidation } from '@/hooks/useYamlValidation'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { iacLoadLibraryAppFiles } from '@/lib/iac-api'
import { pb } from '@/lib/pb'

const SENSITIVE_METHODS = [
  { id: 'password_16', label: 'Password (16)' },
  { id: 'password_32', label: 'Password (32)' },
  { id: 'hex_32', label: 'Hex (32)' },
  { id: 'base64', label: 'Base64' },
  { id: 'uuid', label: 'UUID' },
] as const

function generateSensitive(method: string): string {
  const buf = new Uint8Array(32)
  crypto.getRandomValues(buf)
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&*'
  switch (method) {
    case 'password_16':
      return Array.from(buf.slice(0, 16), b => chars[b % chars.length]).join('')
    case 'password_32':
      return Array.from(buf.slice(0, 32), b => chars[b % chars.length]).join('')
    case 'hex_32':
      return Array.from(buf.slice(0, 16), b => b.toString(16).padStart(2, '0')).join('')
    case 'base64':
      return btoa(String.fromCharCode(...buf.slice(0, 24))).replace(/=+$/, '')
    case 'uuid': {
      const h = Array.from(buf.slice(0, 16), b => b.toString(16).padStart(2, '0')).join('')
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`
    }
    default:
      return ''
  }
}

const SAMPLE_COMPOSE = `services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"
`

/** Parse a .env file into key-value pairs. */
function parseEnvFile(text: string): Array<{ key: string; value: string }> {
  const result: Array<{ key: string; value: string }> = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eqIndex = line.indexOf('=')
    if (eqIndex < 1) continue
    result.push({ key: line.slice(0, eqIndex).trim(), value: line.slice(eqIndex + 1).trim() })
  }
  return result
}

type StoreProduct = {
  key: string
  trademark: string
  logo?: { imageurl?: string }
}

export type OrchestrationSectionProps = {
  compose: string
  setCompose: (v: string) => void
  envVars: Array<{ key: string; value: string }>
  setEnvVars: React.Dispatch<React.SetStateAction<Array<{ key: string; value: string }>>>
  projectName: string
  setProjectName: (v: string) => void
  storeProducts: StoreProduct[]
  srcFiles: File[]
  setSrcFiles: React.Dispatch<React.SetStateAction<File[]>>
  srcUploaded: string[]
  /** Reports the current YAML syntax error string to the parent (null = no error). */
  onYamlError?: (error: string | null) => void
}

export function OrchestrationSection({
  compose,
  setCompose,
  envVars,
  setEnvVars,
  projectName,
  setProjectName,
  storeProducts,
  srcFiles,
  setSrcFiles,
  srcUploaded,
  onYamlError,
}: OrchestrationSectionProps) {
  const srcRelativePath = './src/'
  const templateMenuRef = useRef<HTMLDivElement>(null)

  // ── YAML validation ──
  const yamlValidation = useYamlValidation(compose)
  const yamlError = yamlValidation?.valid === false ? yamlValidation : null
  useEffect(() => {
    onYamlError?.(yamlError ? yamlError.message : null)
  }, [yamlError, onYamlError])

  // ── Compose file upload ──
  const composeFileRef = useRef<HTMLInputElement>(null)
  const handleComposeFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => { if (typeof reader.result === 'string') setCompose(reader.result) }
    reader.readAsText(file)
    event.target.value = ''
  }, [setCompose])

  // ── Template import ──
  const [templateLoading, setTemplateLoading] = useState(false)
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false)
  const importTemplate = useCallback(async (appKey: string, appName: string) => {
    setTemplateLoading(true)
    try {
      const { compose: tplCompose, env: tplEnv } = await iacLoadLibraryAppFiles(appKey)
      if (tplCompose) setCompose(tplCompose)
      if (tplEnv) {
        const parsed = parseEnvFile(tplEnv)
        if (parsed.length > 0) setEnvVars(prev => [...prev.filter(e => e.key.trim()), ...parsed, { key: '', value: '' }])
      }
      if (!projectName.trim()) setProjectName(appName || appKey)
    } catch {
      // silently skip — template unavailable
    } finally {
      setTemplateLoading(false)
      setTemplateMenuOpen(false)
    }
  }, [projectName, setCompose, setEnvVars, setProjectName])

  // ── Env file upload ──
  const envFileRef = useRef<HTMLInputElement>(null)
  const handleEnvFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') return
      const parsed = parseEnvFile(reader.result)
      if (parsed.length > 0) setEnvVars(prev => [...prev.filter(e => e.key.trim()), ...parsed, { key: '', value: '' }])
    }
    reader.readAsText(file)
    event.target.value = ''
  }, [setEnvVars])

  // ── Mount file helpers ──
  const srcFileRef = useRef<HTMLInputElement>(null)
  const handleSrcFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files) return
    setSrcFiles(prev => [...prev, ...Array.from(files)])
    event.target.value = ''
  }, [setSrcFiles])
  const removeSrcFile = useCallback((index: number) => {
    setSrcFiles(prev => prev.filter((_, i) => i !== index))
  }, [setSrcFiles])

  // ── Env var helpers ──
  const updateEnvVar = useCallback((index: number, field: 'key' | 'value', val: string) => {
    setEnvVars(prev => prev.map((item, i) => i === index ? { ...item, [field]: val } : item))
  }, [setEnvVars])
  const removeEnvVar = useCallback((index: number) => {
    setEnvVars(prev => {
      const next = prev.filter((_, i) => i !== index)
      return next.length === 0 ? [{ key: '', value: '' }] : next
    })
  }, [setEnvVars])
  const addEnvVar = useCallback(() => {
    setEnvVars(prev => [...prev, { key: '', value: '' }])
  }, [setEnvVars])

  // ── Template search ──
  const [templateSearch, setTemplateSearch] = useState('')
  const filteredProducts = useMemo(() => {
    const q = templateSearch.trim().toLowerCase()
    const filtered = q
      ? storeProducts.filter(p => p.trademark.toLowerCase().includes(q) || p.key.toLowerCase().includes(q))
      : storeProducts

    return [...filtered].sort((left, right) => {
      const leftLabel = (left.trademark || left.key).toLowerCase()
      const rightLabel = (right.trademark || right.key).toLowerCase()
      return leftLabel.localeCompare(rightLabel)
    })
  }, [storeProducts, templateSearch])

  useEffect(() => {
    if (!templateMenuOpen) return

    function handlePointerDown(event: MouseEvent) {
      if (!templateMenuRef.current?.contains(event.target as Node)) {
        setTemplateMenuOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setTemplateMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [templateMenuOpen])

  // ── Env mode: sensitive auto-generation / shared env mapping ──
  const [envModes, setEnvModes] = useState<Record<number, 'sensitive' | 'shared'>>({})
  const [sensitiveMethods, setSensitiveMethods] = useState<Record<number, string>>({})
  const [sharedSets, setSharedSets] = useState<Array<{ id: string; name: string }>>([])
  const [sharedVars, setSharedVars] = useState<Array<{ id: string; set: string; key: string; value: string }>>([])
  const [sharedLoaded, setSharedLoaded] = useState(false)

  const loadSharedEnvs = useCallback(async () => {
    if (sharedLoaded) return
    try {
      const sets = await pb.collection('env_sets').getFullList({ sort: 'name' })
      const vars = await pb.collection('env_set_vars').getFullList({ sort: 'key' })
      setSharedSets(sets.map(s => ({ id: s.id, name: s['name'] as string })))
      setSharedVars(vars.map(v => ({ id: v.id, set: v['set'] as string, key: v['key'] as string, value: v['value'] as string })))
    } catch { /* ignore */ }
    setSharedLoaded(true)
  }, [sharedLoaded])

  const toggleEnvMode = useCallback((index: number, mode: 'sensitive' | 'shared') => {
    setEnvModes(prev => {
      if (prev[index] === mode) {
        const next = { ...prev }
        delete next[index]
        return next
      }
      return { ...prev, [index]: mode }
    })
    if (mode === 'shared') void loadSharedEnvs()
  }, [loadSharedEnvs])

  const handleSensitiveMethod = useCallback((index: number, method: string) => {
    setSensitiveMethods(prev => ({ ...prev, [index]: method }))
    updateEnvVar(index, 'value', generateSensitive(method))
  }, [updateEnvVar])

  const regenerateSensitive = useCallback((index: number) => {
    const method = sensitiveMethods[index]
    if (method) updateEnvVar(index, 'value', generateSensitive(method))
  }, [sensitiveMethods, updateEnvVar])

  const handleSharedVarSelect = useCallback((index: number, varId: string) => {
    if (varId.startsWith('current:')) {
      const refVar = envVars.find(e => e.key === varId.slice(8))
      if (refVar) updateEnvVar(index, 'value', refVar.value)
    } else {
      const sv = sharedVars.find(v => v.id === varId)
      if (sv) {
        if (!envVars[index]?.key.trim()) updateEnvVar(index, 'key', sv.key)
        updateEnvVar(index, 'value', sv.value)
      }
    }
  }, [envVars, sharedVars, updateEnvVar])

  const removeEnvVarClean = useCallback((index: number) => {
    removeEnvVar(index)
    setEnvModes(prev => {
      const next: typeof prev = {}
      for (const [k, v] of Object.entries(prev)) {
        const idx = Number(k)
        if (idx < index) next[idx] = v
        else if (idx > index) next[idx - 1] = v
      }
      return next
    })
    setSensitiveMethods(prev => {
      const next: typeof prev = {}
      for (const [k, v] of Object.entries(prev)) {
        const idx = Number(k)
        if (idx < index) next[idx] = v
        else if (idx > index) next[idx - 1] = v
      }
      return next
    })
  }, [removeEnvVar])

  const envCount = envVars.filter(e => e.key.trim()).length

  return (
    <section className="rounded-lg border bg-card px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-base font-semibold">Orchestration</span>
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <CircleHelp className="ml-0.5 inline h-3.5 w-3.5 cursor-help text-muted-foreground/60 hover:text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">Define the service stack: compose file, environment variables, and mount files.</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="text-xs text-muted-foreground">Compose, environment variables, and mount files</div>
      </div>
      <div className="space-y-3 pt-4">
        {/* ── Sub-area 1: Compose File (collapsed by default) ── */}
        <details className="group pl-2">
          <summary className="flex cursor-pointer items-center gap-2 py-2">
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-0 [-webkit-details-marker]:hidden [&:not([open]_&)]:rotate-[-90deg]" />
            <span className="text-[13px] font-medium">Compose File</span>
            {compose.trim() && !yamlError ? <span className="ml-auto text-xs text-muted-foreground">{compose.split('\n').length} lines</span> : null}
            {yamlError ? <span className="ml-auto text-xs text-destructive">YAML syntax error</span> : null}
          </summary>
          <div className="pl-5 pt-2">
            <div className={`max-h-[420px] overflow-y-auto rounded-md border${yamlError ? ' border-destructive/60' : ''}`}>
              <Textarea
                id="compose-content"
                className="min-h-[280px] resize-none border-0 font-mono text-xs focus-visible:ring-0"
                value={compose}
                onChange={e => setCompose(e.target.value)}
                placeholder="services:&#10;  web:&#10;    image: nginx:alpine&#10;    ports:&#10;      - '8080:80'"
                aria-invalid={yamlError ? true : undefined}
                aria-describedby={yamlError ? 'compose-yaml-error' : undefined}
              />
            </div>
            {yamlError ? (
              <div id="compose-yaml-error" role="alert" className="mt-1.5 flex items-start gap-1.5 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {yamlError.line !== undefined ? `Line ${yamlError.line}: ` : ''}{yamlError.message}
                </span>
              </div>
            ) : null}
            <div className="mt-3 flex items-center gap-2">
              <input ref={composeFileRef} type="file" accept=".yml,.yaml" className="hidden" onChange={handleComposeFileUpload} />
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => composeFileRef.current?.click()}>
                <Upload className="mr-1 h-3 w-3" />Upload YAML
              </Button>
              {storeProducts.length > 0 ? (
                <div className="relative" ref={templateMenuRef}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setTemplateMenuOpen(open => !open)}
                    aria-expanded={templateMenuOpen}
                    aria-haspopup="menu"
                  >
                    Import from App Store
                  </Button>
                  {templateMenuOpen ? (
                    <div className="absolute left-0 z-20 mt-1 w-64 rounded-md border bg-popover shadow-md" role="menu">
                      <div className="flex items-center gap-2 border-b px-2 py-1.5">
                        <Search className="h-3.5 w-3.5 text-muted-foreground" />
                        <input
                          type="text"
                          className="h-7 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                          placeholder="Search apps…"
                          value={templateSearch}
                          onChange={e => setTemplateSearch(e.target.value)}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => setTemplateMenuOpen(false)}
                          aria-label="Close import menu"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="max-h-64 overflow-y-auto p-1">
                        {filteredProducts.map(p => (
                          <button
                            key={p.key}
                            type="button"
                            disabled={templateLoading}
                            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-50"
                            onClick={() => void importTemplate(p.key, p.trademark)}
                          >
                            {p.logo?.imageurl ? <img src={p.logo.imageurl} alt="" className="h-4 w-4 rounded" /> : null}
                            <span className="truncate">{p.trademark}</span>
                          </button>
                        ))}
                        {filteredProducts.length === 0 ? (
                          <div className="px-2 py-3 text-center text-xs text-muted-foreground">No matching apps</div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setCompose(SAMPLE_COMPOSE)}>
                Use sample
              </Button>
              <div className="ml-auto">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => setCompose('')}
                  disabled={!compose.trim()}
                  title="Clear compose content"
                >
                  <Eraser className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </details>

        {/* ── Sub-area 2: Environment Variables (collapsed by default) ── */}
        <details className="group pl-2">
          <summary className="flex cursor-pointer items-center gap-2 py-2">
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-0 [-webkit-details-marker]:hidden [&:not([open]_&)]:rotate-[-90deg]" />
            <span className="text-[13px] font-medium">Environment Variables & Secret-backed</span>
            {envCount > 0 ? <span className="ml-auto text-xs text-muted-foreground">{envCount} defined</span> : null}
          </summary>
          <div className="pl-5 pt-2">
            <div className="max-h-[400px] space-y-1.5 overflow-y-auto">
              {envVars.map((env, i) => {
                const mode = envModes[i]
                return (
                  <div key={i} className="flex items-center gap-1.5">
                    <Input className="h-8 w-[38%] shrink-0 font-mono text-xs" placeholder="KEY" value={env.key} onChange={e => updateEnvVar(i, 'key', e.target.value)} />
                    {mode === 'sensitive' ? (
                      <div className="flex flex-1 items-center gap-1">
                        <select
                          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                          value={sensitiveMethods[i] || ''}
                          onChange={e => handleSensitiveMethod(i, e.target.value)}
                        >
                          <option value="" disabled>Generate…</option>
                          {SENSITIVE_METHODS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                        </select>
                        <Input className="h-8 flex-1 bg-muted/30 font-mono text-xs" readOnly value={env.value} placeholder="Select method" />
                        <Button variant="ghost" size="sm" className="h-7 w-7 shrink-0 p-0" onClick={() => regenerateSensitive(i)} disabled={!sensitiveMethods[i]} title="Regenerate">
                          <RefreshCw className="h-3 w-3 text-muted-foreground" />
                        </Button>
                      </div>
                    ) : mode === 'shared' ? (
                      <select
                        className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs"
                        value=""
                        onChange={e => handleSharedVarSelect(i, e.target.value)}
                      >
                        <option value="" disabled>Select variable…</option>
                        {sharedSets.map(set => {
                          const setVars = sharedVars.filter(v => v.set === set.id)
                          return setVars.length > 0 ? (
                            <optgroup key={set.id} label={set.name}>
                              {setVars.map(v => <option key={v.id} value={v.id}>{v.key}</option>)}
                            </optgroup>
                          ) : null
                        })}
                        {envVars.filter((e, idx) => idx !== i && e.key.trim()).length > 0 ? (
                          <optgroup label="Current Variables">
                            {envVars.filter((e, idx) => idx !== i && e.key.trim()).map(e => (
                              <option key={`cur-${e.key}`} value={`current:${e.key}`}>{e.key}</option>
                            ))}
                          </optgroup>
                        ) : null}
                      </select>
                    ) : (
                      <Input className="h-8 flex-1 font-mono text-xs" placeholder="value" value={env.value} onChange={e => updateEnvVar(i, 'value', e.target.value)} />
                    )}
                    <Button variant={mode === 'sensitive' ? 'secondary' : 'ghost'} size="sm" className="h-7 w-7 shrink-0 p-0" onClick={() => toggleEnvMode(i, 'sensitive')} title="Auto-generate sensitive value">
                      <Shield className="h-3 w-3" />
                    </Button>
                    <Button variant={mode === 'shared' ? 'secondary' : 'ghost'} size="sm" className="h-7 w-7 shrink-0 p-0" onClick={() => toggleEnvMode(i, 'shared')} title="Map from shared env">
                      <Link2 className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 shrink-0 p-0" onClick={() => removeEnvVarClean(i)}>
                      <Trash2 className="h-3 w-3 text-muted-foreground" />
                    </Button>
                  </div>
                )
              })}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={addEnvVar}>
                <Plus className="mr-1 h-3 w-3" />Add Variable
              </Button>
              <input ref={envFileRef} type="file" accept=".env,.txt" className="hidden" onChange={handleEnvFileUpload} />
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => envFileRef.current?.click()}>
                <Upload className="mr-1 h-3 w-3" />Upload .env
              </Button>
            </div>
          </div>
        </details>

        {/* ── Sub-area 3: Mount Files (collapsed by default) ── */}
        <details className="group pl-2">
          <summary className="flex cursor-pointer items-center gap-2 py-2">
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-0 [-webkit-details-marker]:hidden [&:not([open]_&)]:rotate-[-90deg]" />
            <span className="text-[13px] font-medium">Mount Files</span>
            {srcFiles.length + srcUploaded.length > 0 ? <span className="ml-auto text-xs text-muted-foreground">{srcFiles.length + srcUploaded.length} file(s)</span> : null}
          </summary>
          <div className="pl-5 pt-2">
            <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
              Volume mount path: <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">{srcRelativePath}&lt;upload_file&gt;</code>
            </div>
            {srcFiles.length > 0 || srcUploaded.length > 0 ? (
              <div className="mt-2 space-y-1">
                {srcUploaded.map(name => (
                  <div key={name} className="flex items-center gap-2 rounded px-2 py-1 text-xs text-muted-foreground">
                    <span className="text-emerald-600">✓</span> {srcRelativePath}{name}
                  </div>
                ))}
                {srcFiles.map((file, i) => (
                  <div key={`${file.name}-${i}`} className="flex items-center justify-between rounded px-2 py-1 text-xs hover:bg-muted/50">
                    <span className="truncate font-mono">{srcRelativePath}{file.name} <span className="font-sans text-muted-foreground">({(file.size / 1024).toFixed(1)} KB)</span></span>
                    <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => removeSrcFile(i)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="mt-3">
              <input ref={srcFileRef} type="file" multiple className="hidden" onChange={handleSrcFileSelect} />
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => srcFileRef.current?.click()}>
                <FolderUp className="mr-1 h-3 w-3" />Add Files
              </Button>
            </div>
          </div>
        </details>
      </div>
    </section>
  )
}
