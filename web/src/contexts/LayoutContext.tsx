import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMediaQuery } from '@/hooks/use-media-query'

const SIDEBAR_STORAGE_KEY = 'sidebar-collapsed'

interface LayoutContextValue {
  // Sidebar
  sidebarCollapsed: boolean
  sidebarOpen: boolean // mobile drawer
  toggleSidebar: () => void
  setSidebarCollapsed: (v: boolean) => void
  setSidebarOpen: (v: boolean) => void
  // Bottom
  bottomExpanded: boolean
  toggleBottom: () => void
  setBottomExpanded: (v: boolean) => void
  // Responsive
  isMobile: boolean
  isTablet: boolean
  isDesktop: boolean
  // Header slots
  headerRightStartContent: ReactNode | null
  setHeaderRightStartContent: (content: ReactNode | null) => void
}

const LayoutContext = createContext<LayoutContextValue | null>(null)

export function LayoutProvider({ children }: { children: ReactNode }) {
  const isMobile = useMediaQuery('(max-width: 767px)')
  const isTablet = useMediaQuery('(min-width: 768px) and (max-width: 1023px)')
  const isDesktop = useMediaQuery('(min-width: 1024px)')

  const [sidebarCollapsed, setSidebarCollapsedState] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true'
  })
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [bottomExpanded, setBottomExpanded] = useState(false)
  const [headerRightStartContent, setHeaderRightStartContent] = useState<ReactNode | null>(null)

  // Persist sidebar collapsed state
  const setSidebarCollapsed = useCallback((v: boolean) => {
    setSidebarCollapsedState(v)
    localStorage.setItem(SIDEBAR_STORAGE_KEY, String(v))
  }, [])

  const toggleSidebar = useCallback(() => {
    if (isMobile || isTablet) {
      setSidebarOpen(prev => !prev)
    } else {
      setSidebarCollapsedState(prev => {
        const next = !prev
        localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next))
        return next
      })
    }
  }, [isMobile, isTablet])

  const toggleBottom = useCallback(() => {
    setBottomExpanded(prev => !prev)
  }, [])

  // Close mobile drawer when switching to desktop
  useEffect(() => {
    if (isDesktop) setSidebarOpen(false)
  }, [isDesktop])

  const contextValue = useMemo(
    () => ({
      sidebarCollapsed,
      sidebarOpen,
      toggleSidebar,
      setSidebarCollapsed,
      setSidebarOpen,
      bottomExpanded,
      toggleBottom,
      setBottomExpanded,
      isMobile,
      isTablet,
      isDesktop,
      headerRightStartContent,
      setHeaderRightStartContent,
    }),
    [
      sidebarCollapsed,
      sidebarOpen,
      toggleSidebar,
      setSidebarCollapsed,
      bottomExpanded,
      toggleBottom,
      isMobile,
      isTablet,
      isDesktop,
      headerRightStartContent,
    ]
  )

  return (
    <LayoutContext.Provider value={contextValue}>
      {children}
    </LayoutContext.Provider>
  )
}

export function useLayout() {
  const ctx = useContext(LayoutContext)
  if (!ctx) throw new Error('useLayout must be used within LayoutProvider')
  return ctx
}

export function useOptionalLayout() {
  return useContext(LayoutContext)
}
