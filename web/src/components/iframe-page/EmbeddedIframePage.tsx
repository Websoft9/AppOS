import { useEffect, useState } from 'react'
import { ExternalLink, Loader2, TriangleAlert } from 'lucide-react'
import { useOptionalLayout } from '@/contexts/LayoutContext'
import { IframePageBreadcrumb } from './IframePageBreadcrumb'

export type EmbeddedIframeAccessMode = 'proxied'
export type EmbeddedIframeAuthStrategy =
  | 'none'
  | 'session-bridge'
  | 'token-handshake'
  | 'future-sso'

export interface EmbeddedIframePageDefinition {
  id: string
  title: string
  routePath: string
  proxyPath: string
  parentLabel: string
  accessMode: EmbeddedIframeAccessMode
  authStrategy: EmbeddedIframeAuthStrategy
  description?: string
  fallbackBehavior?: string
}

type ProbeState = { status: 'loading' } | { status: 'ready' } | { status: 'error'; message: string }

export function EmbeddedIframePage({ page }: { page: EmbeddedIframePageDefinition }) {
  const layout = useOptionalLayout()
  const setHeaderRightStartContent = layout?.setHeaderRightStartContent
  const [probeState, setProbeState] = useState<ProbeState>({ status: 'loading' })

  useEffect(() => {
    if (!setHeaderRightStartContent) {
      return undefined
    }
    setHeaderRightStartContent(
      <IframePageBreadcrumb parentLabel={page.parentLabel} currentPage={page.title} />
    )
    return () => setHeaderRightStartContent(null)
  }, [page.parentLabel, page.title, setHeaderRightStartContent])

  useEffect(() => {
    const controller = new AbortController()
    setProbeState({ status: 'loading' })

    void fetch(page.proxyPath, {
      method: 'GET',
      signal: controller.signal,
      credentials: 'same-origin',
    })
      .then(async response => {
        if (response.ok) {
          setProbeState({ status: 'ready' })
          return
        }
        let detail = `Target returned ${response.status}`
        try {
          const text = (await response.text()).trim()
          if (text) {
            detail = text.slice(0, 180)
          }
        } catch {
          // Ignore body parsing errors and use status-derived detail.
        }
        setProbeState({ status: 'error', message: detail })
      })
      .catch(error => {
        if (controller.signal.aborted) {
          return
        }
        const message = error instanceof Error ? error.message : 'Embedded page probe failed'
        setProbeState({ status: 'error', message })
      })

    return () => controller.abort()
  }, [page.proxyPath])

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{page.title}</h1>
          <p className="text-sm text-muted-foreground">
            {page.description ??
              'Embedded external page rendered through an AppOS-owned proxy route.'}
          </p>
        </div>
        <a
          href={page.proxyPath}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
        >
          <ExternalLink className="h-4 w-4" />
          Open Proxied Page
        </a>
      </div>

      {probeState.status === 'loading' ? (
        <div className="flex min-h-[70vh] items-center justify-center rounded-xl border bg-background shadow-sm">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Checking embedded page availability...</span>
          </div>
        </div>
      ) : null}

      {probeState.status === 'error' ? (
        <div className="flex min-h-[70vh] items-center justify-center rounded-xl border bg-background shadow-sm">
          <div className="mx-auto flex max-w-xl flex-col items-center gap-4 px-6 text-center">
            <TriangleAlert className="h-10 w-10 text-amber-600" />
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Embedded page unavailable</h2>
              <p className="text-sm text-muted-foreground">{probeState.message}</p>
              {page.fallbackBehavior ? (
                <p className="text-xs text-muted-foreground">Fallback: {page.fallbackBehavior}</p>
              ) : null}
            </div>
            <a
              href={page.proxyPath}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
            >
              <ExternalLink className="h-4 w-4" />
              Open In New Window
            </a>
          </div>
        </div>
      ) : null}

      {probeState.status === 'ready' ? (
        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border bg-background shadow-sm">
          <iframe
            title={page.title}
            src={page.proxyPath}
            className="h-full min-h-[70vh] w-full border-0"
          />
        </div>
      ) : null}
    </div>
  )
}
