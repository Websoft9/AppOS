import { useState, useEffect } from 'react'
import { useNavigate, Link } from '@tanstack/react-router'
import {
  Server,
  Database,
  Cloud,
  Plug,
  FileCode,
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// ─── Resource definitions ────────────────────────────────

interface ResourceDef {
  key: string
  title: string
  description: string
  icon: React.ReactNode
  href: string
  apiPath?: string
  countQuery?: {
    collection: string
    filter?: string
  }
}

const RESOURCES: ResourceDef[] = [
  {
    key: 'servers',
    title: 'Servers',
    description: 'SSH deployment targets',
    icon: <Server className="h-5 w-5" />,
    href: '/resources/servers',
    countQuery: { collection: 'servers' },
  },
  {
    key: 'databases',
    title: 'Databases',
    description: 'External DB connections',
    icon: <Database className="h-5 w-5" />,
    href: '/resources/databases',
    apiPath: '/api/ext/resources/databases',
  },
  {
    key: 'cloud-accounts',
    title: 'Cloud Accounts',
    description: 'AWS, GCP, Aliyun…',
    icon: <Cloud className="h-5 w-5" />,
    href: '/resources/cloud-accounts',
    apiPath: '/api/ext/resources/cloud-accounts',
  },

  {
    key: 'endpoints',
    title: 'Endpoints',
    description: 'APIs, webhooks & MCP endpoints',
    icon: <Plug className="h-5 w-5" />,
    href: '/resources/endpoints',
    apiPath: '/api/endpoints',
  },
  {
    key: 'scripts',
    title: 'Scripts',
    description: 'Automation scripts',
    icon: <FileCode className="h-5 w-5" />,
    href: '/resources/scripts',
    apiPath: '/api/ext/resources/scripts',
  },
]

// ─── Component ───────────────────────────────────────────

export function ResourceHub() {
  const navigate = useNavigate()
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const promises = RESOURCES.map(r => {
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
            Infrastructure your apps depend on to deploy and run
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
            <DropdownMenuContent align="end" className="w-48">
              {RESOURCES.map(r => (
                <DropdownMenuItem
                  key={r.key}
                  onClick={() => goToCreate(r.href)}
                  className="gap-2 cursor-pointer"
                >
                  {r.icon}
                  {r.title}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {RESOURCES.map(r => (
          <Card
            key={r.key}
            className="cursor-pointer transition-shadow hover:shadow-md group"
            onClick={() => navigate({ to: r.href as never })}
          >
            <CardContent className="px-4 py-3">
              {/* Icon + Title(n) + Arrow */}
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

              {/* Description */}
              <p className="text-xs text-muted-foreground leading-tight mt-2 pl-7">
                {r.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
