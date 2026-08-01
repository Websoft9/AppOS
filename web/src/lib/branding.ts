import { pb } from '@/lib/pb'
import { useEffect } from 'react'

export const BRANDING_UPDATED_EVENT = 'appos:branding-updated'
export const DEFAULT_APP_NAME = 'AppOS'
export const DEFAULT_WORDMARK = 'appos'

export interface BrandingPayload {
  appName?: string
  appURL?: string
  logoMediaId?: string
  logoUrl?: string
  loginBackgroundMediaId?: string
  loginBackgroundUrl?: string
  wordmark?: string
  description?: string
  useLogoAsFavicon?: boolean
  faviconMediaId?: string
  faviconUrl?: string
}

export interface ResolvedBranding {
  appName: string
  appURL: string
  wordmark: string
  description: string
  logoUrl: string
  loginBackgroundUrl: string
  faviconUrl: string
  useLogoAsFavicon: boolean
  generatedLogoUrl: string
}

export async function fetchBranding(): Promise<ResolvedBranding> {
  const payload = await pb.send<BrandingPayload>('/api/settings/public/branding', { method: 'GET' })
  return resolveBranding(payload)
}

export function resolveBranding(payload?: BrandingPayload | null): ResolvedBranding {
  const appName = payload?.appName?.trim() || DEFAULT_APP_NAME
  const appURL = payload?.appURL?.trim() || ''
  const wordmark = payload?.wordmark?.trim() || DEFAULT_WORDMARK
  const description = payload?.description?.trim() || 'Application Platform'
  const generatedLogoUrl = createGeneratedLogoDataUrl(wordmark || appName)
  const logoUrl = payload?.logoUrl?.trim() || generatedLogoUrl
  const loginBackgroundUrl = payload?.loginBackgroundUrl?.trim() || ''
  const useLogoAsFavicon = payload?.useLogoAsFavicon ?? false
  const faviconUrl = useLogoAsFavicon ? logoUrl : payload?.faviconUrl?.trim() || logoUrl

  return {
    appName,
    appURL,
    wordmark,
    description,
    logoUrl,
    loginBackgroundUrl,
    faviconUrl,
    useLogoAsFavicon,
    generatedLogoUrl,
  }
}

export function dispatchBrandingUpdated(payload: BrandingPayload) {
  window.dispatchEvent(
    new CustomEvent<BrandingPayload>(BRANDING_UPDATED_EVENT, { detail: payload })
  )
}

function createGeneratedLogoDataUrl(source: string) {
  const label = createMonogram(source)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="${escapeXml(label)}"><rect width="64" height="64" rx="16" fill="#111827"/><rect x="4" y="4" width="56" height="56" rx="12" fill="#2563eb"/><text x="32" y="40" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#ffffff">${escapeXml(label)}</text></svg>`
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

function createMonogram(source: string) {
  const parts = source.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
  }
  return (
    source
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 2)
      .toUpperCase() || 'AO'
  )
}

function escapeXml(value: string) {
  return value.replace(/[<>&"']/g, char => {
    switch (char) {
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '&':
        return '&amp;'
      case '"':
        return '&quot;'
      case "'":
        return '&#39;'
      default:
        return char
    }
  })
}

// ─── Page title ──────────────────────────────────────────────────────────────

let pageTitle = ''
const titleListeners = new Set<() => void>()

/** Set the current page title segment.  BrandingProvider appends " - wordmark". */
export function setPageTitle(title: string) {
  pageTitle = title
  for (const listener of titleListeners) {
    listener()
  }
}

/** React hook that sets the page title for the lifetime of the component. */
export function usePageTitle(title: string) {
  useEffect(() => {
    setPageTitle(title)
    return () => setPageTitle('')
  }, [title])
}

/** Subscribe to title changes.  Returns the current title.  Internal use. */
export function subscribePageTitle(listener: () => void): string {
  titleListeners.add(listener)
  return pageTitle
}

export function unsubscribePageTitle(listener: () => void) {
  titleListeners.delete(listener)
}
