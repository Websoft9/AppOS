import { CheckCircle2, Circle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { HelpTip, type TemplateServiceItem } from './createDeploymentPage.helpers'

type CreateDeploymentExposureSectionProps = {
  showHeader?: boolean
  isTemplate: boolean
  templateServiceItems: TemplateServiceItem[]
  portExposureEnabled: boolean
  setPortExposureEnabled: React.Dispatch<React.SetStateAction<boolean>>
  domainExposureEnabled: boolean
  setDomainExposureEnabled: React.Dispatch<React.SetStateAction<boolean>>
  servicePortMappings: Record<string, { enabled: boolean; port: string }>
  setServicePortMappings: React.Dispatch<
    React.SetStateAction<Record<string, { enabled: boolean; port: string }>>
  >
  onPrimaryPortManualChange: () => void
  primaryServiceName: string
  recommendedExposurePort: string
  recommendedExposurePortHint: string | null
  exposurePortError: string | null
  exposureSelectionError: string | null
  exposureDomainMessage: string
  extraServiceMappingMessage: string | null
}

export function CreateDeploymentExposureSection({
  showHeader = true,
  isTemplate,
  templateServiceItems,
  portExposureEnabled,
  setPortExposureEnabled,
  domainExposureEnabled,
  setDomainExposureEnabled,
  servicePortMappings,
  setServicePortMappings,
  onPrimaryPortManualChange,
  primaryServiceName,
  recommendedExposurePort,
  recommendedExposurePortHint,
  exposurePortError,
  exposureSelectionError,
  exposureDomainMessage,
  extraServiceMappingMessage,
}: CreateDeploymentExposureSectionProps) {
  const { t } = useTranslation('deploy')
  const publicAccessDisabled = !portExposureEnabled && !domainExposureEnabled
  const serviceItems = (
    isTemplate && templateServiceItems.length > 0
      ? templateServiceItems
      : [{ name: 'primary', role: 'primary', isPrimary: true, containerPort: '' }]
  )
    .slice()
    .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary))

  const fallbackPrimaryServiceLabel = t('exposure.primaryService')

  const displayServiceLabel = (service: TemplateServiceItem) =>
    !isTemplate && service.name === 'primary' ? fallbackPrimaryServiceLabel : service.name

  const displayServiceRole = (service: TemplateServiceItem) =>
    service.role === 'primary' ? t('exposure.primaryRole') : service.role

  const updateServiceMapping = (
    serviceName: string,
    nextValue: Partial<{ enabled: boolean; port: string }>
  ) => {
    setServicePortMappings(current => ({
      ...current,
      [serviceName]: {
        enabled: current[serviceName]?.enabled ?? false,
        port: current[serviceName]?.port ?? '',
        ...nextValue,
      },
    }))
  }

  return (
    <section>
      {showHeader ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <span className="text-base font-semibold">{t('exposure.title')}</span>
              <HelpTip text={t('exposure.help')} />
            </div>
            <div className="text-xs text-muted-foreground">{t('exposure.description')}</div>
          </div>
          <div className="flex items-center gap-2 pt-0.5">
            <Checkbox
              id="public-access-disabled"
              checked={publicAccessDisabled}
              onCheckedChange={checked => {
                if (checked) {
                  setDomainExposureEnabled(false)
                  setPortExposureEnabled(false)
                  return
                }

                setDomainExposureEnabled(true)
                setPortExposureEnabled(false)
              }}
            />
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <label
                    htmlFor="public-access-disabled"
                    className="cursor-pointer text-sm font-medium text-foreground transition-colors hover:text-foreground/80"
                  >
                    {t('exposure.disabled')}
                  </label>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs text-xs">
                  {t('exposure.disabledHelp')}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      ) : null}
      <div className={showHeader ? 'pt-3.5' : ''}>
        <div className="grid gap-3 md:grid-cols-2">
          <div
            className={`rounded-lg border px-3.5 py-2.5 transition-colors ${
              domainExposureEnabled
                ? 'border-foreground/50 bg-muted/30 text-foreground shadow-sm'
                : 'border-border bg-background text-foreground'
            } ${publicAccessDisabled ? 'opacity-50' : ''}`}
          >
            <button
              type="button"
              className="w-full text-left"
              onClick={() => {
                if (publicAccessDisabled) return
                setDomainExposureEnabled(true)
                setPortExposureEnabled(false)
              }}
              disabled={publicAccessDisabled}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                  {domainExposureEnabled ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
                  ) : (
                    <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{t('exposure.domainAccess')}</span>
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                        {t('exposure.recommended')}
                      </span>
                    </div>
                    <div className="pt-0.5 text-xs text-muted-foreground">
                      {t('exposure.domainDescription')}
                    </div>
                  </div>
                </div>
              </div>
            </button>
          </div>

          <div
            className={`rounded-lg border px-3.5 py-2.5 transition-colors ${
              portExposureEnabled
                ? 'border-foreground/50 bg-muted/30 text-foreground shadow-sm'
                : 'border-border bg-background text-foreground'
            } ${publicAccessDisabled ? 'opacity-50' : ''}`}
          >
            <button
              type="button"
              className="w-full text-left"
              onClick={() => {
                if (publicAccessDisabled) return
                setPortExposureEnabled(true)
                setDomainExposureEnabled(false)
              }}
              disabled={publicAccessDisabled}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                  {portExposureEnabled ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
                  ) : (
                    <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <div>
                    <div className="text-sm font-semibold">{t('exposure.portAccess')}</div>
                    <div className="pt-0.5 text-xs text-muted-foreground">
                      {t('exposure.portDescription')}
                    </div>
                  </div>
                </div>
              </div>
            </button>
          </div>
        </div>

        {!publicAccessDisabled && domainExposureEnabled ? (
          <div className="mt-3 rounded-lg border bg-muted/10 px-3.5 py-3 text-sm text-muted-foreground">
            {exposureDomainMessage}
          </div>
        ) : null}

        {!publicAccessDisabled && portExposureEnabled ? (
          <div className="mt-3 rounded-lg border bg-muted/10 px-3.5 py-3">
            <div className="grid grid-cols-[minmax(0,1.35fr)_110px_88px_116px] gap-2.5 border-b pb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <div>{t('exposure.serviceName')}</div>
              <div>{t('exposure.containerPort')}</div>
              <div>{t('exposure.openPort')}</div>
              <div>{t('exposure.serverPort')}</div>
            </div>
            <div className="space-y-2 pt-2.5">
              {serviceItems.map(service => {
                const mapping = servicePortMappings[service.name]
                const serviceLabel = displayServiceLabel(service)
                return (
                  <div
                    key={service.name}
                    className="grid grid-cols-[minmax(0,1.35fr)_110px_88px_116px] items-center gap-2.5"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{serviceLabel}</div>
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {displayServiceRole(service)}
                      </div>
                    </div>
                    <div className="text-sm">{service.containerPort || '—'}</div>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        aria-label={`${t('exposure.openPort')} ${serviceLabel}`}
                        checked={mapping?.enabled ?? service.isPrimary}
                        onChange={e =>
                          updateServiceMapping(service.name, {
                            enabled: e.target.checked,
                            port:
                              mapping?.port ||
                              (service.name === primaryServiceName ? recommendedExposurePort : ''),
                          })
                        }
                      />
                      <span>
                        {(mapping?.enabled ?? service.isPrimary)
                          ? t('exposure.on')
                          : t('exposure.off')}
                      </span>
                    </label>
                    <Input
                      id={`exposure-port-${service.name}`}
                      aria-label={`${t('exposure.serverPort')} ${serviceLabel}`}
                      type="number"
                      min={1}
                      max={65535}
                      value={
                        mapping?.port ??
                        (service.name === primaryServiceName ? recommendedExposurePort : '')
                      }
                      onChange={e => {
                        if (service.name === primaryServiceName) {
                          onPrimaryPortManualChange()
                        }
                        updateServiceMapping(service.name, {
                          enabled: true,
                          port: e.target.value,
                        })
                      }}
                      placeholder={
                        service.name === primaryServiceName ? recommendedExposurePort : '—'
                      }
                      disabled={!(mapping?.enabled ?? service.isPrimary)}
                      className="h-8 px-2.5"
                    />
                  </div>
                )
              })}
            </div>
            {exposurePortError ? (
              <div className="pt-2 text-[11px] text-amber-700 dark:text-amber-400">
                {exposurePortError}
              </div>
            ) : null}
            {exposureSelectionError ? (
              <div className="pt-2 text-[11px] text-amber-700 dark:text-amber-400">
                {exposureSelectionError}
              </div>
            ) : null}
            {recommendedExposurePortHint ? (
              <div className="pt-2 text-[11px] text-amber-700 dark:text-amber-400">
                {recommendedExposurePortHint}
              </div>
            ) : null}
            {extraServiceMappingMessage ? (
              <div className="pt-2 text-[11px] text-muted-foreground">
                {extraServiceMappingMessage}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  )
}
