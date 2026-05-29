import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  BRANDING_UPDATED_EVENT,
  DEFAULT_APP_NAME,
  fetchBranding,
  resolveBranding,
  type BrandingPayload,
  type ResolvedBranding,
} from '@/lib/branding'

const fallbackBranding = resolveBranding({ appName: DEFAULT_APP_NAME })

const BrandingContext = createContext<ResolvedBranding>(fallbackBranding)

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<ResolvedBranding>(fallbackBranding)

  useEffect(() => {
    let active = true

    void fetchBranding()
      .then(data => {
        if (active) {
          setBranding(data)
        }
      })
      .catch(() => {
        if (active) {
          setBranding(fallbackBranding)
        }
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const handleUpdate = (event: Event) => {
      const customEvent = event as CustomEvent<BrandingPayload>
      setBranding(current => resolveBranding({ ...current, ...customEvent.detail }))
    }

    window.addEventListener(BRANDING_UPDATED_EVENT, handleUpdate)
    return () => window.removeEventListener(BRANDING_UPDATED_EVENT, handleUpdate)
  }, [])

  useEffect(() => {
    document.title = branding.appName

    const existing = document.querySelector("link[rel='icon']") as HTMLLinkElement | null
    const icon = existing ?? document.createElement('link')
    icon.rel = 'icon'
    icon.href = branding.faviconUrl
    if (!existing) {
      document.head.appendChild(icon)
    }
  }, [branding.appName, branding.faviconUrl])

  const value = useMemo(() => branding, [branding])
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>
}

export function useBranding() {
  return useContext(BrandingContext)
}