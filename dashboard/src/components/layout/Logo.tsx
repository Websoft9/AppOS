import { Link } from "@tanstack/react-router"
import { cn } from "@/lib/utils"

export function Logo({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <Link
      to="/dashboard"
      className={cn(
        "flex items-center gap-2 font-bold text-foreground hover:opacity-80 transition-opacity",
        collapsed ? "justify-center" : ""
      )}
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">
        W9
      </div>
      {!collapsed && <span className="text-lg">AppOS</span>}
    </Link>
  )
}
