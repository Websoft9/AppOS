import { useState, useEffect } from 'react'
import { useNavigate, Link } from '@tanstack/react-router'
import {
  Server,
  Database,
  Bot,
  Cloud,
  Plug,
  CircleQuestionMark,
  Plus,
  ChevronDown,
  Loader2,
  ChevronRight,
  Layers,
  FileCode2,
  Wrench,
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

// ─── Resource definitions ────────────────────────────────

interface ResourceDef {
  key: string
  title: string
  description: string
  icon: React.ReactNode
  href: string
  readOnly?: boolean
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
      'Runtime dependencies required for application startup, including databases, middleware, and storage instances such as MySQL, PostgreSQL, Redis, Kafka, and S3.',
    icon: <Database className="h-5 w-5" />,
    href: '/resources/service-instances',
    createLabel: 'Register an application dependency',
    createDescription: 'MySQL, PostgreSQL, Redis, Kafka, and S3-backed application dependencies.',
    exampleItems: ['Database', 'Cache', 'Queue', 'Object Storage'],
    apiPath: '/api/instances',
  },
]

const SHARED_ASSETS: ResourceDef[] = [
  {
    key: 'shared-envs',
    title: 'Shared Envs',
    description: 'Reusable shared environment sets and variables that can be mapped across apps.',
    icon: <Layers className="h-5 w-5" />,
    href: '/shared-envs',
    createLabel: 'Create a shared environment set',
    createDescription: 'Reusable environment variable sets shared across apps and workflows.',
    exampleItems: ['Runtime Variables', 'Secrets Mapping', 'Shared Defaults'],
    countQuery: { collection: 'env_sets' },
  },
  {
    key: 'scripts',
    title: 'Scripts',
    description:
      'Reusable automation scripts for operations, recovery steps, and repeatable tasks.',
    icon: <FileCode2 className="h-5 w-5" />,
    href: '/resources/scripts',
    createLabel: 'Add an automation script',
    createDescription: 'Reusable automation scripts for operational tasks and workflows.',
    exampleItems: ['Health Check', 'Backup', 'Cleanup'],
    apiPath: '/api/ext/resources/scripts',
  },
]

const EXTERNAL_INTEGRATIONS: ResourceDef[] = [
  {
    key: 'ai-providers',
    title: 'AI Providers',
    description:
      'Hosted and local AI capability sources such as OpenAI, Anthropic, OpenRouter, and Ollama endpoints.',
    icon: <Bot className="h-5 w-5" />,
    href: '/resources/ai-providers',
    createLabel: 'Choose an AI capability source',
    createDescription: 'OpenAI, Anthropic, OpenRouter, Ollama, and similar AI providers.',
    exampleItems: ['OpenAI', 'Anthropic', 'OpenRouter', 'Ollama'],
    apiPath: '/api/ai-providers',
  },
  {
    key: 'connectors',
    title: 'Connectors',
    description:
      'SMTP, DNS, webhook, MCP, registry, and other reusable external capability connections.',
    icon: <Plug className="h-5 w-5" />,
    href: '/resources/connectors',
    createLabel: 'Configure an external connection',
    createDescription:
      'SMTP, DNS, webhook, MCP, registry, and other reusable external connections.',
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

const SOFTWARE_DELIVERY: ResourceDef[] = [
  {
    key: 'supported-software',
    title: 'Supported Software',
    description:
      'Read-only AppOS-managed server software catalog for discovery, onboarding, and pre-connection planning.',
    icon: <Wrench className="h-5 w-5" />,
    href: '/resources/supported-software',
    readOnly: true,
    exampleItems: ['Docker', 'Nginx', 'Netdata Agent', 'AppOS Control Agent'],
    apiPath: '/api/software/server-catalog',
  },
]

const RESOURCE_SECTIONS: ResourceSection[] = [
  {
    key: 'runtime-infrastructure',
    title: 'Runtime Infrastructure',
    description:
      'Where applications run and the startup-critical dependencies they cannot run without.',
    resources: RUNTIME_INFRASTRUCTURE,
  },
  {
    key: 'shared-assets',
    title: 'Shared Assets',
    description: 'Reusable shared environment sets and scripts that support multiple applications.',
    resources: SHARED_ASSETS,
  },
  {
    key: 'software-delivery',
    title: 'Software Delivery',
    description:
      'What AppOS can manage on remote servers before any server is connected or selected.',
    resources: SOFTWARE_DELIVERY,
  },
  {
    key: 'external-integrations',
    title: 'External Integrations',
    description:
      'How platform connects to AI providers, external platforms, APIs, and cloud services.',
    resources: EXTERNAL_INTEGRATIONS,
  },
]

const ALL_RESOURCES = [
  ...RUNTIME_INFRASTRUCTURE,
  ...SHARED_ASSETS,
  ...SOFTWARE_DELIVERY,
  ...EXTERNAL_INTEGRATIONS,
]

// ─── Component ───────────────────────────────────────────

export function ResourceHub() {
  const navigate = useNavigate()
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [createChooserOpen, setCreateChooserOpen] = useState(false)

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
            Shared platform resources for where Applications run, what they depend on, and how AppOS
            connects outward.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 font-medium text-foreground/80">
              {sectionCount} grouped areas
            </span>
            <span className="rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 font-medium text-foreground/80">
              {resourceFamilyCount} canonical families
            </span>
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

          <Button className="w-full sm:w-auto" onClick={() => setCreateChooserOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Resource
            <ChevronDown className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </div>

      <Dialog open={createChooserOpen} onOpenChange={setCreateChooserOpen}>
        <DialogContent className="sm:max-w-2xl" aria-describedby={undefined}>
          <DialogHeader className="text-left">
            <DialogTitle className="text-2xl font-semibold tracking-tight">
              Add Resource
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-[70vh] space-y-6 overflow-y-auto pr-1">
            {RESOURCE_SECTIONS.map(section => (
              <section key={section.key} className="space-y-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold tracking-tight text-foreground">
                    {section.title}
                  </h3>
                  <Tooltip delayDuration={100}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
                        aria-label={`${section.title} description`}
                      >
                        <CircleQuestionMark className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs leading-5">
                      {section.description}
                    </TooltipContent>
                  </Tooltip>
                </div>

                <div className="space-y-3">
                  {section.resources.map(r =>
                    r.readOnly ? null : (
                      <button
                        key={r.key}
                        type="button"
                        onClick={() => goToCreate(r.href)}
                        className="block w-full rounded-xl border border-border/70 bg-background p-4 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                      >
                        <div className="flex min-w-0 gap-3">
                          <div className="mt-0.5 shrink-0 text-muted-foreground">{r.icon}</div>
                          <div className="min-w-0 space-y-2">
                            <div>
                              <p className="text-base font-medium leading-tight">{r.title}</p>
                              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                                {r.createDescription ?? r.description}
                              </p>
                            </div>
                            {r.exampleItems && r.exampleItems.length > 0 && (
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
                            )}
                          </div>
                        </div>
                      </button>
                    )
                  )}
                </div>
              </section>
            ))}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateChooserOpen(false)}>
              Cancel
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
              {section.title}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">{section.description}</p>
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

                    <p
                      id={`${r.key}-description`}
                      className="text-xs text-muted-foreground leading-relaxed mt-3 pl-7"
                    >
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
