import { Loader2 } from 'lucide-react'
import { type SettingsSchemaEntry } from '@/lib/settings-api'
import type { SecretPolicy } from '@/lib/secrets-policy'
import { SECRET_ACCESS_MODE_OPTIONS } from '@/lib/secrets-policy'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SaveButton, Toggle, selectClass } from './shared'
import type {
  ConnectSftpGroup,
  ConnectTerminalGroup,
  DeployPreflightGroup,
  IacFilesGroup,
  ProxyNetwork,
  SecretPolicyErrors,
  SpaceQuota,
  TunnelPortRange,
} from './types'

type SchemaNumberFieldOptions = {
  inputId: string
  min?: number
  max?: number
  step?: number
  helpText?: string
}

type SchemaTextFieldOptions = {
  inputId: string
  placeholder?: string
  helpText?: string
}

function renderSchemaNumberFields<T extends object, K extends keyof T & string>({
  entry,
  form,
  errors,
  setForm,
  fieldOptions,
}: {
  entry: SettingsSchemaEntry
  form: T
  errors: Partial<Record<K, string>>
  setForm: React.Dispatch<React.SetStateAction<T>>
  fieldOptions: Partial<Record<K, SchemaNumberFieldOptions>>
}) {
  return entry.fields.map(field => {
    const fieldKey = field.id as K
    const options = fieldOptions[fieldKey]
    if (!options) {
      return null
    }

    const error = errors[fieldKey]
    const value = form[fieldKey] as number

    return (
      <div key={field.id} className="space-y-1">
        <Label htmlFor={options.inputId}>{field.label}</Label>
        <Input
          id={options.inputId}
          type="number"
          min={options.min}
          max={options.max}
          step={options.step ?? 1}
          value={value}
          onChange={event =>
            setForm(
              current =>
                ({
                  ...current,
                  [fieldKey]: Number(event.target.value),
                }) as T
            )
          }
        />
        {(field.helpText || options.helpText) && (
          <p className="text-xs text-muted-foreground">{field.helpText ?? options.helpText}</p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    )
  })
}

function renderSchemaTextFields<T extends object, K extends keyof T & string>({
  entry,
  form,
  errors,
  setForm,
  fieldOptions,
}: {
  entry: SettingsSchemaEntry
  form: T
  errors: Partial<Record<K, string>>
  setForm: React.Dispatch<React.SetStateAction<T>>
  fieldOptions: Partial<Record<K, SchemaTextFieldOptions>>
}) {
  return entry.fields.map(field => {
    const fieldKey = field.id as K
    const options = fieldOptions[fieldKey]
    if (!options) {
      return null
    }

    const error = errors[fieldKey]
    const value = form[fieldKey] as string

    return (
      <div key={field.id} className="space-y-1">
        <Label htmlFor={options.inputId}>{field.label}</Label>
        <Input
          id={options.inputId}
          value={value}
          placeholder={options.placeholder}
          onChange={event =>
            setForm(
              current =>
                ({
                  ...current,
                  [fieldKey]: event.target.value,
                }) as T
            )
          }
        />
        {(field.helpText || options.helpText) && (
          <p className="text-xs text-muted-foreground">{field.helpText ?? options.helpText}</p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    )
  })
}

export function SpaceQuotaSection({
  form,
  errors,
  allowExtsText,
  denyExtsText,
  disallowedFolderNamesText,
  saving,
  parseExtListInput,
  setForm,
  setAllowExtsText,
  setDenyExtsText,
  setDisallowedFolderNamesText,
  save,
}: {
  form: SpaceQuota
  errors: Partial<Record<keyof SpaceQuota, string>>
  allowExtsText: string
  denyExtsText: string
  disallowedFolderNamesText: string
  saving: boolean
  parseExtListInput: (value: string) => string[]
  setForm: React.Dispatch<React.SetStateAction<SpaceQuota>>
  setAllowExtsText: (value: string) => void
  setDenyExtsText: (value: string) => void
  setDisallowedFolderNamesText: (value: string) => void
  save: () => void
}) {
  return (
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
              value={form.maxSizeMB}
              onChange={e => setForm(f => ({ ...f, maxSizeMB: Number(e.target.value) }))}
            />
            {errors.maxSizeMB && <p className="text-xs text-destructive">{errors.maxSizeMB}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="maxPerUser">Max Items per User</Label>
            <Input
              id="maxPerUser"
              type="number"
              min={1}
              value={form.maxPerUser}
              onChange={e => setForm(f => ({ ...f, maxPerUser: Number(e.target.value) }))}
            />
            {errors.maxPerUser && <p className="text-xs text-destructive">{errors.maxPerUser}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="maxUploadFiles">Max Files per Upload</Label>
            <Input
              id="maxUploadFiles"
              type="number"
              min={1}
              max={200}
              value={form.maxUploadFiles}
              onChange={e => setForm(f => ({ ...f, maxUploadFiles: Number(e.target.value) }))}
            />
            {errors.maxUploadFiles && (
              <p className="text-xs text-destructive">{errors.maxUploadFiles}</p>
            )}
          </div>
          <div className="col-span-2 grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="shareDefaultMinutes">Share Default Duration (min)</Label>
              <Input
                id="shareDefaultMinutes"
                type="number"
                min={1}
                value={form.shareDefaultMinutes}
                onChange={e =>
                  setForm(f => ({ ...f, shareDefaultMinutes: Number(e.target.value) }))
                }
              />
              {errors.shareDefaultMinutes && (
                <p className="text-xs text-destructive">{errors.shareDefaultMinutes}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="shareMaxMinutes">Share Max Duration (min)</Label>
              <Input
                id="shareMaxMinutes"
                type="number"
                min={1}
                value={form.shareMaxMinutes}
                onChange={e => setForm(f => ({ ...f, shareMaxMinutes: Number(e.target.value) }))}
              />
              {errors.shareMaxMinutes && (
                <p className="text-xs text-destructive">{errors.shareMaxMinutes}</p>
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
                setForm(f => ({ ...f, uploadAllowExts: parsed }))
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
                setForm(f => ({ ...f, uploadDenyExts: parsed }))
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
        <SaveButton onClick={save} saving={saving} />
      </CardContent>
    </Card>
  )
}

export function ProxySection({
  proxyNetwork,
  proxyForm,
  proxySaving,
  setProxyForm,
  saveProxy,
}: {
  proxyNetwork: ProxyNetwork
  proxyForm: ProxyNetwork
  proxySaving: boolean
  setProxyForm: React.Dispatch<React.SetStateAction<ProxyNetwork>>
  saveProxy: () => void
}) {
  return (
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
        <SaveButton onClick={saveProxy} saving={proxySaving} />
      </CardContent>
    </Card>
  )
}

export function ConnectTerminalSection({
  entry,
  form,
  errors,
  saving,
  setForm,
  save,
}: {
  entry: SettingsSchemaEntry
  form: ConnectTerminalGroup
  errors: Partial<Record<keyof ConnectTerminalGroup, string>>
  saving: boolean
  setForm: React.Dispatch<React.SetStateAction<ConnectTerminalGroup>>
  save: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{entry.title}</CardTitle>
        <CardDescription>Connection policy for Connect terminal sessions</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {renderSchemaNumberFields({
            entry,
            form,
            errors,
            setForm,
            fieldOptions: {
              idleTimeoutSeconds: {
                inputId: 'connectIdleTimeout',
                min: 60,
              },
              maxConnections: {
                inputId: 'connectMaxConnections',
                min: 0,
              },
            },
          })}
        </div>
        <SaveButton onClick={save} saving={saving} />
      </CardContent>
    </Card>
  )
}

export function ConnectSftpSection({
  entry,
  form,
  errors,
  saving,
  setForm,
  save,
}: {
  entry: SettingsSchemaEntry
  form: ConnectSftpGroup
  errors: Partial<Record<keyof ConnectSftpGroup, string>>
  saving: boolean
  setForm: React.Dispatch<React.SetStateAction<ConnectSftpGroup>>
  save: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{entry.title}</CardTitle>
        <CardDescription>File upload limits for SFTP connections</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {renderSchemaNumberFields({
          entry,
          form,
          errors,
          setForm,
          fieldOptions: {
            maxUploadFiles: {
              inputId: 'sftpMaxUploadFiles',
              min: 1,
            },
          },
        })}
        <SaveButton onClick={save} saving={saving} />
      </CardContent>
    </Card>
  )
}

export function DeployPreflightSection({
  entry,
  form,
  errors,
  saving,
  setForm,
  save,
}: {
  entry: SettingsSchemaEntry
  form: DeployPreflightGroup
  errors: Partial<Record<keyof DeployPreflightGroup, string>>
  saving: boolean
  setForm: React.Dispatch<React.SetStateAction<DeployPreflightGroup>>
  save: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{entry.title}</CardTitle>
        <CardDescription>Disk-capacity guardrails used during install preflight</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {renderSchemaNumberFields({
            entry,
            form,
            errors,
            setForm,
            fieldOptions: {
              minFreeDiskBytes: {
                inputId: 'deployMinFreeDiskBytes',
                min: 0,
                helpText: 'Default is 536870912 bytes (0.5 GiB).',
              },
            },
          })}
        </div>
        <SaveButton onClick={save} saving={saving} />
      </CardContent>
    </Card>
  )
}

export function IacFilesSection({
  entry,
  form,
  errors,
  saving,
  setForm,
  save,
}: {
  entry: SettingsSchemaEntry
  form: IacFilesGroup
  errors: Partial<Record<keyof IacFilesGroup, string>>
  saving: boolean
  setForm: React.Dispatch<React.SetStateAction<IacFilesGroup>>
  save: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{entry.title}</CardTitle>
        <CardDescription>
          Limits for IaC file reading and uploads in the workspace browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4">
          {renderSchemaNumberFields({
            entry,
            form,
            errors,
            setForm,
            fieldOptions: {
              maxSizeMB: {
                inputId: 'iac-max-size-mb',
                min: 1,
              },
              maxZipSizeMB: {
                inputId: 'iac-max-zip-size-mb',
                min: 1,
              },
            },
          })}
          {renderSchemaTextFields({
            entry,
            form,
            errors,
            setForm,
            fieldOptions: {
              extensionBlacklist: {
                inputId: 'iac-extension-blacklist',
                placeholder: '.exe,.dll,.so',
              },
            },
          })}
        </div>

        <div className="flex justify-end">
          <Button onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function TunnelSection({
  entry,
  form,
  errors,
  saving,
  setForm,
  save,
}: {
  entry: SettingsSchemaEntry
  form: TunnelPortRange
  errors: Partial<Record<keyof TunnelPortRange, string>>
  saving: boolean
  setForm: React.Dispatch<React.SetStateAction<TunnelPortRange>>
  save: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{entry.title}</CardTitle>
        <CardDescription>Port pool range for reverse tunnel allocation</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {renderSchemaNumberFields({
            entry,
            form,
            errors,
            setForm,
            fieldOptions: {
              start: {
                inputId: 'tunnelPortRangeStart',
                min: 1,
                max: 65535,
              },
              end: {
                inputId: 'tunnelPortRangeEnd',
                min: 1,
                max: 65535,
              },
            },
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Changes affect future startup and allocation behavior only. Active tunnel sessions are not
          reconfigured in place.
        </p>
        <SaveButton onClick={save} saving={saving} />
      </CardContent>
    </Card>
  )
}

export function SecretsSection({
  secretPolicy,
  secretPolicyErrors,
  secretPolicySaving,
  setSecretPolicy,
  saveSecretPolicy,
}: {
  secretPolicy: SecretPolicy
  secretPolicyErrors: SecretPolicyErrors
  secretPolicySaving: boolean
  setSecretPolicy: React.Dispatch<React.SetStateAction<SecretPolicy>>
  saveSecretPolicy: () => void
}) {
  return (
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

        <div className="space-y-1">
          <Label htmlFor="maxAgeDays">Max Age (days)</Label>
          <Input
            id="maxAgeDays"
            type="number"
            min={0}
            value={secretPolicy.maxAgeDays}
            onChange={e =>
              setSecretPolicy(policy => ({ ...policy, maxAgeDays: Number(e.target.value) }))
            }
          />
          <p className="text-xs text-muted-foreground">
            0 means secrets never expire. When set, new secrets will automatically receive an
            expiry date.
          </p>
          {secretPolicyErrors.maxAgeDays && (
            <p className="text-xs text-destructive">{secretPolicyErrors.maxAgeDays}</p>
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor="warnBeforeExpiryDays">Expiry Warning (days)</Label>
          <Input
            id="warnBeforeExpiryDays"
            type="number"
            min={0}
            value={secretPolicy.warnBeforeExpiryDays}
            onChange={e =>
              setSecretPolicy(policy => ({
                ...policy,
                warnBeforeExpiryDays: Number(e.target.value),
              }))
            }
          />
          <p className="text-xs text-muted-foreground">
            Show an expiry warning this many days before a secret expires. 0 disables the warning.
          </p>
          {secretPolicyErrors.warnBeforeExpiryDays && (
            <p className="text-xs text-destructive">{secretPolicyErrors.warnBeforeExpiryDays}</p>
          )}
        </div>

        <SaveButton onClick={saveSecretPolicy} saving={secretPolicySaving} />
      </CardContent>
    </Card>
  )
}
