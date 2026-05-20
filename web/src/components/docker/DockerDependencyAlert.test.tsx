import { describe, expect, it } from 'vitest'
import { getDockerDependencyIssue } from './DockerDependencyAlert'

describe('getDockerDependencyIssue', () => {
  it('classifies missing docker compose as a prerequisite issue', () => {
    expect(getDockerDependencyIssue("docker: 'compose' is not a docker command")).toMatchObject({
      code: 'compose_missing',
      title: 'Docker Compose is not available on this server',
    })
  })

  it('classifies missing docker binary as a prerequisite issue', () => {
    expect(getDockerDependencyIssue('docker: command not found')).toMatchObject({
      code: 'docker_missing',
      title: 'Docker Engine is not available on this server',
    })
  })

  it('classifies daemon connectivity failures as a prerequisite issue', () => {
    expect(
      getDockerDependencyIssue('Cannot connect to the Docker daemon at unix:///var/run/docker.sock')
    ).toMatchObject({
      code: 'docker_daemon_unavailable',
      title: 'Docker is installed but not ready',
    })
  })

  it('prefers structured backend error codes over fragile message parsing', () => {
    expect(
      getDockerDependencyIssue({
        response: {
          data: {
            error_code: 'compose_missing',
            error: 'some future backend wording change',
          },
        },
      })
    ).toMatchObject({
      code: 'compose_missing',
      title: 'Docker Compose is not available on this server',
    })
  })

  it('returns null for ordinary runtime failures', () => {
    expect(getDockerDependencyIssue('Failed to remove container web')).toBeNull()
  })
})