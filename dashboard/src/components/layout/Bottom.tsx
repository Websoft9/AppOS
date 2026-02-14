import {
  CircleCheck,
  CircleAlert,
  Bell,
  HelpCircle,
  BookOpen,
  ChevronUp,
  ChevronDown,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useLayout } from "@/contexts/LayoutContext"
import { cn } from "@/lib/utils"

interface BottomProps {
  /** Override connection status. Default: true (connected placeholder) */
  connected?: boolean
  /** Notification count */
  notificationCount?: number
}

export function Bottom({ connected = true, notificationCount = 0 }: BottomProps) {
  const { bottomExpanded, toggleBottom, setBottomExpanded } = useLayout()

  return (
    <footer
      data-slot="bottom"
      className={cn(
        "border-t bg-background transition-[height] duration-150 ease-out overflow-hidden",
        bottomExpanded ? "h-[var(--bottom-height-expanded)]" : "h-[var(--bottom-height)]"
      )}
      style={{ gridArea: "bottom" }}
    >
      {/* Main bar */}
      <div className="flex items-center justify-between h-[var(--bottom-height)] px-4 text-xs text-muted-foreground">
        {/* Left: Status */}
        <div className="flex items-center gap-1.5">
          {connected ? (
            <>
              <CircleCheck className="h-3.5 w-3.5 text-green-500" />
              <span>Connected</span>
            </>
          ) : (
            <>
              <CircleAlert className="h-3.5 w-3.5 text-destructive" />
              <span>Disconnected</span>
            </>
          )}
        </div>

        {/* Center: Notifications */}
        <button
          className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          onClick={toggleBottom}
          aria-label={bottomExpanded ? "Collapse notifications" : "Expand notifications"}
          aria-expanded={bottomExpanded}
        >
          <Bell className="h-3.5 w-3.5" />
          {notificationCount > 0 && (
            <Badge variant="secondary" className="h-4 px-1 text-[10px]">
              {notificationCount}
            </Badge>
          )}
          {bottomExpanded
            ? <ChevronDown className="h-3 w-3" />
            : <ChevronUp className="h-3 w-3" />
          }
        </button>

        {/* Right: Quick actions */}
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-6 w-6" asChild>
            <a href="https://www.websoft9.com/docs" target="_blank" rel="noopener noreferrer" aria-label="Documentation">
              <BookOpen className="h-3.5 w-3.5" />
            </a>
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" asChild>
            <a href="https://www.websoft9.com/docs/faq" target="_blank" rel="noopener noreferrer" aria-label="Help">
              <HelpCircle className="h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </div>

      {/* Expanded notification panel */}
      {bottomExpanded && (
        <div
          className="border-t px-4 py-3 text-sm overflow-y-auto"
          style={{ height: "calc(var(--bottom-height-expanded) - var(--bottom-height))" }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium text-foreground">Notifications</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => setBottomExpanded(false)}
            >
              Close
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">No notifications</p>
        </div>
      )}
    </footer>
  )
}
