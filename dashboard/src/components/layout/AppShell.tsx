import { Outlet } from "@tanstack/react-router"
import { TooltipProvider } from "@/components/ui/tooltip"
import { LayoutProvider, useLayout } from "@/contexts/LayoutContext"
import { Header } from "./Header"
import { Sidebar } from "./Sidebar"
import { ContentArea } from "./ContentArea"
import { Bottom } from "./Bottom"
import { cn } from "@/lib/utils"

interface AppShellProps {
  /** Right-side header actions (e.g. UserMenu from Epic 3) */
  headerActions?: React.ReactNode
}

function AppShellInner({ headerActions }: AppShellProps) {
  const { sidebarCollapsed, isDesktop, setBottomExpanded } = useLayout()

  return (
    <div
      className={cn(
        "grid min-h-screen bg-background",
        isDesktop
          ? "grid-cols-[var(--sidebar-width)_1fr] grid-rows-[var(--header-height)_1fr_auto]"
          : "grid-cols-[1fr] grid-rows-[var(--header-height-mobile)_1fr_auto]"
      )}
      style={{
        gridTemplateAreas: isDesktop
          ? `"header header" "sidebar content" "sidebar bottom"`
          : `"header" "content" "bottom"`,
        ...(isDesktop && sidebarCollapsed
          ? { gridTemplateColumns: "var(--sidebar-width-collapsed) 1fr" }
          : {}),
      }}
      onClick={(e) => {
        // Close bottom panel when clicking outside of it
        const target = e.target as HTMLElement
        if (!target.closest("[data-slot='bottom']")) {
          setBottomExpanded(false)
        }
      }}
    >
      <Header actions={headerActions} />
      <Sidebar />
      <ContentArea>
        <Outlet />
      </ContentArea>
      <Bottom />
    </div>
  )
}

export function AppShell(props: AppShellProps) {
  return (
    <TooltipProvider>
      <LayoutProvider>
        <AppShellInner {...props} />
      </LayoutProvider>
    </TooltipProvider>
  )
}
