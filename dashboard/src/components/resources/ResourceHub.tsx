import { useState, useEffect } from 'react'
import { useNavigate, Link } from '@tanstack/react-router'
import {
  Server,
  Database,
  Cloud,
  Plug,
  Plus,
  ChevronDown,
  Loader2,
  ChevronRight,
  Layers,
} from 'lucide-react'
import { pb } from '@/lib/pb'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// ─── Resource definitions ────────────────────────────────

interface ResourceDef {
  key: string
  title: string
  description: string
  icon: React.ReactNode
  href: string
  createLabel?: string
  createDescription?: string
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

const HOST_INFRASTRUCTURE: ResourceDef[] = [
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
]

const DEPENDENCY_INFRASTRUCTURE: ResourceDef[] = [
  {
    key: 'service-instances',
    title: 'Service Instances',
    description:
      'MySQL, PostgreSQL, Redis, Kafka, S3 storage, and model services your apps depend on.',
    icon: <Database className="h-5 w-5" />,
    href: '/resources/service-instances',
    createLabel: 'Register an application dependency',
    createDescription: 'MySQL, PostgreSQL, Redis, Kafka, S3 storage, and model services.',
    apiPath: '/api/instances',
  },
  {
    key: 'connectors',
    title: 'Connectors',
    description: 'OpenAI, SMTP, DNS, webhook, MCP, and registry connections AppOS uses outward.',
    icon: <Plug className="h-5 w-5" />,
    href: '/resources/connectors',
    createLabel: 'Configure an external connection',
    createDescription: 'OpenAI, SMTP, DNS, webhook, MCP, and registry connections.',
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
    apiPath: '/api/provider-accounts',
  },
]

const RESOURCE_SECTIONS: ResourceSection[] = [
  {
    key: 'host-infrastructure',
    title: 'Host Infrastructure',
    description: 'Where workloads run and where host-level operations happen.',
    resources: HOST_INFRASTRUCTURE,
  },
  {
    key: 'dependency-infrastructure',
    title: 'Dependency Infrastructure',
    description: 'Long-lived dependencies, external connections, and the identities behind them.',
    resources: DEPENDENCY_INFRASTRUCTURE,
  },
]

const CREATE_RESOURCES = [...HOST_INFRASTRUCTURE, ...DEPENDENCY_INFRASTRUCTURE]
const ALL_RESOURCES = [...HOST_INFRASTRUCTURE, ...DEPENDENCY_INFRASTRUCTURE]

// ─── Component ───────────────────────────────────────────

export function ResourceHub() {
  const navigate = useNavigate()
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

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
    navigate({ to: href as never, search: { create: '1' } as never })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Resources</h1>
          <p className="text-muted-foreground mt-1">
            Shared infrastructure for where workloads run, what they depend on, and how AppOS
            connects outward.
          </p>
        </div>

        {/* Hub actions */}
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link to="/groups">
              <Layers className="h-4 w-4 mr-2" />
              Resource Groups
            </Link>
          </Button>

          {/* Global quick-create */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Resource
                <ChevronDown className="h-4 w-4 ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Canonical families
              </DropdownMenuLabel>
              {CREATE_RESOURCES.map(r => (
                <DropdownMenuItem
                  key={r.key}
                  onClick={() => goToCreate(r.href)}
                  className="cursor-pointer items-start gap-3"
                >
                  {r.icon}
                  <div className="min-w-0">
                    <div className="font-medium leading-tight">{r.createLabel ?? r.title}</div>
                    <div className="text-muted-foreground text-xs leading-tight mt-1">
                      {r.createDescription ?? r.title}
                    </div>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {RESOURCE_SECTIONS.map(section => (
        <section key={section.key} className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{section.title}</h2>
            <p className="text-sm text-muted-foreground mt-1">{section.description}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {section.resources.map(r => (
              <Card
                key={r.key}
                className="cursor-pointer transition-shadow hover:shadow-md group"
                onClick={() => navigate({ to: r.href as never })}
              >
                <CardContent className="px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="p-1 rounded-md bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors shrink-0">
                        {r.icon}
                      </div>
                      <p className="text-sm font-medium leading-tight truncate">
                        {r.title}
                        {!loading && (
                          <span className="ml-2 text-muted-foreground font-medium">
                            ({counts[r.key] ?? 0})
                          </span>
                        )}
                        {loading && (
                          <span className="ml-2 inline-flex">
                            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                          </span>
                        )}
                      </p>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors shrink-0 ml-1" />
                  </div>

                  <p className="text-xs text-muted-foreground leading-tight mt-2 pl-7">
                    {r.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
