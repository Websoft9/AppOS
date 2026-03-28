import type { FormEvent } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SaveButton, selectClass } from './shared'
import { LLM_VENDORS, type LLMProviderItem, type RegistryItem } from './types'

export function DockerMirrorsSection({
  mirrors,
  insecureRegs,
  mirrorsSaving,
  setMirrors,
  setInsecureRegs,
  saveDockerMirrors,
}: {
  mirrors: string[]
  insecureRegs: string[]
  mirrorsSaving: boolean
  setMirrors: React.Dispatch<React.SetStateAction<string[]>>
  setInsecureRegs: React.Dispatch<React.SetStateAction<string[]>>
  saveDockerMirrors: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Docker Mirrors</CardTitle>
        <CardDescription>Registry mirror URLs and insecure registries</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Registry Mirrors</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setMirrors(m => [...m, ''])}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Add
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

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Insecure Registries</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setInsecureRegs(r => [...r, ''])}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Add
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

        <SaveButton onClick={saveDockerMirrors} saving={mirrorsSaving} />
      </CardContent>
    </Card>
  )
}

export function DockerRegistriesSection({
  dockerRegistries,
  regsSaving,
  setDockerRegistries,
  saveDockerRegistries,
}: {
  dockerRegistries: RegistryItem[]
  regsSaving: boolean
  setDockerRegistries: React.Dispatch<React.SetStateAction<RegistryItem[]>>
  saveDockerRegistries: () => void
}) {
  return (
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
            <Plus className="mr-1 h-3.5 w-3.5" /> Add Registry
          </Button>
        </div>
        {dockerRegistries.length === 0 && (
          <p className="text-sm text-muted-foreground">No private registries configured.</p>
        )}
        {dockerRegistries.map((reg, i) => (
          <div key={i} className="flex items-end gap-2">
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
        <SaveButton onClick={saveDockerRegistries} saving={regsSaving} />
      </CardContent>
    </Card>
  )
}

export function LlmSection({
  llmItems,
  llmSaving,
  secretPickerItems,
  llmSecretCreateOpen,
  llmSecretCreateName,
  llmSecretCreateKey,
  llmSecretCreateSaving,
  llmSecretCreateError,
  setLlmItems,
  setLlmSecretCreateOpen,
  setLlmSecretCreateIdx,
  setLlmSecretCreateName,
  setLlmSecretCreateKey,
  setLlmSecretCreateError,
  handleLlmSecretCreate,
  saveLlm,
}: {
  llmItems: LLMProviderItem[]
  llmSaving: boolean
  secretPickerItems: { id: string; name: string }[]
  llmSecretCreateOpen: boolean
  llmSecretCreateName: string
  llmSecretCreateKey: string
  llmSecretCreateSaving: boolean
  llmSecretCreateError: string
  setLlmItems: React.Dispatch<React.SetStateAction<LLMProviderItem[]>>
  setLlmSecretCreateOpen: (value: boolean) => void
  setLlmSecretCreateIdx: (value: number) => void
  setLlmSecretCreateName: (value: string) => void
  setLlmSecretCreateKey: (value: string) => void
  setLlmSecretCreateError: (value: string) => void
  handleLlmSecretCreate: (e: FormEvent) => Promise<void>
  saveLlm: () => void
}) {
  const vendorEndpoint = (label: string) => LLM_VENDORS.find(v => v.label === label)?.endpoint ?? ''

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
              <Plus className="mr-1 h-3.5 w-3.5" /> Add Provider
            </Button>
          </div>
          {llmItems.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No providers configured. Click Add Provider to get started.
            </p>
          )}
          {llmItems.map((prov, i) => {
            const vendorLabel = LLM_VENDORS.find(v => v.label === prov.name)?.label ?? 'Custom'
            return (
              <div key={i} className="space-y-3 rounded-md border p-4">
                <div className="flex items-center justify-between">
                  <div className="w-48 space-y-1">
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
                  <div className="flex items-center gap-2">
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
          <SaveButton onClick={saveLlm} saving={llmSaving} />
        </CardContent>
      </Card>

      <Dialog open={llmSecretCreateOpen} onOpenChange={setLlmSecretCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create API Key Secret</DialogTitle>
            <DialogDescription>Create a new secret and select it automatically.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleLlmSecretCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">
                Name<span className="ml-1 text-destructive">*</span>
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
                API Key<span className="ml-1 text-destructive">*</span>
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
              <p className="text-sm text-destructive">{llmSecretCreateError}</p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setLlmSecretCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={llmSecretCreateSaving}>
                {llmSecretCreateSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
