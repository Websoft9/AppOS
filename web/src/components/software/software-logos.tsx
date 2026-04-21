import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

type SoftwareLogoItem = {
  component_key: string
  label: string
}

type ResolvedSoftwareLogo = {
  primarySrc?: string
  fallbackSrc: string
}

const KNOWN_SOFTWARE_LOGOS: Record<string, string> = {
  docker: '/software-logos/docker.svg',
  'reverse-proxy': '/software-logos/reverse-proxy.svg',
}

const LOGO_ACCENTS = [
  ['#0f766e', '#14b8a6'],
  ['#1d4ed8', '#38bdf8'],
  ['#7c3aed', '#f59e0b'],
  ['#be123c', '#fb7185'],
  ['#0f172a', '#475569'],
  ['#166534', '#4ade80'],
] as const

const preloadCache = new Set<string>()

function hashKey(value: string): number {
  let hash = 0
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }
  return hash
}

function getInitials(label: string): string {
  const parts = label
    .split(/[^A-Za-z0-9]+/)
    .map(part => part.trim())
    .filter(Boolean)

  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  }

  return label.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'SW'
}

function buildFallbackLogoDataUrl(componentKey: string, label: string): string {
  const [start, end] = LOGO_ACCENTS[hashKey(componentKey || label) % LOGO_ACCENTS.length]
  const initials = getInitials(label)
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96" fill="none">
      <defs>
        <linearGradient id="g" x1="8" y1="8" x2="88" y2="88" gradientUnits="userSpaceOnUse">
          <stop stop-color="${start}" />
          <stop offset="1" stop-color="${end}" />
        </linearGradient>
      </defs>
      <rect width="96" height="96" rx="24" fill="url(#g)" />
      <circle cx="73" cy="23" r="10" fill="white" fill-opacity="0.18" />
      <circle cx="21" cy="77" r="14" fill="white" fill-opacity="0.14" />
      <text x="48" y="57" text-anchor="middle" font-family="ui-sans-serif, system-ui, sans-serif" font-size="30" font-weight="700" fill="white">${initials}</text>
    </svg>
  `

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`
}

function resolveSoftwareLogo(componentKey: string, label: string): ResolvedSoftwareLogo {
  return {
    primarySrc: KNOWN_SOFTWARE_LOGOS[componentKey],
    fallbackSrc: buildFallbackLogoDataUrl(componentKey, label),
  }
}

export function preloadSoftwareLogos(items: SoftwareLogoItem[]) {
  if (typeof Image === 'undefined') return

  for (const item of items) {
    const { primarySrc, fallbackSrc } = resolveSoftwareLogo(item.component_key, item.label)
    const sources = primarySrc ? [primarySrc, fallbackSrc] : [fallbackSrc]

    for (const src of sources) {
      if (preloadCache.has(src)) continue
      preloadCache.add(src)
      const image = new Image()
      image.decoding = 'async'
      image.src = src
    }
  }
}

type SoftwareLogoProps = {
  componentKey: string
  label: string
  className?: string
}

export function SoftwareLogo({ componentKey, label, className }: SoftwareLogoProps) {
  const { primarySrc, fallbackSrc } = resolveSoftwareLogo(componentKey, label)
  const [src, setSrc] = useState(primarySrc ?? fallbackSrc)

  useEffect(() => {
    setSrc(primarySrc ?? fallbackSrc)
  }, [fallbackSrc, primarySrc])

  return (
    <span
      className={cn(
        'inline-flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border bg-background shadow-sm',
        className
      )}
    >
      <img
        src={src}
        alt={`${label} logo`}
        className="size-full object-cover"
        loading="eager"
        decoding="async"
        onError={() => setSrc(fallbackSrc)}
      />
    </span>
  )
}