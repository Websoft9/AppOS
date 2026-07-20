import { Link } from '@tanstack/react-router'
import { useBranding } from '@/contexts/BrandingContext'
import { cn } from '@/lib/utils'

export function Logo({ collapsed = false }: { collapsed?: boolean }) {
  const branding = useBranding()

  return (
    <Link
      to="/overview"
      className={cn(
        'flex items-center gap-2 font-bold text-foreground hover:opacity-80 transition-opacity',
        collapsed ? 'justify-center' : ''
      )}
    >
      <img
        src={branding.logoUrl}
        alt={`${branding.appName} logo`}
        className="h-8 w-8 rounded-lg object-cover"
      />
      {!collapsed && <span className="text-lg">{branding.wordmark}</span>}
    </Link>
  )
}
