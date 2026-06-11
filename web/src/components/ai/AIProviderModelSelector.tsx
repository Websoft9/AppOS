import { forwardRef, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'

export type AIProviderModelOption = {
  id: string
  label?: string
  vendor?: string
  enabled_by_default?: boolean
}

export type AIProviderModelGroup = {
  vendor: string
  label: string
  models: AIProviderModelOption[]
}

type AIProviderModelSelectorProps = {
  selectedModels: string[]
  models: AIProviderModelOption[]
  groups?: AIProviderModelGroup[]
  loading?: boolean
  error?: string
  loaded?: boolean
  canLoad?: boolean
  onListModels: () => void
  onToggleModel: (modelId: string) => void
}

export const AIProviderModelSelector = forwardRef<HTMLDivElement, AIProviderModelSelectorProps>(
  function AIProviderModelSelector(
    {
      selectedModels,
      models,
      groups = [],
      loading = false,
      error,
      loaded = false,
      canLoad = true,
      onListModels,
      onToggleModel,
    },
    ref
  ) {
    const [expanded, setExpanded] = useState(false)
    const hasInventory = groups.length > 0 || models.length > 0

    // Filter out useless vendor labels like "System" and sort groups + models
    const visibleGroups = useMemo(() => {
      const filtered = groups.filter(
        g => String(g.label ?? g.vendor ?? '').toLowerCase() !== 'system'
      )
      return [...filtered].sort((a, b) => a.label.localeCompare(b.label)).map(g => ({
        ...g,
        label: g.label || g.vendor || 'Other',
        models: [...g.models].sort((a, b) => a.id.localeCompare(b.id)),
      }))
    }, [groups])

    const visibleModels = useMemo(
      () => [...models].sort((a, b) => a.id.localeCompare(b.id)),
      [models]
    )
    const totalAvailable =
      visibleGroups.length > 0
        ? visibleGroups.reduce((sum, group) => sum + group.models.length, 0)
        : visibleModels.length

    const handleActionClick = () => {
      if (!loaded) {
        onListModels()
        setExpanded(true)
        return
      }
      setExpanded(prev => !prev)
    }

    // Auto-collapse when models are cleared externally
    if (!loaded && expanded) {
      // keep expanded true during fetch, collapse only when reset
    }

    if (!canLoad) return null

    return (
      <div ref={ref} className="space-y-3">
        {/* Title + description */}
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">Enable Models</div>
          <div className="text-xs text-muted-foreground">
            {loaded
              ? selectedModels.length > 0
                ? `${selectedModels.length} selected of ${totalAvailable} available.`
                : `Pick at least one model — only validated selections are stored.`
              : 'List models to select which ones to enable for this platform.'}
          </div>
        </div>

        {/* Selected model capsules */}
        {selectedModels.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {selectedModels.map(model => (
              <span
                key={model}
                className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
              >
                {model}
              </span>
            ))}
          </div>
        ) : loaded ? (
          <div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
            No enabled models saved. Save with an empty selection to clear all enabled models.
          </div>
        ) : null}

        {/* Action prompt */}
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-left text-sm transition-colors disabled:pointer-events-none disabled:opacity-50 ${
            loaded && !error && totalAvailable > 0
              ? 'border-emerald-200 bg-emerald-50/70 font-medium text-emerald-700 hover:bg-emerald-100/70 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-300 dark:hover:bg-emerald-950/30'
              : 'border-sky-200 bg-sky-50/80 text-sky-700 hover:bg-sky-100/80 dark:border-sky-900 dark:bg-sky-950/20 dark:text-sky-300 dark:hover:bg-sky-950/30'
          }`}
          onClick={handleActionClick}
          disabled={loading}
        >
            {loading ? (
              <>
                <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />
                Loading models...
              </>
            ) : loaded && !error && totalAvailable > 0 ? (
              <>
                {expanded ? (
                  <ChevronDown className="mr-1 inline h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="mr-1 inline h-3.5 w-3.5" />
                )}
                {totalAvailable} model{totalAvailable === 1 ? '' : 's'} available
              </>
            ) : (
              <>
                <span className="text-[11px] uppercase tracking-[0.14em] opacity-70">Discovery</span>
                <span className="font-medium">Load all available models</span>
              </>
            )}
        </button>

        {/* Error */}
        {error ? (
          <div className="rounded-md border bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {/* Model grid — shown only when expanded */}
        {loaded && expanded && hasInventory ? (
          visibleGroups.length > 0 ? (
            <div className="space-y-3">
              {visibleGroups.map(group => (
                <div key={group.label} className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </div>
                  <div className="grid gap-1 sm:grid-cols-2">
                    {group.models.map(model => {
                      const checked = selectedModels.includes(model.id)
                      return (
                        <label
                          key={model.id}
                          className={`flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm ${
                            checked ? 'bg-primary/10' : 'hover:bg-muted/50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 rounded border-input"
                            checked={checked}
                            onChange={() => onToggleModel(model.id)}
                          />
                          <div className="break-all font-medium text-foreground">{model.id}</div>
                        </label>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid gap-1 sm:grid-cols-2">
              {visibleModels.map(model => {
                const checked = selectedModels.includes(model.id)
                return (
                  <label
                    key={model.id}
                    className={`flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm ${
                      checked ? 'bg-primary/10' : 'hover:bg-muted/50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded border-input"
                      checked={checked}
                      onChange={() => onToggleModel(model.id)}
                    />
                    <div className="break-all font-medium text-foreground">{model.id}</div>
                  </label>
                )
              })}
            </div>
          )
        ) : null}
      </div>
    )
  }
)