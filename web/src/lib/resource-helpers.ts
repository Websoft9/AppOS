export function normalizeTemplateID(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replaceAll('_', '-')
    .replaceAll(' ', '-')
}

export function cloneConfig<T extends Record<string, unknown> | null | undefined>(
  input: T
): Record<string, unknown> {
  if (!input) return {}
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    output[key] = cloneValue(value)
  }
  return output
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => cloneValue(item))
  }
  if (value && typeof value === 'object') {
    return cloneConfig(value as Record<string, unknown>)
  }
  return value
}

export function resolveEnabledFlag(value: unknown, fallback = true): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['false', '0', 'no', 'off'].includes(normalized)) return false
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true
    return fallback
  }
  if (typeof value === 'number') return value !== 0
  return fallback
}

export function formatResourceSecretLabel(raw: Record<string, unknown>): string {
  return String(raw.name ?? raw.id)
}