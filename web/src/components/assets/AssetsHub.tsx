import { Link, useNavigate } from '@tanstack/react-router'
import { ChevronRight, FileCode2, Loader2, PackageOpen, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { pb } from '@/lib/pb'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface AssetFamily {
  key: string
  title: string
  description: string
  href: string
  icon: React.ReactNode
  loadCount: () => Promise<number>
}

const ASSET_FAMILIES: AssetFamily[] = [
  {
    key: 'scripts',
    title: 'Scripts',
    description: 'Reusable automation scripts for operations, recovery steps, and repeatable tasks.',
    href: '/assets/scripts',
    icon: <FileCode2 className="h-5 w-5" />,
    loadCount: async () => {
      const data = await pb.send<unknown[]>('/api/ext/resources/scripts', {})
      return Array.isArray(data) ? data.length : 0
    },
  },
]

export function AssetsHub() {
  const navigate = useNavigate()
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const promises = ASSET_FAMILIES.map(async item => ({
      key: item.key,
      count: await item.loadCount().catch(() => 0),
    }))

    Promise.allSettled(promises).then(results => {
      const nextCounts: Record<string, number> = {}
      for (const result of results) {
        if (result.status === 'fulfilled') nextCounts[result.value.key] = result.value.count
      }
      setCounts(nextCounts)
      setLoading(false)
    })
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Assets</h1>
          <p className="mt-1 text-muted-foreground">
            Reusable technical definitions shared across operators, terminal workflows, and future automation.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 font-medium text-foreground/80">
              1 grouped area
            </span>
            <span className="rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 font-medium text-foreground/80">
              {ASSET_FAMILIES.length} live family
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row md:justify-end">
          <Button
            className="w-full sm:w-auto"
            onClick={() => navigate({ to: '/assets/scripts' as never, search: { create: '1' } as never })}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Asset
          </Button>
        </div>
      </div>

      <section className="space-y-4 rounded-2xl bg-card/40 p-4 sm:p-5" aria-labelledby="assets-title">
        <div>
          <h2 id="assets-title" className="text-lg font-semibold tracking-tight">
            Technical Assets
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Shared technical definitions that consumer domains can reference without taking over asset ownership.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {ASSET_FAMILIES.map(item => (
            <Link
              key={item.key}
              to={item.href as never}
              params={{} as never}
              search={{} as never}
              className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              aria-describedby={`${item.key}-description ${item.key}-meta`}
            >
              <Card className="h-full border-border/70 transition-all duration-150 group-hover:-translate-y-0.5 group-hover:border-primary/40 group-hover:shadow-md group-focus-visible:border-primary/60 group-focus-visible:shadow-md group-focus-visible:shadow-primary/10">
                <CardContent className="px-4 py-3 sm:px-5 sm:py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="shrink-0 rounded-md bg-muted p-1 text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary group-focus-visible:bg-primary/10 group-focus-visible:text-primary">
                        {item.icon}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium leading-tight">{item.title}</p>
                        <p
                          id={`${item.key}-meta`}
                          className="mt-1 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
                        >
                          {loading ? (
                            <>
                              <Loader2 className="h-3 w-3 animate-spin" />
                              <span>Refreshing count</span>
                            </>
                          ) : (
                            <span>{counts[item.key] ?? 0} items</span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 rounded-full border border-border/70 px-2 py-1 text-[11px] font-medium text-foreground/80">
                      <span>Open family</span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-colors transition-transform group-hover:translate-x-0.5 group-hover:text-foreground group-focus-visible:translate-x-0.5 group-focus-visible:text-foreground" />
                    </div>
                  </div>

                  <p id={`${item.key}-description`} className="mt-3 pl-7 text-xs leading-relaxed text-muted-foreground">
                    {item.description}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <div className="flex items-start gap-3 rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          <PackageOpen className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Scripts land first. Skills and other asset families can join this surface as the Epic 30 backend contract expands.
          </p>
        </div>
      </section>
    </div>
  )
}