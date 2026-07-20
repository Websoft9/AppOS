import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type RefreshButtonProps = {
  onClick: () => void
  title?: string
  ariaLabel?: string
  spinning?: boolean
  chrome?: 'boxed' | 'plain'
  className?: string
  disabled?: boolean
}

export function RefreshButton({
  onClick,
  title = 'Refresh',
  ariaLabel,
  spinning = false,
  chrome = 'boxed',
  className,
  disabled = false,
}: RefreshButtonProps) {
  return (
    <Button
      type="button"
      variant={chrome === 'boxed' ? 'outline' : 'ghost'}
      size="icon"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel ?? title}
      className={className}
      disabled={disabled}
    >
      <RefreshCw className={cn('h-4 w-4', spinning && 'animate-spin')} />
    </Button>
  )
}
