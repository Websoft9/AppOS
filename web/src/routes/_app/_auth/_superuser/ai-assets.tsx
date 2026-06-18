import { useEffect, useMemo, useState } from 'react'
import { Link, Outlet, createFileRoute, useLocation, useNavigate } from '@tanstack/react-router'
import { Bot, ChevronRight, FileCode2, Loader2, Plus, ScrollText } from 'lucide-react'
import { listAssets, type AssetKind } from '@/lib/assets-api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type AssetFamilyCardDef = {
  key: AssetKind
  title: string
  description: string
  href: string
  icon: React.ReactNode
}

const ASSET_FAMILY_CARDS: AssetFamilyCardDef[] = [
  {
    key: 'prompt',
    title: 'AI Prompts',
    description: 'Reusable system prompts and task instructions for AI Copilot and operators.',
    href: '/ai-assets/prompts',
    icon: <Bot className="h-5 w-5" />,
  },
  {
    key: 'skill',
    title: 'AI Skills',
    description:
      'Bundled skill packages with structured files, entrypoints, and reusable guidance content.',
    href: '/ai-assets/skills',
    icon: <ScrollText className="h-5 w-5" />,
  },
  {
    key: 'script',
    title: 'Scripts',
    description:
      'Reusable single-file assets for terminal snippets, operator workflows, and recovery actions.',
    href: '/ai-assets/scripts',
    icon: <FileCode2 className="h-5 w-5" />,
  },
]

export function AssetsPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [items, setItems] = useState<Array<{ kind: AssetKind }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const isListRoute = location.pathname === '/ai-assets' || location.pathname === '/ai-assets/'

  async function loadAssets() {
    setLoading(true)
    setError('')
    try {
      const next = await listAssets()
      setItems(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load assets.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAssets()
  }, [])

  const scriptCount = useMemo(() => items.filter(item => item.kind === 'script').length, [items])
  const skillCount = useMemo(() => items.filter(item => item.kind === 'skill').length, [items])
  const promptCount = useMemo(() => items.filter(item => item.kind === 'prompt').length, [items])

  if (!isListRoute) {
    return <Outlet />
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Assets</h1>
          <p className="mt-1 text-muted-foreground">
            Reusable technical definitions shared across operators, terminal workflows, and future
            automation.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 font-medium text-foreground/80">
              {ASSET_FAMILY_CARDS.length} canonical families
            </span>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Asset
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() =>
                navigate({ to: '/ai-assets/scripts' as never, search: { create: '1' } as never })
              }
            >
              Add Script
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                navigate({ to: '/ai-assets/skills' as never, search: { create: '1' } as never })
              }
            >
              Add AI Skill
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                navigate({ to: '/ai-assets/prompts' as never, search: { create: '1' } as never })
              }
            >
              Add AI Prompt
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {error ? <div className="text-sm text-destructive">{error}</div> : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {ASSET_FAMILY_CARDS.map(family => {
          const count =
            family.key === 'script' ? scriptCount : family.key === 'skill' ? skillCount : promptCount
          return (
            <Link
              key={family.key}
              to={family.href as never}
              params={{} as never}
              search={{} as never}
              className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              aria-describedby={`${family.key}-description ${family.key}-meta`}
            >
              <Card className="h-full border-border/70 transition-all duration-150 group-hover:-translate-y-0.5 group-hover:border-primary/40 group-hover:shadow-md group-focus-visible:border-primary/60 group-focus-visible:shadow-md group-focus-visible:shadow-primary/10">
                <CardContent className="px-4 py-3 sm:px-5 sm:py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="shrink-0 rounded-md bg-muted p-1 text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary group-focus-visible:bg-primary/10 group-focus-visible:text-primary">
                        {family.icon}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium leading-tight">{family.title}</p>
                        <p
                          id={`${family.key}-meta`}
                          className="mt-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
                        >
                          {loading ? (
                            <>
                              <Loader2 className="h-3 w-3 animate-spin" />
                              <span>Refreshing count</span>
                            </>
                          ) : (
                            <span>{count} items</span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 rounded-full border border-border/70 px-2 py-1 text-[11px] font-medium text-foreground/80">
                      <span>Open family</span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-colors transition-transform group-hover:translate-x-0.5 group-hover:text-foreground group-focus-visible:translate-x-0.5 group-focus-visible:text-foreground" />
                    </div>
                  </div>

                  <p
                    id={`${family.key}-description`}
                    className="mt-3 pl-7 text-xs leading-relaxed text-muted-foreground"
                  >
                    {family.description}
                  </p>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_app/_auth/_superuser/ai-assets' as never)({
  component: AssetsPage,
})
