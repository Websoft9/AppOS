import { useState, useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Screenshot } from '@/lib/store-types'

interface ScreenshotCarouselProps {
  screenshots: Screenshot[]
  /** Fallback screenshots (e.g. en) used when a locale URL fails to load */
  fallbackScreenshots?: Screenshot[]
  /** Section heading – only shown when at least one image loads successfully */
  label?: string
}

export function ScreenshotCarousel({ screenshots, fallbackScreenshots = [], label }: ScreenshotCarouselProps) {
  const [current, setCurrent] = useState(0)
  // Map: screenshot id -> resolved URL (primary or fallback)
  const [resolvedUrls, setResolvedUrls] = useState<Record<string, string>>(() =>
    Object.fromEntries(screenshots.map((s) => [s.id, s.value]))
  )
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set())
  const [firstLoaded, setFirstLoaded] = useState(false)

  // Reset state when screenshots change (new product selected)
  useEffect(() => {
    setCurrent(0)
    setResolvedUrls(Object.fromEntries(screenshots.map((s) => [s.id, s.value])))
    setFailedIds(new Set())
    setFirstLoaded(false)
  }, [screenshots])

  const handleFail = useCallback((id: string, failedUrl: string) => {
    // Try fallback screenshot with same key
    const thisShot = screenshots.find((s) => s.id === id)
    const fallback = fallbackScreenshots.find((s) => s.key === thisShot?.key)
    if (fallback && fallback.value !== failedUrl) {
      setResolvedUrls((prev) => ({ ...prev, [id]: fallback.value }))
    } else {
      setFailedIds((prev) => new Set(prev).add(id))
    }
  }, [screenshots, fallbackScreenshots])

  const visibleScreenshots = screenshots.filter((s) => !failedIds.has(s.id))

  if (visibleScreenshots.length === 0) return null

  const safeCurrent = Math.min(current, visibleScreenshots.length - 1)
  const total = visibleScreenshots.length

  const prev = () => setCurrent((c) => (c - 1 + total) % total)
  const next = () => setCurrent((c) => (c + 1) % total)

  return (
    <div>
      {label && <h4 className="text-sm font-semibold mb-2">{label}</h4>}
    <div className="w-[80%] mx-auto overflow-hidden rounded-lg bg-muted">
      <div className="relative" style={{ aspectRatio: '16/9' }}>
        {/* Skeleton shown until the active image loads */}
        {!firstLoaded && (
          <div className="absolute inset-0 bg-muted animate-pulse rounded-lg" />
        )}

        {visibleScreenshots.map((s, idx) => (
          <img
            key={`${s.id}-${resolvedUrls[s.id]}`}
            src={resolvedUrls[s.id] ?? s.value}
            alt={s.key}
            className={cn(
              'absolute inset-0 w-full h-full object-contain',
              idx === safeCurrent ? 'block' : 'hidden',
            )}
            referrerPolicy="no-referrer"
            onLoad={() => { if (idx === 0) setFirstLoaded(true) }}
            onError={() => handleFail(s.id, resolvedUrls[s.id] ?? s.value)}
          />
        ))}
      </div>

      {/* Navigation arrows */}
      {total > 1 && (
        <>
          <Button
            variant="outline"
            size="icon"
            className="absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 bg-background/80 backdrop-blur"
            onClick={prev}
            aria-label="Previous screenshot"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 bg-background/80 backdrop-blur"
            onClick={next}
            aria-label="Next screenshot"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>

          {/* Dots */}
          <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5">
            {visibleScreenshots.map((_, idx) => (
              <button
                key={idx}
                className={cn(
                  'w-2 h-2 rounded-full transition-colors',
                  idx === safeCurrent ? 'bg-primary' : 'bg-background/60',
                )}
                onClick={() => setCurrent(idx)}
                aria-label={`Screenshot ${idx + 1}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
    </div>
  )
}
