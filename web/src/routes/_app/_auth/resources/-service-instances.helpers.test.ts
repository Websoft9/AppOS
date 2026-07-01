import { describe, expect, it, vi } from 'vitest'

const createSecretMock = vi.fn()

vi.mock('@/lib/pb', () => ({
  pb: {
    collection: (name: string) => {
      if (name !== 'secrets') {
        throw new Error(`Unexpected collection: ${name}`)
      }
      return {
        create: (...args: unknown[]) => createSecretMock(...args),
      }
    },
  },
}))

import { buildInstancePayload, mapInstanceRow } from './service-instances'

const t = (key: string, options?: Record<string, unknown>) => {
  if (key === 'serviceInstances.secret.generatedDescription') {
    return `Password for ${String(options?.name ?? '')}`
  }
  const labels: Record<string, string> = {
    'serviceInstances.errors.instanceProfileRequired': 'Instance profile is required',
    'serviceInstances.errors.passwordRequired': 'Password is required',
    'serviceInstances.errors.passwordSecretRequired': 'Password Secret is required',
    'serviceInstances.errors.sslCertificateRequired': 'SSL certificate is required for mutual SSL',
    'serviceInstances.secret.singleValueTemplate': 'Password / Single Value',
    'serviceInstances.fields.username': 'Username',
    'serviceInstances.fields.connectionTimeout': 'Connection Timeout',
    'serviceInstances.fields.useSsl': 'Use SSL',
    'serviceInstances.placeholders.username': 'appuser',
    'serviceInstances.help.connectionTimeout': 'Connection timeout help',
    'serviceInstances.product.standardTemplate': 'Standard template',
    'serviceInstances.categories.database': 'Database',
    'serviceInstances.kinds.mysql-compatible': 'MySQL-Compatible',
    'serviceInstances.monitor.status.unreachable': 'Unreachable',
  }
  return labels[key] ?? key
}

describe('service-instances helpers', () => {
  it('maps an instance row into flattened table and form state', () => {
    const templatesById = new Map([
      [
        'generic-mysql',
        {
          id: 'generic-mysql',
          category: 'database',
          kind: 'mysql-compatible',
          title: 'Generic MySQL',
          fields: [
            { id: 'database', label: 'Database', type: 'text', required: true, default: 'MySQL' },
          ],
        },
      ],
    ])

    const monitorByTargetId = new Map([
      [
        'instance-1',
        {
          target_id: 'instance-1',
          status: 'unreachable',
          reason: 'connection refused',
          last_checked_at: '2026-04-11T10:00:00Z',
        },
      ],
    ])

    const row = mapInstanceRow(
      {
        id: 'instance-1',
        created: '2026-04-11T08:30:00Z',
        updated: '2026-04-11T09:45:00Z',
        name: 'mysql-prod',
        kind: 'mysql-compatible',
        is_enabled: true,
        template_id: 'generic-mysql',
        endpoint: 'db.example.com:3306',
        credential: 'secret-1',
        config: {
          database: 'appdb',
          username: 'root',
          ssl_enabled: true,
        },
      },
      templatesById,
      monitorByTargetId,
      t
    )

    expect(row).toMatchObject({
      created: '2026-04-11T08:30:00Z',
      updated: '2026-04-11T09:45:00Z',
      host: 'db.example.com',
      port: '3306',
      profile: 'Generic MySQL',
      enabled_status: 'Enabled',
      credential_use_secret: true,
      ssl_mode: 'one_way',
      monitor_status: 'unreachable',
      monitor_last_checked_at: '2026-04-11T10:00:00Z',
    })
  })

  it('builds a payload from flattened form data and creates a managed secret when needed', async () => {
    createSecretMock.mockReset()
    createSecretMock.mockResolvedValue({ id: 'secret-created' })

    const templatesById = new Map([
      [
        'generic-mysql',
        {
          id: 'generic-mysql',
          category: 'database',
          kind: 'mysql-compatible',
          title: 'Generic MySQL',
          defaultEndpoint: 'db.example.com:3306',
          fields: [
            { id: 'database', label: 'Database', type: 'text', required: true, default: 'MySQL' },
            { id: 'ssl_ca_certificate', label: 'SSL CA Certificate', type: 'text' },
          ],
        },
      ],
    ])

    const payload = await buildInstancePayload(
      {
        template_id: 'generic-mysql',
        name: 'mysql-prod',
        is_enabled: true,
        host: 'db.example.com',
        port: 3306,
        database: 'appdb',
        username: 'root',
        credential_use_secret: false,
        password_value: 's3cr3t',
        ssl_mode: 'mutual',
        ssl_ca_certificate: 'cert-1',
        description: 'production database',
      },
      templatesById,
      t
    )

    expect(createSecretMock).toHaveBeenCalledWith({
      name: 'mysql-prod-password',
      description: 'Password for mysql-prod',
      template_id: 'single_value',
      scope: 'global',
      visible_to: ['service_instance'],
      payload: { value: 's3cr3t' },
    })

    expect(payload).toEqual({
      name: 'mysql-prod',
      kind: 'mysql-compatible',
      is_enabled: true,
      template_id: 'generic-mysql',
      endpoint: 'db.example.com:3306',
      provider_account: '',
      credential: 'secret-created',
      config: {
        database: 'appdb',
        username: 'root',
        ssl_enabled: true,
        ssl_ca_certificate: 'cert-1',
      },
      description: 'production database',
    })
  })
})