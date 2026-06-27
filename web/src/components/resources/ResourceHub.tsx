import { useState, useEffect, useMemo } from 'react'
import { useNavigate, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  Server,
  Database,
  Bot,
  Cloud,
  Plug,
  Search,
  Loader2,
  ChevronRight,
} from 'lucide-react'
import { pb } from '@/lib/pb'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { RefreshButton } from '@/components/shared/RefreshButton'

// ─── Resource definitions ────────────────────────────────

interface ResourceDef {
  key: string
  titleKey: string
  descriptionKey: string
  icon: React.ReactNode
  href: string
  readOnly?: boolean
  createDescriptionKey?: string
  exampleItemKeys?: string[]
  apiPath?: string
  countQuery?: {
    collection: string
    filter?: string
  }
  createSearchKeywords?: string[]
}

interface ResourceSection {
  key: string
  titleKey: string
  descriptionKey: string
  resources: ResourceDef[]
}

const RUNTIME_INFRASTRUCTURE: ResourceDef[] = [
  {
    key: 'servers',
    titleKey: 'resources.servers.title',
    descriptionKey: 'resources.servers.description',
    icon: <Server className="h-5 w-5" />,
    href: '/resources/servers',
    createDescriptionKey: 'resources.servers.createDescription',
    countQuery: { collection: 'servers' },
  },
  {
    key: 'service-instances',
    titleKey: 'resources.serviceInstances.title',
    descriptionKey: 'resources.serviceInstances.description',
    icon: <Database className="h-5 w-5" />,
    href: '/resources/service-instances',
    createDescriptionKey: 'resources.serviceInstances.createDescription',
    exampleItemKeys: [
      'resources.serviceInstances.examples.database',
      'resources.serviceInstances.examples.cache',
      'resources.serviceInstances.examples.queue',
      'resources.serviceInstances.examples.objectStorage',
    ],
    createSearchKeywords: [
      'mysql',
      'postgres',
      'postgresql',
      'redis',
      'kafka',
      'rabbitmq',
      'nats',
      'mqtt',
      's3',
      'database',
      'cache',
      'mq',
      'message',
      'storage',
      'gateway',
    ],
    apiPath: '/api/instances',
  },
]

const EXTERNAL_INTEGRATIONS: ResourceDef[] = [
  {
    key: 'ai-providers',
    titleKey: 'resources.aiProviders.title',
    descriptionKey: 'resources.aiProviders.description',
    icon: <Bot className="h-5 w-5" />,
    href: '/resources/ai-providers',
    createDescriptionKey: 'resources.aiProviders.createDescription',
    exampleItemKeys: [
      'resources.aiProviders.examples.openai',
      'resources.aiProviders.examples.anthropic',
      'resources.aiProviders.examples.openrouter',
      'resources.aiProviders.examples.ollama',
    ],
    createSearchKeywords: ['openai', 'anthropic', 'openrouter', 'ollama', 'llm', 'model'],
    apiPath: '/api/ai-providers',
  },
  {
    key: 'connectors',
    titleKey: 'resources.connectors.title',
    descriptionKey: 'resources.connectors.description',
    icon: <Plug className="h-5 w-5" />,
    href: '/resources/connectors',
    createDescriptionKey: 'resources.connectors.createDescription',
    exampleItemKeys: [
      'resources.connectors.examples.restApi',
      'resources.connectors.examples.webhook',
      'resources.connectors.examples.mcp',
      'resources.connectors.examples.proxy',
      'resources.connectors.examples.smtp',
      'resources.connectors.examples.registry',
      'resources.connectors.examples.dns',
    ],
    createSearchKeywords: ['webhook', 'smtp', 'dns', 'mcp', 'proxy', 'registry', 'rest api'],
    apiPath: '/api/connectors?kind=rest_api,webhook,mcp,proxy,smtp,registry,dns',
  },
  {
    key: 'platform-accounts',
    titleKey: 'resources.platformAccounts.title',
    descriptionKey: 'resources.platformAccounts.description',
    icon: <Cloud className="h-5 w-5" />,
    href: '/resources/platform-accounts',
    createDescriptionKey: 'resources.platformAccounts.createDescription',
    exampleItemKeys: [
      'resources.platformAccounts.examples.cloudAccount',
      'resources.platformAccounts.examples.subscription',
      'resources.platformAccounts.examples.tenant',
      'resources.platformAccounts.examples.installation',
    ],
    createSearchKeywords: ['aws', 'azure', 'google cloud', 'github', 'cloudflare'],
    apiPath: '/api/provider-accounts',
  },
]

