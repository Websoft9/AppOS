export function normalizeDockerServerId(serverId?: string): string {
  const value = serverId?.trim()
  return value || 'local'
}

export function dockerTargetsPath(): string {
  return '/api/servers/docker-targets'
}

export function dockerApiPath(serverId: string | undefined, resourcePath = ''): string {
  const normalizedServerId = encodeURIComponent(normalizeDockerServerId(serverId))
  const normalizedResourcePath = resourcePath
    ? resourcePath.startsWith('/')
      ? resourcePath
      : `/${resourcePath}`
    : ''
  return `/api/servers/${normalizedServerId}/docker${normalizedResourcePath}`
}

export function dockerApiUrl(
  serverId: string | undefined,
  resourcePath = '',
  query?: Record<string, string | number | boolean | undefined | null>
): string {
  const path = dockerApiPath(serverId, resourcePath)
  if (!query) return path

  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value == null) continue
    params.set(key, String(value))
  }
  const queryString = params.toString()
  return queryString ? `${path}?${queryString}` : path
}
