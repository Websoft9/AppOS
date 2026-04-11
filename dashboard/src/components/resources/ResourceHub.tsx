import { useState, useEffect } from 'react'
import { useNavigate, Link } from '@tanstack/react-router'
import {
  Server,
  Database,
  Cloud,
  Plug,
  Plus,
  ChevronsUpDown,
  ChevronDown,
  Loader2,
  ChevronRight,
  Layers,
} from 'lucide-react'
import { pb } from '@/lib/pb'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

// ─── Resource definitions ────────────────────────────────

interface ResourceDef {
  key: string
  title: string
  description: string
  icon: React.ReactNode
  href: string
  createLabel?: string
  createDescription?: string
  exampleItems?: string[]
  apiPath?: string
  countQuery?: {
    collection: string
    filter?: string
  }
}

interface ResourceSection {
  key: string
  title: string
  description: string
  resources: ResourceDef[]
}

const RUNTIME_INFRASTRUCTURE: ResourceDef[] = [
  {
    key: 'servers',
    title: 'Servers',
    description: 'Linux hosts, SSH targets, and deployment nodes where workloads run.',
    icon: <Server className="h-5 w-5" />,
    href: '/resources/servers',
    createLabel: 'Add a deployment target',
    createDescription: 'Linux hosts, SSH targets, and deployment nodes.',
    countQuery: { collection: 'servers' },
  },
  {
    key: 'service-instances',
    title: 'Service Instances',
    description:
      'Long-lived runtime services your apps depend on before or during deployment.',
    icon: <Database className="h-5 w-5" />,
    href: '/resources/service-instances',
    createLabel: 'Register an application dependency',
    createDescription: 'MySQL, PostgreSQL, Redis, Kafka, S3 storage, and model services.',
    exampleItems: ['Database', 'Cache', 'Queue', 'Object Storage', 'Model Service'],
    apiPath: '/api/instances',
  },
]

const EXTERNAL_INTEGRATIONS: ResourceDef[] = [
  {
    key: 'connectors',
    title: 'Connectors',
    description: 'OpenAI, SMTP, DNS, webhook, MCP, and registry connections AppOS uses outward.',
    icon: <Plug className="h-5 w-5" />,
    href: '/resources/connectors',
    createLabel: 'Configure an external connection',
    createDescription: 'OpenAI, SMTP, DNS, webhook, MCP, and registry connections.',
    exampleItems: ['REST API', 'Webhook', 'MCP', 'SMTP', 'Registry', 'DNS'],
    apiPath: '/api/connectors?kind=rest_api,webhook,mcp,smtp,registry,dns',
  },
  {
    key: 'platform-accounts',
    title: 'Platform Accounts',
    description: 'AWS, Azure, Google Cloud, GitHub, Cloudflare, and similar platform identities.',
    icon: <Cloud className="h-5 w-5" />,
    href: '/resources/platform-accounts',
    createLabel: 'Save a platform account',
    createDescription: 'AWS, Azure, Google Cloud, GitHub, Cloudflare, and similar platforms.',
    exampleItems: ['Cloud Account', 'Subscription', 'Tenant', 'Installation'],
    apiPath: '/api/provider-accounts',
  },
]

const RESOURCE_SECTIONS: ResourceSection[] = [
  {
    key: 'runtime-infrastructure',
    title: 'Runtime Infrastructure',
    description: 'Where applications run and the shared services they depend on.',
    resources: RUNTIME_INFRASTRUCTURE,
  },
  {
    key: 'external-integrations',
    title: 'External Integrations',
    description: 'How AppOS connects to external platforms, APIs, and cloud services.',
    resources: EXTERNAL_INTEGRATIONS,
  },
]

const CREATE_RESOURCES = [...RUNTIME_INFRASTRUCTURE, ...EXTERNAL_INTEGRATIONS]
const ALL_RESOURCES = [...RUNTIME_INFRASTRUCTURE, ...EXTERNAL_INTEGRATIONS]

// ─── Component ───────────────────────────────────────────

