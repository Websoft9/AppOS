export type ServerFactsView = {
  operatingSystem: string
  kernelRelease: string
  architecture: string
  cpuCores: string
  memoryTotal: string
  observedAt: string
  hasFacts: boolean
}

export type TunnelService = {
  service_name: string
  tunnel_port: number
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return null
}

function formatBytes(value: unknown): string {
  const bytes = asNumber(value)
  if (bytes === null || bytes < 0) {
    return '—'
  }
  if (bytes === 0) {
    return '0 B'
  }

  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let size = bytes
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  const digits = size >= 10 || unitIndex === 0 ? 0 : 1
  return `${size.toFixed(digits)} ${units[unitIndex]}`
}

export function accessLabel(status: string): string {
  if (status === 'online') return 'Available'
  if (status === 'offline') return 'Unavailable'
  return 'Unknown'
}

export function tunnelStateLabel(state: string): string {
  if (state === 'setup_required') return 'Setup Required'
  if (state === 'paused') return 'Paused'
  return 'Ready'
}

export function formatTimestamp(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    return '—'
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return String(value)
  }
  return parsed.toLocaleString()
}

export function normalizeServerFacts(item: Record<string, unknown>): ServerFactsView {
  const facts = asObject(item.facts_json)
  const osFacts = asObject(facts?.os)
  const kernelFacts = asObject(facts?.kernel)
  const cpuFacts = asObject(facts?.cpu)
  const memoryFacts = asObject(facts?.memory)

  const osParts = [
    String(osFacts?.distribution ?? '').trim(),
    String(osFacts?.version ?? '').trim(),
  ].filter(Boolean)
  const operatingSystem =
    osParts.length > 0 ? osParts.join(' ') : String(osFacts?.family ?? '').trim() || '—'

  const cpuCores = asNumber(cpuFacts?.cores)
  const observedAtRaw = String(item.facts_observed_at ?? '').trim()
  const hasFacts = Boolean((facts && Object.keys(facts).length > 0) || observedAtRaw)

  return {
    operatingSystem,
    kernelRelease: String(kernelFacts?.release ?? '').trim() || '—',
    architecture: String(facts?.architecture ?? '').trim() || '—',
    cpuCores: cpuCores === null ? '—' : String(cpuCores),
    memoryTotal: formatBytes(memoryFacts?.total_bytes),
    observedAt: formatTimestamp(observedAtRaw),
    hasFacts,
  }
}

export function compactHostFactsSummary(item: Record<string, unknown>): string {
  const facts = normalizeServerFacts(item)
  if (!facts.hasFacts) {
    return ''
  }

  const parts = [facts.operatingSystem, facts.architecture].filter(value => value && value !== '—')
  return parts.join(' · ')
}

export function parseTunnelServices(value: unknown): TunnelService[] {
  try {
    if (typeof value === 'string' && value !== '' && value !== 'null') {
      return JSON.parse(value) as TunnelService[]
    }
    if (Array.isArray(value)) {
      return value as TunnelService[]
    }
  } catch {
    return []
  }
  return []
}