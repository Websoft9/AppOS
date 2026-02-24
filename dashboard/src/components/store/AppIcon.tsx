import { useState } from 'react'
import { cn } from '@/lib/utils'
import { getKeyColor } from '@/lib/store-api'

interface AppIconProps {
  appKey: string
  trademark: string
  logoUrl?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

const sizeClasses = {
  sm: 'w-8 h-8 text-sm',
  md: 'w-12 h-12 text-lg',
  lg: 'w-16 h-16 text-2xl',
  xl: 'w-20 h-20 text-3xl',
}

export function AppIcon({ appKey, trademark, logoUrl, size = 'md', className }: AppIconProps) {
  const [imgError, setImgError] = useState(false)
  const firstLetter = trademark.charAt(0).toUpperCase()
  const bgColor = getKeyColor(appKey)

  if (!logoUrl || imgError) {
    return (
      <div
        className={cn(
          'rounded-lg flex items-center justify-center text-white font-bold select-none flex-shrink-0',
          sizeClasses[size],
          className,
        )}
        style={{ backgroundColor: bgColor }}
        aria-label={trademark}
        role="img"
      >
        {firstLetter}
      </div>
    )
  }

  return (
    <img
      src={logoUrl}
      alt={trademark}
      className={cn('rounded-lg object-contain flex-shrink-0', sizeClasses[size], className)}
      referrerPolicy="no-referrer"
      onError={() => setImgError(true)}
    />
  )
}