const RESOURCE_SECTIONS: ResourceSection[] = [
  {
    key: 'runtime-infrastructure',
    titleKey: 'sections.runtimeInfrastructure.title',
    descriptionKey: 'sections.runtimeInfrastructure.description',
    resources: RUNTIME_INFRASTRUCTURE,
  },
  {
    key: 'external-integrations',
    titleKey: 'sections.externalIntegrations.title',
    descriptionKey: 'sections.externalIntegrations.description',
    resources: EXTERNAL_INTEGRATIONS,
  },
]

const ALL_RESOURCES = [...RUNTIME_INFRASTRUCTURE, ...EXTERNAL_INTEGRATIONS]

function buildCreateSearchText(resource: ResourceDef, t: (key: string) => string) {
  return [
    t(resource.titleKey),
    t(resource.createDescriptionKey ?? resource.descriptionKey),
    ...(resource.exampleItemKeys ?? []).map(key => t(key)),
    ...(resource.createSearchKeywords ?? []),
  ]
    .join(' ')
    .toLowerCase()
}

// ─── Component ───────────────────────────────────────────

export function ResourceHub() {
  const { t } = useTranslation('resources')
  const navigate = useNavigate()
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [groupCount, setGroupCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [createChooserOpen, setCreateChooserOpen] = useState(false)
  const [createSearchQuery, setCreateSearchQuery] = useState('')

  useEffect(() => {
    void fetchCounts()
  }, [])

  async function fetchCounts() {
    setRefreshing(true)
    const promises = ALL_RESOURCES.map(r => {
      if (r.countQuery) {
        return pb
          .collection(r.countQuery.collection)
          .getList(1, 1, r.countQuery.filter ? { filter: r.countQuery.filter } : undefined)
          .then(data => ({ key: r.key, count: data.totalItems ?? 0 }))
          .catch(() => ({ key: r.key, count: 0 }))
      }
      return pb
        .send<unknown[]>(r.apiPath ?? '', {})
        .then(data => {
          if (Array.isArray(data)) return { key: r.key, count: data.length }
          if (
            data &&
            typeof data === 'object' &&
            Array.isArray((data as { items?: unknown[] }).items)
          ) {
            return { key: r.key, count: (data as { items: unknown[] }).items.length }
          }
          return { key: r.key, count: 0 }
        })
        .catch(() => ({ key: r.key, count: 0 }))
    })
    const groupPromise = pb
      .collection('groups')
      .getList(1, 1)
      .then(data => data.totalItems ?? 0)
      .catch(() => 0)

    const [results, nextGroupCount] = await Promise.all([Promise.allSettled(promises), groupPromise])
    const c: Record<string, number> = {}
    for (const r of results) {
      if (r.status === 'fulfilled') c[r.value.key] = r.value.count
    }
    setCounts(c)
    setGroupCount(nextGroupCount)
    setLoading(false)
    setRefreshing(false)
  }

  function goToCreate(href: string) {
    setCreateChooserOpen(false)
    setCreateSearchQuery('')
    navigate({ to: href as never, search: { create: '1' } as never })
  }

  const filteredCreateResources = useMemo(() => {
    const normalizedQuery = createSearchQuery.trim().toLowerCase()
    if (!normalizedQuery) return ALL_RESOURCES.filter(resource => !resource.readOnly)
    return ALL_RESOURCES.filter(resource => {
      if (resource.readOnly) return false
      return buildCreateSearchText(resource, t).includes(normalizedQuery)
    })
  }, [createSearchQuery, t])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{t('hub.title')}</h1>
          <p className="text-muted-foreground mt-1">{t('hub.subtitle')}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Link
              to="/groups"
              className="rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 font-medium text-foreground/80 transition-colors hover:bg-muted/70"
            >
              {t('hub.groupCount', { count: groupCount })}
            </Link>
          </div>
        </div>

        {/* Hub actions */}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap md:justify-end">
          <RefreshButton
            onClick={() => {
              void fetchCounts()
            }}
            title={t('hub.refresh')}
            spinning={refreshing}
            chrome="boxed"
            className="self-end"
          />

          <Button className="w-full sm:w-auto" onClick={() => setCreateChooserOpen(true)}>
            {t('hub.addResource')}
          </Button>
        </div>
      </div>

      <Dialog
        open={createChooserOpen}
        onOpenChange={open => {
          setCreateChooserOpen(open)
          if (!open) setCreateSearchQuery('')
        }}
      >
        <DialogContent className="sm:max-w-2xl" aria-describedby={undefined}>
          <DialogHeader className="text-left">
            <DialogTitle className="text-2xl font-semibold tracking-tight">
              {t('dialog.title')}
            </DialogTitle>
            <p className="text-sm text-muted-foreground">{t('hub.dialogDescription')}</p>
          </DialogHeader>

          <div className="space-y-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={createSearchQuery}
                onChange={event => setCreateSearchQuery(event.target.value)}
                placeholder={t('hub.resourceSearchPlaceholder')}
                className="pl-9"
                aria-label={t('hub.resourceSearchPlaceholder')}
              />
            </div>

            <div className="max-h-[62vh] space-y-3 overflow-y-auto pr-1">
              {filteredCreateResources.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
                  {t('hub.noResourceMatches')}
                </div>
              ) : (
                filteredCreateResources.map(r => (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => goToCreate(r.href)}
                    className="block w-full rounded-xl border border-border/70 bg-background p-4 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="mt-0.5 shrink-0 rounded-lg bg-muted p-2 text-muted-foreground">
                        {r.icon}
                      </div>
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-base font-medium leading-tight">{t(r.titleKey)}</p>
                            <p className="mt-1 text-sm leading-6 text-muted-foreground">
                              {t(r.createDescriptionKey ?? r.descriptionKey)}
                            </p>
                          </div>
                          <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
                            {t('hub.addNow')}
                          </span>
                        </div>
                        {r.exampleItemKeys && r.exampleItemKeys.length > 0 && (
                          <ul className="flex flex-wrap gap-2">
                            {r.exampleItemKeys.map(exampleKey => (
                              <li
                                key={exampleKey}
                                className={cn(
                                  'rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground'
                                )}
                              >
                                {t(exampleKey)}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateChooserOpen(false)}>
              {t('hub.cancel')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {RESOURCE_SECTIONS.map(section => (
        <section
          key={section.key}
          className="space-y-4 rounded-2xl bg-card/40 p-4 sm:p-5"
          aria-labelledby={`${section.key}-title`}
        >
          <div>
            <h2 id={`${section.key}-title`} className="text-lg font-semibold tracking-tight">
              {t(section.titleKey)}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">{t(section.descriptionKey)}</p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {section.resources.map(r => (
              <Link
                key={r.key}
                to={r.href}
                params={{} as never}
                search={{} as never}
                className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                aria-describedby={`${r.key}-description ${r.key}-meta`}
              >
                <Card className="h-full border-border/70 transition-all duration-150 group-hover:-translate-y-0.5 group-hover:border-primary/40 group-hover:shadow-md group-focus-visible:border-primary/60 group-focus-visible:shadow-md group-focus-visible:shadow-primary/10">
                  <CardContent className="px-4 py-3 sm:px-5 sm:py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="p-1 rounded-md bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary group-focus-visible:bg-primary/10 group-focus-visible:text-primary transition-colors shrink-0">
                          {r.icon}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium leading-tight truncate">
                            {t(r.titleKey)}
                          </p>
                          <p
                            id={`${r.key}-meta`}
                            className="mt-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
                          >
                            {loading ? (
                              <>
                                <Loader2 className="h-3 w-3 animate-spin" />
                                <span>{t('hub.refreshingCount')}</span>
                              </>
                            ) : (
                              <span>{t('hub.itemsCount', { count: counts[r.key] ?? 0 })}</span>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 rounded-full border border-border/70 px-2 py-1 text-[11px] font-medium text-foreground/80">
                        <span>{t('hub.openFamily')}</span>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/70 transition-colors transition-transform shrink-0 group-hover:translate-x-0.5 group-hover:text-foreground group-focus-visible:translate-x-0.5 group-focus-visible:text-foreground" />
                      </div>
                    </div>

                    <p
                      id={`${r.key}-description`}
                      className="text-xs text-muted-foreground leading-relaxed mt-3 pl-7"
                    >
                      {t(r.descriptionKey)}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
