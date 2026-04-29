import { useCallback, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { RefreshCw } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  getSupportedServerSoftware,
  listSupportedServerSoftware,
  type SupportedServerSoftwareEntry,
} from '@/lib/software-api'
import { preloadSoftwareLogos, SoftwareLogo } from './software-logos'

function capabilityLabel(capability?: string): string {
  if (!capability) return 'Unmapped'
  return capability.replaceAll('_', ' ')
}

export function SupportedSoftwarePage() {
  const [items, setItems] = useState<SupportedServerSoftwareEntry[]>([])
  const [selected, setSelected] = useState<SupportedServerSoftwareEntry | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [error, setError] = useState('')

  const loadCatalog = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const summaries = await listSupportedServerSoftware()
      setItems(summaries)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load supported software catalog')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadCatalog()
  }, [loadCatalog])

  useEffect(() => {
    preloadSoftwareLogos(items)
  }, [items])

  async function selectComponent(componentKey: string) {
    setError('')
    setDetailLoading(true)
    setDetailOpen(true)
    try {
      setSelected(await getSupportedServerSoftware(componentKey))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load supported software detail')
      setDetailOpen(false)
    } finally {
      setDetailLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link
          to="/resources"
          search={{} as never}
          className="inline-flex text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          &lt; Resources
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Supported Software</h1>
            <p className="mt-1 text-muted-foreground">
              Pick a software family to inspect what AppOS can deliver to connected servers.
            </p>
          </div>
          <Button
            variant="outline"
            size="icon"
            aria-label="Refresh supported software"
            title="Refresh"
            onClick={() => void loadCatalog()}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading && items.length === 0 ? (
        <div className="text-sm text-muted-foreground">Loading supported software…</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          No supported server software entries are available.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Capability</TableHead>
              <TableHead>Template</TableHead>
              <TableHead>Supported Actions</TableHead>
              <TableHead className="w-[96px] text-right">Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map(item => (
              <TableRow key={item.component_key}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <SoftwareLogo componentKey={item.component_key} label={item.label} />
                    <div>
                      <div className="font-medium text-foreground">{item.label}</div>
                      <div className="text-xs text-muted-foreground">{item.component_key}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>{capabilityLabel(item.capability)}</TableCell>
                <TableCell>
                  <Badge variant="secondary" className="text-xs uppercase">
                    {item.template_kind}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    {item.supported_actions.map(action => (
                      <Badge key={action} variant="outline" className="text-xs uppercase">
                        {action}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void selectComponent(item.component_key)}
                  >
                    Detail
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent side="right" className="w-full sm:max-w-xl">
          <SheetHeader>
            <div className="flex items-start gap-3 pr-8">
              {selected ? (
                <SoftwareLogo
                  componentKey={selected.component_key}
                  label={selected.label}
                  className="size-14 rounded-3xl"
                />
              ) : null}
              <div className="space-y-1">
                <SheetTitle>{selected?.label ?? 'Supported Software Detail'}</SheetTitle>
                <SheetDescription>
                  Read-only delivery metadata for the selected supported software entry.
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <div className="space-y-4 px-4 pb-4 text-sm">
            {detailLoading ? (
              <div className="text-muted-foreground">Loading detail…</div>
            ) : selected ? (
              <>
                <div>
                  <div className="text-muted-foreground">{selected.component_key}</div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-xs uppercase text-muted-foreground">Mapped capability</div>
                    <div>{capabilityLabel(selected.capability)}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase text-muted-foreground">Template kind</div>
                    <div>{selected.template_kind}</div>
                  </div>
                  <div className="sm:col-span-2">
                    <div className="text-xs uppercase text-muted-foreground">Supported actions</div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {selected.supported_actions.map(action => (
                        <Badge key={action} variant="outline" className="text-xs uppercase">
                          {action}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/30 p-4 leading-6 text-muted-foreground">
                  {selected.description}
                </div>
              </>
            ) : (
              <div className="text-muted-foreground">
                Select a supported software entry to inspect its delivery metadata.
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
