import { pb } from '@/lib/pb'

export const BRANDING_UPDATED_EVENT = 'appos:branding-updated'
export const DEFAULT_APP_NAME = 'AppOS'
export const DEFAULT_WORDMARK = 'appos'

export interface BrandingPayload {
  appName?: string
  appURL?: string
  logoMediaId?: string
  logoUrl?: string
  wordmark?: string
  useLogoAsFavicon?: boolean
  faviconMediaId?: string
  faviconUrl?: string
}

export interface ResolvedBranding {
  appName: string
  appURL: string
  wordmark: string
  logoUrl: string
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
  const generatedLogoUrl = createGeneratedLogoDataUrl(wordmark || appName)
  const logoUrl = payload?.logoUrl?.trim() || generatedLogoUrl
  const useLogoAsFavicon = payload?.useLogoAsFavicon ?? false
  const faviconUrl = useLogoAsFavicon ? logoUrl : payload?.faviconUrl?.trim() || logoUrl

  return {
    appName,
    appURL,
    wordmark,
    logoUrl,
    faviconUrl,
    useLogoAsFavicon,
    generatedLogoUrl,
  }
}

export function dispatchBrandingUpdated(payload: BrandingPayload) {
  window.dispatchEvent(new CustomEvent<BrandingPayload>(BRANDING_UPDATED_EVENT, { detail: payload }))
}

function createGeneratedLogoDataUrl(source: string) {
  const label = createMonogram(source)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="${escapeXml(label)}"><rect width="64" height="64" rx="16" fill="#111827"/><rect x="4" y="4" width="56" height="56" rx="12" fill="#2563eb"/><text x="32" y="40" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#ffffff">${escapeXml(label)}</text></svg>`
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

function createMonogram(source: string) {
  const parts = source
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
  }
  return source.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || 'AO'
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