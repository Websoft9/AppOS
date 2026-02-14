import { cn } from "@/lib/utils"

interface ContentAreaProps {
  children: React.ReactNode
  className?: string
}

export function ContentArea({ children, className }: ContentAreaProps) {
  return (
    <main
      className={cn("overflow-y-auto p-6", className)}
      style={{ gridArea: "content" }}
    >
      {children}
    </main>
  )
}
