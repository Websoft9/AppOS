import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { cn } from '@/lib/utils'

export interface DockerDependencyIssue {
  code: 'docker_missing' | 'compose_missing' | 'docker_daemon_unavailable' | 'docker_permission_denied'
  title: string
  description: string
}

export type DockerDependencyIssueCode = DockerDependencyIssue['code']

export type DockerFocusSource =
  | 'overview'
  | 'containers'
  | 'images'
  | 'volumes'
  | 'networks'
  | 'compose'

function issueFocusPanel(code: DockerDependencyIssue['code']): 'checklist' | 'history' {
  if (code === 'docker_daemon_unavailable' || code === 'docker_permission_denied') {
    return 'history'
  }
  return 'checklist'
}

function normalizeString(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  return ''
}

function issueFromCode(code: string): DockerDependencyIssue | null {
  switch (code) {
    case 'compose_missing':
      return {
        code: 'compose_missing',
        title: 'Docker Compose is not available on this server',
        description:
          'Compose commands cannot run until the Docker Compose plugin or compatible compose command is installed and working.',
      }
    case 'docker_daemon_unavailable':
      return {
        code: 'docker_daemon_unavailable',
        title: 'Docker is installed but not ready',
        description:
          'Docker commands reached the host, but the Docker daemon is unavailable. Start or repair Docker before retrying.',
      }
    case 'docker_permission_denied':
      return {
        code: 'docker_permission_denied',
        title: 'Docker access is blocked on this server',
        description:
          'Docker appears to be installed, but the current connection cannot access the Docker socket. Fix the Docker service or permission setup before retrying.',
      }
    case 'docker_missing':
      return {
        code: 'docker_missing',
        title: 'Docker Engine is not available on this server',
        description:
          'Docker commands cannot run because the Docker binary is missing or unavailable in the current runtime path.',
      }
    default:
      return null
  }
}

function issueCodeFromError(source: unknown): string {
  const err = source as {
    response?: { data?: { error_code?: unknown } }
    data?: { error_code?: unknown }
  }
  return normalizeString(err?.response?.data?.error_code || err?.data?.error_code).toLowerCase()
}

function includesAny(text: string, patterns: string[]) {
  return patterns.some(pattern => text.includes(pattern))
}

export function getDockerDependencyIssue(source: unknown): DockerDependencyIssue | null {
  const coded = issueFromCode(issueCodeFromError(source))
  if (coded) return coded

  const err = source as {
    message?: unknown
    response?: { data?: { error?: unknown; message?: unknown } }
    data?: { error?: unknown; message?: unknown }
  }
  const normalized = String(
    typeof source === 'string'
      ? source
      : normalizeString(
          err?.message ||
            err?.response?.data?.message ||
            err?.data?.message ||
            err?.response?.data?.error ||
            err?.data?.error
        )
  )
    .trim()
    .toLowerCase()
  if (!normalized) return null

  if (
    includesAny(normalized, [
      "docker: 'compose' is not a docker command",
      'docker compose: command not found',
      'docker compose: not found',
      'compose is not a docker command',
      'unknown command "compose"',
      'docker-compose: command not found',
      'docker-compose: not found',
    ])
  ) {
    return issueFromCode('compose_missing')
  }

  if (
    includesAny(normalized, [
      'cannot connect to the docker daemon',
      'is the docker daemon running',
      'docker daemon is not running',
    ])
  ) {
    return issueFromCode('docker_daemon_unavailable')
  }

  if (normalized.includes('permission denied') && normalized.includes('docker.sock')) {
    return issueFromCode('docker_permission_denied')
  }

  if (
    includesAny(normalized, [
      'docker: command not found',
      'docker: not found',
      'exec: "docker": executable file not found in $path',
      'executable file not found in $path',
      'no such file or directory: docker',
    ])
  ) {
    return issueFromCode('docker_missing')
  }

  return null
}

export function DockerDependencyAlert({
  serverId,
  message,
  focusSource = 'overview',
  className,
}: {
  serverId: string
  message: string
  focusSource?: DockerFocusSource
  className?: string
}) {
  const issue = getDockerDependencyIssue(message)
  if (!issue) return null

  return (
    <Alert variant="destructive" className={cn('shrink-0', className)}>
      <AlertTitle>{issue.title}</AlertTitle>
      <AlertDescription>
        <div className="space-y-3">
          <p>{issue.description}</p>
          <p className="text-xs text-muted-foreground">{message}</p>
          <a
            href={`/resources/servers?server=${encodeURIComponent(serverId)}&tab=components&focusComponent=docker&focusPanel=${issueFocusPanel(issue.code)}&focusSource=${focusSource}&focusIssue=${issue.code}`}
            className="inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            Open Components &gt; Prerequisites
          </a>
        </div>
      </AlertDescription>
    </Alert>
  )
}