export function ResourceHub() {
  const navigate = useNavigate()
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [createChooserOpen, setCreateChooserOpen] = useState(false)
  const [expandedCreateFamily, setExpandedCreateFamily] = useState<string | null>(null)

  const resourceFamilyCount = ALL_RESOURCES.length
  const sectionCount = RESOURCE_SECTIONS.length

  useEffect(() => {
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
        .then(data => ({ key: r.key, count: Array.isArray(data) ? data.length : 0 }))
        .catch(() => ({ key: r.key, count: 0 }))
    })
    Promise.allSettled(promises).then(results => {
      const c: Record<string, number> = {}
      for (const r of results) {
        if (r.status === 'fulfilled') c[r.value.key] = r.value.count
      }
      setCounts(c)
      setLoading(false)
    })
  }, [])

  function goToCreate(href: string) {
    setCreateChooserOpen(false)
    navigate({ to: href as never, search: { create: '1' } as never })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Resources</h1>
          <p className="text-muted-foreground mt-1">
            Shared platform resources for where workloads run, what they depend on, and how AppOS connects outward.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 font-medium text-foreground/80">
              {sectionCount} grouped areas
            </span>
            <span className="rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 font-medium text-foreground/80">
              {resourceFamilyCount} canonical families
            </span>
            <span className="leading-none">Choose a destination first, then manage details inside that family.</span>
          </div>
        </div>

        {/* Hub actions */}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap md:justify-end">
          <Button variant="outline" asChild className="w-full sm:w-auto">
            <Link to="/groups">
              <Layers className="h-4 w-4 mr-2" />
              Resource Groups
            </Link>
          </Button>

          {/* Global quick-create */}
          <Popover open={createChooserOpen} onOpenChange={setCreateChooserOpen}>
            <PopoverTrigger asChild>
              <Button className="w-full sm:w-auto">
                <Plus className="h-4 w-4 mr-2" />
                Add Resource
                <ChevronDown className="h-4 w-4 ml-2" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 space-y-3 p-3">
              <div className="space-y-1">
                <p className="text-sm font-semibold">Choose a resource family</p>
                <p className="text-xs text-muted-foreground">
                  Start with the canonical type that best matches the resource you want to add.
                </p>
              </div>
              {CREATE_RESOURCES.map(r => (
                <div
                  key={r.key}
                  className="rounded-lg border border-border/70 bg-background"
                >
                  <button
                    type="button"
                    onClick={() => goToCreate(r.href)}
                    className="flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  >
                    <div className="mt-0.5 rounded-md bg-muted p-1 text-muted-foreground">
                      {r.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium leading-tight">{r.createLabel ?? r.title}</div>
                      <div className="mt-1 text-xs leading-tight text-muted-foreground">
                        {r.createDescription ?? r.title}
                      </div>
                    </div>
                  </button>
                  {r.exampleItems && r.exampleItems.length > 0 && (
                    <Collapsible
                      open={expandedCreateFamily === r.key}
                      onOpenChange={open => {
                        setExpandedCreateFamily(open ? r.key : null)
                      }}
                    >
                      <CollapsibleTrigger asChild>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between border-t border-border/60 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                        >
                          <span>Examples</span>
                          <ChevronsUpDown className="h-3.5 w-3.5" />
                        </button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="border-t border-border/60 px-3 py-2">
                        <ul className="flex flex-wrap gap-2">
                          {r.exampleItems.map(example => (
                            <li
                              key={example}
                              className={cn(
                                'rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground'
                              )}
                            >
                              {example}
                            </li>
                          ))}
                        </ul>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </div>
              ))}
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div
        className="flex flex-col gap-2 rounded-xl border border-border/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between"
        aria-live="polite"
      >
        <p className="font-medium text-foreground/80">The hub stays orientation-first while counts refresh in the background.</p>
        <p className="text-xs sm:text-sm">
          {loading ? 'Refreshing family counts...' : 'Counts loaded. Open a family to manage individual resources.'}
        </p>
      </div>

      {RESOURCE_SECTIONS.map(section => (
        <section
          key={section.key}
          className="space-y-4 rounded-2xl border border-border/70 bg-card/40 p-4 sm:p-5"
          aria-labelledby={`${section.key}-title`}
        >
          <div>
            <h2 id={`${section.key}-title`} className="text-lg font-semibold tracking-tight">
              {section.title}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">{section.description}</p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
                          <p className="text-sm font-medium leading-tight truncate">{r.title}</p>
                          <p
                            id={`${r.key}-meta`}
                            className="mt-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
                          >
                            {loading ? (
                              <>
                                <Loader2 className="h-3 w-3 animate-spin" />
                                <span>Refreshing count</span>
                              </>
                            ) : (
                              <span>{counts[r.key] ?? 0} items</span>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 rounded-full border border-border/70 px-2 py-1 text-[11px] font-medium text-foreground/80">
                        <span>Open family</span>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/70 transition-colors transition-transform shrink-0 group-hover:translate-x-0.5 group-hover:text-foreground group-focus-visible:translate-x-0.5 group-focus-visible:text-foreground" />
                      </div>
                    </div>

                    <p id={`${r.key}-description`} className="text-xs text-muted-foreground leading-relaxed mt-3 pl-7">
                      {r.description}
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
