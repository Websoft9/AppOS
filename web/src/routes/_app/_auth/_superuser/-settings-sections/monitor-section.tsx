import { type SettingsSchemaEntry } from '@/lib/settings-api'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SaveButton, Toggle } from './shared'
import type {
  MonitorManagedCollectorPolicyGroup,
  MonitorPlatformSelfObservationGroup,
  MonitorPolicyGroup,
  MonitorSchedulingGroup,
} from './monitor-types'

function renderMonitorNumberFields<T extends object, K extends keyof T & string>({
  entry,
  form,
  errors,
  setForm,
}: {
  entry: SettingsSchemaEntry
  form: T
  errors: Partial<Record<K, string>>
  setForm: React.Dispatch<React.SetStateAction<T>>
}) {
  return entry.fields.map(field => {
    const fieldKey = field.id as K
    const value = form[fieldKey] as number
    const error = errors[fieldKey]
    return (
      <div key={field.id} className="space-y-1">
        <Label htmlFor={field.id}>{field.label}</Label>
        <Input
          id={field.id}
          type="number"
          value={value}
          onChange={event =>
            setForm(current => ({ ...current, [fieldKey]: Number(event.target.value) }) as T)
          }
        />
        {field.helpText ? <p className="text-xs text-muted-foreground">{field.helpText}</p> : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    )
  })
}

export function MonitorSchedulingSection({
  entry,
  form,
  errors,
  saving,
  setForm,
  save,
}: {
  entry: SettingsSchemaEntry
  form: MonitorSchedulingGroup
  errors: Partial<Record<keyof MonitorSchedulingGroup, string>>
  saving: boolean
  setForm: React.Dispatch<React.SetStateAction<MonitorSchedulingGroup>>
  save: () => void
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">Monitor Scheduling</h3>
        <p className="text-sm text-muted-foreground">Global scheduling intervals for monitoring sweeps.</p>
      </div>
      <div className="rounded-lg border border-border/40 bg-background p-4">
        <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {renderMonitorNumberFields({ entry, form, errors, setForm })}
        </div>
        <SaveButton onClick={save} saving={saving} />
        </div>
      </div>
    </div>
  )
}

export function MonitorPolicySection({
  entry,
  form,
  errors,
  saving,
  setForm,
  save,
}: {
  entry: SettingsSchemaEntry
  form: MonitorPolicyGroup
  errors: Partial<Record<keyof MonitorPolicyGroup, string>>
  saving: boolean
  setForm: React.Dispatch<React.SetStateAction<MonitorPolicyGroup>>
  save: () => void
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">Monitor Policy</h3>
        <p className="text-sm text-muted-foreground">
          Freshness thresholds and probe runtime limits for monitoring.
        </p>
      </div>
      <div className="rounded-lg border border-border/40 bg-background p-4">
        <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {renderMonitorNumberFields({ entry, form, errors, setForm })}
        </div>
        <SaveButton onClick={save} saving={saving} />
        </div>
      </div>
    </div>
  )
}

export function MonitorPlatformSelfObservationSection({
  entry,
  form,
  errors,
  saving,
  setForm,
  save,
}: {
  entry: SettingsSchemaEntry
  form: MonitorPlatformSelfObservationGroup
  errors: Partial<Record<keyof MonitorPlatformSelfObservationGroup, string>>
  saving: boolean
  setForm: React.Dispatch<React.SetStateAction<MonitorPlatformSelfObservationGroup>>
  save: () => void
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">Platform Self-Observation</h3>
        <p className="text-sm text-muted-foreground">
          Control AppOS-local platform observer cadence and optional self-telemetry sources.
        </p>
      </div>
      <div className="rounded-lg border border-border/40 bg-background p-4">
        <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {renderMonitorNumberFields({ entry, form, errors, setForm }).filter(field =>
            ['platformObserverIntervalSeconds', 'platformSchedulerStaleThresholdSeconds'].includes(
              field.key as string
            )
          )}
        </div>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Toggle
              id="enableHostTelemetry"
              checked={form.enableHostTelemetry}
              onChange={value => setForm(current => ({ ...current, enableHostTelemetry: value }))}
            />
            <Label htmlFor="enableHostTelemetry">Enable Host Telemetry</Label>
          </div>
          <p className="text-xs text-muted-foreground">
            Collect AppOS-local host telemetry when runtime capability is available.
          </p>
          {errors.enableHostTelemetry ? (
            <p className="text-xs text-destructive">{errors.enableHostTelemetry}</p>
          ) : null}

          <div className="flex items-center gap-3">
            <Toggle
              id="enableContainerTelemetry"
              checked={form.enableContainerTelemetry}
              onChange={value =>
                setForm(current => ({ ...current, enableContainerTelemetry: value }))
              }
            />
            <Label htmlFor="enableContainerTelemetry">Enable Container Telemetry</Label>
          </div>
          <p className="text-xs text-muted-foreground">
            Collect AppOS-local container telemetry when runtime capability is available.
          </p>
          {errors.enableContainerTelemetry ? (
            <p className="text-xs text-destructive">{errors.enableContainerTelemetry}</p>
          ) : null}
        </div>
        <SaveButton onClick={save} saving={saving} />
        </div>
      </div>
    </div>
  )
}

export function MonitorManagedCollectorPolicySection({
  entry,
  form,
  errors,
  saving,
  setForm,
  save,
}: {
  entry: SettingsSchemaEntry
  form: MonitorManagedCollectorPolicyGroup
  errors: Partial<Record<keyof MonitorManagedCollectorPolicyGroup, string>>
  saving: boolean
  setForm: React.Dispatch<React.SetStateAction<MonitorManagedCollectorPolicyGroup>>
  save: () => void
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">Managed Collector Policy</h3>
        <p className="text-sm text-muted-foreground">
          Control the Telegraf-based monitor-agent cadence and batching policy on managed servers.
        </p>
      </div>
      <div className="rounded-lg border border-border/40 bg-background p-4">
        <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {renderMonitorNumberFields({ entry, form, errors, setForm })}
        </div>
        <SaveButton onClick={save} saving={saving} />
        </div>
      </div>
    </div>
  )
}

export function MonitorSection({
  schedulingEntry,
  schedulingForm,
  schedulingErrors,
  schedulingSaving,
  setSchedulingForm,
  saveScheduling,
  policyEntry,
  policyForm,
  policyErrors,
  policySaving,
  setPolicyForm,
  savePolicy,
  platformSelfObservationEntry,
  platformSelfObservationForm,
  platformSelfObservationErrors,
  platformSelfObservationSaving,
  setPlatformSelfObservationForm,
  savePlatformSelfObservation,
  managedCollectorPolicyEntry,
  managedCollectorPolicyForm,
  managedCollectorPolicyErrors,
  managedCollectorPolicySaving,
  setManagedCollectorPolicyForm,
  saveManagedCollectorPolicy,
}: {
  schedulingEntry: SettingsSchemaEntry | undefined
  schedulingForm: MonitorSchedulingGroup
  schedulingErrors: Partial<Record<keyof MonitorSchedulingGroup, string>>
  schedulingSaving: boolean
  setSchedulingForm: React.Dispatch<React.SetStateAction<MonitorSchedulingGroup>>
  saveScheduling: () => void
  policyEntry: SettingsSchemaEntry | undefined
  policyForm: MonitorPolicyGroup
  policyErrors: Partial<Record<keyof MonitorPolicyGroup, string>>
  policySaving: boolean
  setPolicyForm: React.Dispatch<React.SetStateAction<MonitorPolicyGroup>>
  savePolicy: () => void
  platformSelfObservationEntry: SettingsSchemaEntry | undefined
  platformSelfObservationForm: MonitorPlatformSelfObservationGroup
  platformSelfObservationErrors: Partial<Record<keyof MonitorPlatformSelfObservationGroup, string>>
  platformSelfObservationSaving: boolean
  setPlatformSelfObservationForm: React.Dispatch<
    React.SetStateAction<MonitorPlatformSelfObservationGroup>
  >
  savePlatformSelfObservation: () => void
  managedCollectorPolicyEntry: SettingsSchemaEntry | undefined
  managedCollectorPolicyForm: MonitorManagedCollectorPolicyGroup
  managedCollectorPolicyErrors: Partial<Record<keyof MonitorManagedCollectorPolicyGroup, string>>
  managedCollectorPolicySaving: boolean
  setManagedCollectorPolicyForm: React.Dispatch<
    React.SetStateAction<MonitorManagedCollectorPolicyGroup>
  >
  saveManagedCollectorPolicy: () => void
}) {
  return (
    <div className="space-y-6">
      {schedulingEntry ? (
        <MonitorSchedulingSection
          entry={schedulingEntry}
          form={schedulingForm}
          errors={schedulingErrors}
          saving={schedulingSaving}
          setForm={setSchedulingForm}
          save={saveScheduling}
        />
      ) : null}
      {policyEntry ? (
        <MonitorPolicySection
          entry={policyEntry}
          form={policyForm}
          errors={policyErrors}
          saving={policySaving}
          setForm={setPolicyForm}
          save={savePolicy}
        />
      ) : null}
      {platformSelfObservationEntry ? (
        <MonitorPlatformSelfObservationSection
          entry={platformSelfObservationEntry}
          form={platformSelfObservationForm}
          errors={platformSelfObservationErrors}
          saving={platformSelfObservationSaving}
          setForm={setPlatformSelfObservationForm}
          save={savePlatformSelfObservation}
        />
      ) : null}
      {managedCollectorPolicyEntry ? (
        <MonitorManagedCollectorPolicySection
          entry={managedCollectorPolicyEntry}
          form={managedCollectorPolicyForm}
          errors={managedCollectorPolicyErrors}
          saving={managedCollectorPolicySaving}
          setForm={setManagedCollectorPolicyForm}
          save={saveManagedCollectorPolicy}
        />
      ) : null}
    </div>
  )
}
