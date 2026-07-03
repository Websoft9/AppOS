import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ServiceInstancesPage } from './service-instances'

const SERVICE_INSTANCE_SECRET_PATH =
  "/api/collections/secrets/records?filter=(created_source=''||created_source='user')%26%26type!='tunnel_token'%26%26status='active'%26%26(template_id='single_value')%26%26(visible_to:length=0||visible_to:each%3F='service_instance')&sort=name"

const sendMock = vi.fn()
const createSecretMock = vi.fn()
const getSecretMock = vi.fn()
const updateSecretMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute:
    () =>
    ({ component }: { component: unknown }) =>
      component,
  Link: ({ children, to, className }: { children: ReactNode; to: string; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => {},
  },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        'hub.title': 'Resources',
        'resources.serviceInstances.title': 'Service Instances',
        'serviceInstances.page.title': 'Service Instances',
        'serviceInstances.page.description':
          'Runtime dependency contracts required for application startup, including database, cache, messaging, and storage instances.',
        'serviceInstances.page.favoritesOnly': 'Favorites only',
        'serviceInstances.page.addInstance': 'Add Instance',
        'serviceInstances.page.searchPlaceholder': 'Search any instances',
        'serviceInstances.page.cancel': 'Cancel',
        'serviceInstances.selection.title': 'Choose a Runtime Kind',
        'serviceInstances.selection.description':
          'Choose the runtime kind directly. Profile remains a property of that kind inside the form.',
        'serviceInstances.selection.searchPlaceholder':
          'Search MySQL, Redis, Kafka, or MinIO...',
        'serviceInstances.selection.emptyMessage': 'No matching runtime kinds found.',
        'serviceInstances.selection.profileCount': `${String(options?.count ?? '')} profiles`,
        'serviceInstances.fields.category': 'Category',
        'serviceInstances.fields.kind': 'Kind',
        'serviceInstances.fields.template': 'Profile',
        'serviceInstances.fields.selectedProduct': 'Selected Product',
        'serviceInstances.fields.selectedProductMeta': 'Selected Product Meta',
        'serviceInstances.fields.selectedProductDescription': 'Selected Product Description',
        'serviceInstances.fields.name': 'Name',
        'serviceInstances.fields.enableIt': 'Enable it',
        'serviceInstances.fields.username': 'Username',
        'serviceInstances.fields.connectionTimeout': 'Connection Timeout',
        'serviceInstances.fields.titleNameEditing': 'Title Name Editing',
        'serviceInstances.fields.endpoint': 'Endpoint',
        'serviceInstances.fields.host': 'Host',
        'serviceInstances.fields.port': 'Port',
        'serviceInstances.fields.platformAccount': 'Platform Account',
        'serviceInstances.fields.password': 'Password',
        'serviceInstances.fields.credential': 'Credential',
        'serviceInstances.fields.credentialUsesSecret': 'Credential Uses Secret',
        'serviceInstances.fields.passwordValue': 'Password Value',
        'serviceInstances.fields.useSsl': 'Use SSL',
        'serviceInstances.fields.sslCertificate': 'SSL Certificate',
        'serviceInstances.fields.description': 'Description',
        'serviceInstances.fields.groups': 'Groups',
        'serviceInstances.placeholders.name': 'db-prod',
        'serviceInstances.placeholders.username': 'appuser',
        'serviceInstances.placeholders.endpoint':
          'db.example.com:3306 or https://service.example.com',
        'serviceInstances.placeholders.host': 'db.example.com',
        'serviceInstances.help.connectionTimeout':
          'How many seconds to wait before the first connection attempt times out.',
        'serviceInstances.help.sslCertificatePostgres':
          'Choose a certificate only when your PostgreSQL connection requires mutual SSL.',
        'serviceInstances.help.sslCertificateMysql':
          'Choose a certificate only when your MySQL connection requires mutual SSL.',
        'serviceInstances.categories.database': 'Database',
        'serviceInstances.categories.cache': 'Cache',
        'serviceInstances.categories.message-queue': 'MQ',
        'serviceInstances.categories.storage': 'Storage',
        'serviceInstances.categories.search': 'Search',
        'serviceInstances.categories.application-service': 'Application Service',
        'serviceInstances.categories.artifact': 'Registries',
        'serviceInstances.categories.ai': 'AI Services',
        'serviceInstances.categories.other': 'Other',
        'serviceInstances.kinds.mysql-compatible': 'MySQL-Compatible',
        'serviceInstances.kinds.postgres-compatible': 'PostgreSQL-Compatible',
        'serviceInstances.kinds.redis-compatible': 'Redis-Compatible',
        'serviceInstances.kinds.kafka-compatible': 'Kafka-Compatible',
        'serviceInstances.kinds.amqp-compatible': 'AMQP-Compatible',
        'serviceInstances.kinds.nats-compatible': 'NATS-Compatible',
        'serviceInstances.kinds.mqtt-compatible': 'MQTT-Compatible',
        'serviceInstances.kinds.s3-compatible': 'Storage',
        'serviceInstances.kinds.mongodb-compatible': 'MongoDB-Compatible',
        'serviceInstances.kinds.clickhouse-compatible': 'ClickHouse-Compatible',
        'serviceInstances.kinds.neo4j-compatible': 'Neo4j-Compatible',
        'serviceInstances.kinds.influxdb-compatible': 'InfluxDB-Compatible',
        'serviceInstances.kinds.elasticsearch-compatible': 'Elasticsearch-Compatible',
        'serviceInstances.kinds.onlyoffice-compatible': 'ONLYOFFICE-Compatible',
        'serviceInstances.kinds.unknown': 'Unknown',
        'serviceInstances.product.standardTemplate': 'Standard template',
        'serviceInstances.product.profileDescription': '{{vendorPrefix}}{{category}} profile.',
        'serviceInstances.templateFields.database': 'Database',
        'serviceInstances.templateFields.region': 'Region',
        'serviceInstances.templateFields.clusterIdentifier': 'Cluster Identifier',
        'serviceInstances.templateFields.clusterId': 'Cluster ID',
        'serviceInstances.templateFields.resourceGroup': 'Resource Group',
        'serviceInstances.columns.name': 'Name',
        'serviceInstances.columns.kind': 'Kind',
        'serviceInstances.columns.profile': 'Profile',
        'serviceInstances.columns.host': 'Host',
        'serviceInstances.columns.port': 'Port',
        'serviceInstances.columns.reachability': 'Reachability',
        'serviceInstances.columns.monitor': 'Monitor',
        'serviceInstances.columns.lastChecked': 'Last Checked',
        'serviceInstances.columns.created': 'Created',
        'serviceInstances.columns.updated': 'Updated',
        'serviceInstances.monitor.unknown': 'Unknown',
        'serviceInstances.monitor.status.healthy': 'Healthy',
        'serviceInstances.monitor.status.offline': 'Offline',
        'serviceInstances.monitor.status.unreachable': 'Unreachable',
        'serviceInstances.monitor.status.credential_invalid': 'Credential Invalid',
        'serviceInstances.monitor.status.degraded': 'Degraded',
        'serviceInstances.ssl.oneWay': 'One-way SSL',
        'serviceInstances.ssl.mutual': 'Mutual SSL',
        'serviceInstances.credential.enterPassword': 'Enter password',
        'serviceInstances.credential.showPassword': 'Show password',
        'serviceInstances.credential.hidePassword': 'Hide password',
        'serviceInstances.dialog.instanceTitle': 'Instance title',
        'serviceInstances.dialog.applyTitle': 'Apply title',
        'serviceInstances.dialog.newInstance': 'New Service Instance',
        'serviceInstances.dialog.editTitle': 'Edit title',
        'serviceInstances.dialog.createKind': `Create ${String(options?.kind ?? '')} instance`,
        'serviceInstances.dialog.updateKind': `Update ${String(options?.kind ?? '')} instance`,
        'serviceInstances.dialog.create': 'Create',
        'serviceInstances.dialog.update': 'Update',
        'serviceInstances.dialog.suffix': 'Service Instance',
        'serviceInstances.secret.singleValueTemplate': 'Password / Single Value',
        'serviceInstances.secret.newTitle': 'New Secret',
        'serviceInstances.secret.newDescription':
          'Create a reusable password secret and attach it to this service instance.',
        'serviceInstances.secret.editTitle': 'Edit Secret',
        'serviceInstances.secret.editDescription':
          'Update the selected Secret without leaving service instance editing.',
        'serviceInstances.secret.loading': 'Loading secret...',
        'serviceInstances.secret.save': 'Save Secret',
        'serviceInstances.secret.generatedDescription': 'Password for {{name}}',
        'serviceInstances.secret.errors.load': 'Failed to load secret',
        'serviceInstances.secret.errors.nameRequired': 'Name is required',
        'serviceInstances.secret.errors.update': 'Failed to update secret',
        'serviceInstances.errors.instanceProfileRequired': 'Instance profile is required',
        'serviceInstances.errors.passwordRequired': 'Password is required',
        'serviceInstances.errors.passwordSecretRequired': 'Password Secret is required',
        'serviceInstances.errors.sslCertificateRequired':
          'SSL certificate is required for mutual SSL',
      }
      if (key === 'serviceInstances.product.profileDescription') {
        return `${String(options?.vendorPrefix ?? '')}${String(options?.category ?? '')} profile.`
      }
      if (key === 'serviceInstances.secret.generatedDescription') {
        return `Password for ${String(options?.name ?? '')}`
      }
      return labels[key] ?? key
    },
  }),
}))

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
    collection: (name: string) => {
      if (name !== 'secrets') {
        throw new Error(`Unexpected collection: ${name}`)
      }
      return {
        create: (...args: unknown[]) => createSecretMock(...args),
        getOne: (...args: unknown[]) => getSecretMock(...args),
        update: (...args: unknown[]) => updateSecretMock(...args),
      }
    },
  },
}))

vi.mock('@/components/secrets/SecretForm', () => ({
  SecretForm: ({
    templates,
    templateId,
    payload,
    onPayloadChange,
  }: {
    templates: Array<{
      id: string
      fields: Array<{ key: string; label: string; type: string; required?: boolean }>
    }>
    templateId: string
    payload: Record<string, string>
    onPayloadChange: (key: string, value: string) => void
  }) => {
    const selectedTemplate = templates.find(template => template.id === templateId)
    if (!selectedTemplate) return null
    return (
      <div>
        {selectedTemplate.fields.map(field => {
          const label = `${field.label}${field.required ? ' *' : ''}`
          return field.type === 'textarea' ? (
            <label key={field.key}>
              {label}
              <textarea
                aria-label={label}
                value={payload[field.key] ?? ''}
                onChange={event => onPayloadChange(field.key, event.target.value)}
              />
            </label>
          ) : (
            <label key={field.key}>
              {label}
              <input
                aria-label={label}
                type={field.type === 'password' ? 'password' : 'text'}
                value={payload[field.key] ?? ''}
                onChange={event => onPayloadChange(field.key, event.target.value)}
              />
            </label>
          )
        })}
      </div>
    )
  },
}))

function buildMySQLTemplate() {
  return {
    id: 'generic-mysql',
    category: 'database',
    kind: 'mysql-compatible',
    title: 'Generic MySQL',
    layoutPreset: 'database_connection',
    endpointShape: 'host_port',
    defaultPort: 3306,
    credentialPresentation: 'secret_or_inline',
    credentialLabel: 'password',
    fields: [
      {
        id: 'username',
        label: 'Backend Username Label',
        type: 'text',
        required: true,
        default: 'root',
      },
      {
        id: 'database',
        label: 'Backend Database Label',
        type: 'text',
        required: true,
        default: 'MySQL',
      },
      {
        id: 'connect_timeout',
        label: 'Backend Connection Timeout Label',
        type: 'number',
        advanced: true,
        default: 10,
      },
      {
        id: 'ssl_enabled',
        label: 'Backend SSL Enabled Label',
        type: 'boolean',
        advanced: true,
        hidden: true,
        default: false,
      },
      {
        id: 'ssl_ca_certificate',
        label: 'SSL Root CA Certificate',
        type: 'certificate_ref',
        advanced: true,
        showWhen: { field: 'ssl_mode', values: ['mutual'] },
      },
    ],
  }
}

function buildPostgresTemplate() {
  return {
    id: 'generic-postgres',
    category: 'database',
    kind: 'postgres-compatible',
    title: 'Generic PostgreSQL',
    layoutPreset: 'database_connection',
    endpointShape: 'host_port',
    defaultPort: 5432,
    credentialPresentation: 'secret_or_inline',
    credentialLabel: 'password',
    fields: [
      {
        id: 'username',
        label: 'Backend Username Label',
        type: 'text',
        required: true,
        default: 'postgres',
      },
      {
        id: 'database',
        label: 'Backend Postgres Database Label',
        type: 'text',
        required: true,
        default: 'postgres',
      },
      {
        id: 'connect_timeout',
        label: 'Backend Connection Timeout Label',
        type: 'number',
        advanced: true,
        default: 10,
      },
      {
        id: 'ssl_enabled',
        label: 'Backend SSL Enabled Label',
        type: 'boolean',
        advanced: true,
        hidden: true,
        default: false,
      },
      {
        id: 'ssl_ca_certificate',
        label: 'SSL Root CA Certificate',
        type: 'certificate_ref',
        advanced: true,
        showWhen: { field: 'ssl_mode', values: ['mutual'] },
      },
    ],
  }
}

function buildDefaultInstanceTemplatesFixture() {
  return [
    buildMySQLTemplate(),
    buildPostgresTemplate(),
    {
      id: 'generic-mongodb',
      category: 'database',
      kind: 'mongodb-compatible',
      title: 'Generic MongoDB',
      defaultEndpoint: 'mongodb://mongo.internal:27017',
      layoutPreset: 'database_connection',
      endpointShape: 'host_port',
      defaultPort: 27017,
      credentialPresentation: 'secret_or_inline',
      credentialLabel: 'password',
      fields: [
        {
          id: 'username',
          label: 'Backend Username Label',
          type: 'text',
          required: true,
          default: 'root',
        },
        {
          id: 'database',
          label: 'Backend Database Label',
          type: 'text',
          default: 'appdb',
        },
        {
          id: 'connect_timeout',
          label: 'Backend Connection Timeout Label',
          type: 'number',
          advanced: true,
          default: 10,
        },
        {
          id: 'ssl_enabled',
          label: 'Backend SSL Enabled Label',
          type: 'boolean',
          advanced: true,
          hidden: true,
          default: false,
        },
        {
          id: 'authSource',
          label: 'Backend Auth Source Label',
          type: 'text',
          default: 'admin',
          advanced: true,
        },
        {
          id: 'ssl_ca_certificate',
          label: 'SSL Root CA Certificate',
          type: 'certificate_ref',
          advanced: true,
          showWhen: { field: 'ssl_mode', values: ['mutual'] },
        },
      ],
    },
    {
      id: 'generic-clickhouse',
      category: 'database',
      kind: 'clickhouse-compatible',
      title: 'Generic ClickHouse',
      defaultEndpoint: 'https://clickhouse.internal:8123',
      layoutPreset: 'database_connection',
      endpointShape: 'host_port',
      defaultPort: 8123,
      credentialPresentation: 'secret_or_inline',
      credentialLabel: 'password',
      fields: [
        {
          id: 'username',
          label: 'Backend Username Label',
          type: 'text',
          required: true,
          default: 'default',
        },
        { id: 'database', label: 'Backend Database Label', type: 'text', default: 'default' },
        {
          id: 'connect_timeout',
          label: 'Backend Connection Timeout Label',
          type: 'number',
          advanced: true,
          default: 10,
        },
        {
          id: 'ssl_enabled',
          label: 'Backend SSL Enabled Label',
          type: 'boolean',
          advanced: true,
          hidden: true,
          default: false,
        },
        {
          id: 'ssl_ca_certificate',
          label: 'SSL Root CA Certificate',
          type: 'certificate_ref',
          advanced: true,
          showWhen: { field: 'ssl_mode', values: ['mutual'] },
        },
      ],
    },
    {
      id: 'generic-neo4j',
      category: 'database',
      kind: 'neo4j-compatible',
      title: 'Generic Neo4j',
      defaultEndpoint: 'neo4j://neo4j.internal:7687',
      layoutPreset: 'database_connection',
      endpointShape: 'host_port',
      defaultPort: 7687,
      credentialPresentation: 'secret_or_inline',
      credentialLabel: 'password',
      fields: [
        {
          id: 'username',
          label: 'Backend Username Label',
          type: 'text',
          required: true,
          default: 'neo4j',
        },
        { id: 'database', label: 'Backend Database Label', type: 'text', default: 'neo4j' },
        {
          id: 'connect_timeout',
          label: 'Backend Connection Timeout Label',
          type: 'number',
          advanced: true,
          default: 10,
        },
        {
          id: 'ssl_enabled',
          label: 'Backend SSL Enabled Label',
          type: 'boolean',
          advanced: true,
          hidden: true,
          default: false,
        },
        {
          id: 'ssl_ca_certificate',
          label: 'SSL Root CA Certificate',
          type: 'certificate_ref',
          advanced: true,
          showWhen: { field: 'ssl_mode', values: ['mutual'] },
        },
      ],
    },
    {
      id: 'generic-influxdb',
      category: 'database',
      kind: 'influxdb-compatible',
      title: 'Generic InfluxDB',
      defaultEndpoint: 'https://influxdb.internal:8086',
      layoutPreset: 'database_connection',
      endpointShape: 'host_port',
      defaultPort: 8086,
      credentialPresentation: 'secret_or_inline',
      credentialLabel: 'password',
      fields: [
        {
          id: 'username',
          label: 'Backend Username Label',
          type: 'text',
          required: true,
        },
        {
          id: 'connect_timeout',
          label: 'Backend Connection Timeout Label',
          type: 'number',
          advanced: true,
          default: 10,
        },
        {
          id: 'ssl_enabled',
          label: 'Backend SSL Enabled Label',
          type: 'boolean',
          advanced: true,
          hidden: true,
          default: false,
        },
        { id: 'organization', label: 'Backend Organization Label', type: 'text', advanced: true },
        { id: 'bucket', label: 'Backend Bucket Label', type: 'text', advanced: true },
        {
          id: 'ssl_ca_certificate',
          label: 'SSL Root CA Certificate',
          type: 'certificate_ref',
          advanced: true,
          showWhen: { field: 'ssl_mode', values: ['mutual'] },
        },
      ],
    },
    {
      id: 'generic-redis',
      category: 'cache',
      kind: 'redis-compatible',
      title: 'Generic Redis',
      defaultEndpoint: 'redis.internal:6379',
      endpointShape: 'url',
      credentialPresentation: 'secret_or_inline',
      credentialLabel: 'password',
      fields: [
        {
          id: 'database',
          label: 'Backend Database Index Label',
          type: 'number',
          default: 0,
        },
      ],
    },
    {
      id: 'generic-elasticsearch',
      category: 'search',
      kind: 'elasticsearch-compatible',
      title: 'Generic Elasticsearch',
      vendor: 'OpenSearch',
      defaultEndpoint: 'https://elasticsearch.internal:9200',
      endpointShape: 'url',
      credentialPresentation: 'secret_or_inline',
      credentialLabel: 'credential',
      fields: [
        { id: 'indexPrefix', label: 'Backend Index Prefix Label', type: 'text' },
        { id: 'username', label: 'Backend Username Label', type: 'text' },
      ],
    },
    {
      id: 'generic-kafka',
      category: 'message-queue',
      kind: 'kafka-compatible',
      title: 'Generic Kafka',
      vendor: 'Redpanda',
      defaultEndpoint: 'kafka.internal:9092',
      endpointShape: 'url',
      credentialPresentation: 'secret_or_inline',
      credentialLabel: 'credential',
      fields: [{ id: 'clusterId', label: 'Backend Cluster ID Label', type: 'text' }],
    },
    {
      id: 'generic-rabbitmq',
      category: 'message-queue',
      kind: 'amqp-compatible',
      title: 'Generic RabbitMQ',
      defaultEndpoint: 'amqp://rabbitmq.internal:5672',
      endpointShape: 'url',
      credentialPresentation: 'secret_or_inline',
      credentialLabel: 'credential',
      fields: [{ id: 'vhost', label: 'Backend Virtual Host Label', type: 'text', default: '/' }],
    },
    {
      id: 'generic-nats',
      category: 'message-queue',
      kind: 'nats-compatible',
      title: 'Generic NATS',
      defaultEndpoint: 'nats://nats.internal:4222',
      endpointShape: 'url',
      credentialPresentation: 'secret_or_inline',
      credentialLabel: 'credential',
      fields: [{ id: 'cluster', label: 'Backend Cluster Label', type: 'text' }],
    },
    {
      id: 'generic-mqtt',
      category: 'message-queue',
      kind: 'mqtt-compatible',
      title: 'Generic MQTT',
      defaultEndpoint: 'mqtt://broker.internal:1883',
      endpointShape: 'url',
      credentialPresentation: 'secret_or_inline',
      credentialLabel: 'credential',
      fields: [
        { id: 'clientId', label: 'Backend Client ID Label', type: 'text' },
        { id: 'protocol', label: 'Backend Protocol Label', type: 'text', default: 'mqtt' },
      ],
    },
    {
      id: 'generic-s3',
      category: 'storage',
      kind: 's3-compatible',
      title: 'Generic S3',
      defaultEndpoint: 'https://s3.example.com',
      endpointShape: 'url',
      credentialPresentation: 'reference_only',
      credentialLabel: 'credential',
      fields: [{ id: 'region', label: 'Backend Region Label', type: 'text' }],
    },
    {
      id: 'generic-onlyoffice',
      category: 'application-service',
      kind: 'onlyoffice-compatible',
      title: 'Generic ONLYOFFICE',
      defaultEndpoint: 'https://onlyoffice.internal',
      endpointShape: 'url',
      credentialPresentation: 'secret_or_inline',
      credentialLabel: 'credential',
      fields: [
        { id: 'callbackPath', label: 'Backend Callback Path Label', type: 'text', default: '/' },
        { id: 'documentPath', label: 'Backend Document Path Label', type: 'text', default: '/' },
      ],
    },
  ]
}

describe('ServiceInstancesPage', () => {
  function clickChooserOption(title: string) {
    const label = screen.getByText(title)
    const button = label.closest('button')
    if (button) {
      fireEvent.click(button)
      return
    }
    fireEvent.click(label)
  }

  beforeEach(() => {
    sendMock.mockReset()
    createSecretMock.mockReset()
    getSecretMock.mockReset()
    updateSecretMock.mockReset()
    createSecretMock.mockResolvedValue({ id: 'secret-created' })
    getSecretMock.mockResolvedValue({
      id: 'secret-1',
      name: 'db-password',
      description: 'existing description',
      template_id: 'single_value',
    })
    updateSecretMock.mockResolvedValue({ id: 'secret-1' })

    sendMock.mockImplementation(
      (path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
        if (path === '/api/instances/templates') {
          return Promise.resolve(buildDefaultInstanceTemplatesFixture())
        }
        if (path === '/api/secrets/templates') {
          return Promise.resolve([
            {
              id: 'single_value',
              label: 'Single Value',
              fields: [{ key: 'value', label: 'Value', type: 'password', required: true }],
            },
          ])
        }
        if (path === '/api/instances' && (!options?.method || options.method === 'GET')) {
          return Promise.resolve([])
        }
        if (path === '/api/instances/reachability' && options?.method === 'POST') {
          return Promise.resolve([])
        }
        if (path.startsWith('/api/collections/monitor_latest_status/records?')) {
          return Promise.resolve({ items: [] })
        }
        if (path === '/api/instances' && options?.method === 'POST') {
          return Promise.resolve({
            id: 'instance-created',
            name: options.body?.name ?? 'created-instance',
            kind: 'mysql-compatible',
            template_id: 'generic-mysql',
            endpoint: options.body?.endpoint ?? 'db.example.com:3306',
            provider_account: options.body?.provider_account ?? '',
            credential: options.body?.credential ?? 'secret-created',
            config: options.body?.config ?? {},
            description: options.body?.description ?? '',
          })
        }
        if (path === '/api/provider-accounts') {
          return Promise.resolve([])
        }
        if (path === SERVICE_INSTANCE_SECRET_PATH) {
          return Promise.resolve({ items: [{ id: 'secret-1', name: 'db-password' }] })
        }
        if (path === '/api/collections/groups/records?perPage=500&sort=name') {
          return Promise.resolve({ items: [] })
        }
        if (path === "/api/collections/certificates/records?filter=(status='active')&sort=name") {
          return Promise.resolve({ items: [{ id: 'cert-1', name: 'Demo CA' }] })
        }
        return Promise.resolve([])
      }
    )
  })

  afterEach(() => {
    cleanup()
  })

  it('opens a kind picker before showing the selected service instance form', async () => {
    render(<ServiceInstancesPage />)

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/instances/templates', { method: 'GET' })
      expect(screen.getByRole('button', { name: 'Add Instance' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add Instance' }))

    await screen.findByRole('dialog')

    expect(screen.getByText('Choose a Runtime Kind')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search MySQL, Redis, Kafka, or MinIO...')).toBeInTheDocument()
    expect(screen.getAllByText(/MySQL-Compatible/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/^AMQP-Compatible$/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Storage').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByRole('button', { name: /^HTTP Gateway/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Registry')).toBeNull()
    expect(screen.queryByText('Ollama')).toBeNull()

    fireEvent.change(screen.getByPlaceholderText('Search MySQL, Redis, Kafka, or MinIO...'), {
      target: { value: 'rabbitmq' },
    })

    expect(screen.getAllByText(/^AMQP-Compatible$/).length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('MySQL-Compatible')).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search MySQL, Redis, Kafka, or MinIO...'), {
		target: { value: 'mysql' },
	})

    expect(screen.getAllByText(/MySQL-Compatible/i).length).toBeGreaterThanOrEqual(1)

    fireEvent.change(screen.getByPlaceholderText('Search MySQL, Redis, Kafka, or MinIO...'), {
      target: { value: 'opensearch' },
    })

    expect(screen.queryByText('AMQP-Compatible')).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search MySQL, Redis, Kafka, or MinIO...'), {
      target: { value: '' },
    })

    clickChooserOption('MySQL-Compatible')
    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }))

    expect(screen.queryByText('Selected Product')).not.toBeInTheDocument()
    expect(screen.getByText('Create MySQL-Compatible instance')).toBeInTheDocument()
    expect(screen.queryByText('Editable')).not.toBeInTheDocument()

    const formDialog = await screen.findByRole('dialog')
    expect(formDialog.className).toContain('sm:max-w-4xl')
  })

  it('renders a mysql-specific flow with header name editing and advanced optional fields', async () => {
    render(<ServiceInstancesPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add Instance' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add Instance' }))
    await screen.findByText('MySQL-Compatible')
    clickChooserOption('MySQL-Compatible')

    expect(screen.queryByLabelText(/^Name/)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/^Database/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Username/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Database/)).toHaveValue('MySQL')
    expect(screen.getByLabelText(/^Username/)).toHaveValue('root')
    expect(screen.getByLabelText(/^Password/)).toBeInTheDocument()
    expect(screen.getByTitle('Show password')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Search secrets...')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/^Host/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Port/)).toBeInTheDocument()
    expect(screen.queryByText('Selected Product')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Use a saved secret'))
    expect(screen.getByPlaceholderText('Search secrets...')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate' })).not.toBeInTheDocument()

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(SERVICE_INSTANCE_SECRET_PATH, {})
    })

    expect(sendMock).not.toHaveBeenCalledWith(
      '/api/collections/secrets/records?perPage=500&sort=name',
      {}
    )

    expect(screen.queryByLabelText('Platform Account')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^Connection Timeout/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }))

    expect(screen.getByLabelText('Platform Account')).toBeInTheDocument()
    expect(screen.getByLabelText('Description')).toBeInTheDocument()
    expect(screen.getByLabelText(/^Connection Timeout/)).toBeInTheDocument()
    expect(screen.getByText('Use SSL')).toBeInTheDocument()
    expect(
      screen.queryByText('Optional connection, security, and organization settings.')
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Mutual SSL'))

    expect(await screen.findByLabelText('SSL Certificate')).toBeInTheDocument()
  })

  it('reuses the same database-family flow for postgresql', async () => {
    render(<ServiceInstancesPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add Instance' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add Instance' }))
    await screen.findByText('PostgreSQL-Compatible')
    clickChooserOption('PostgreSQL-Compatible')

    expect(await screen.findByLabelText(/^Database/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Database/)).toHaveValue('postgres')
    expect(screen.getByLabelText(/^Username/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Username/)).toHaveValue('postgres')
    expect(screen.getByLabelText(/^Password/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Host/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Port/)).toHaveValue(5432)

    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }))
    expect(screen.getByText('Use SSL')).toBeInTheDocument()
  })

  it('searches by product alias before selecting the kafka-compatible kind', async () => {
    render(<ServiceInstancesPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add Instance' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add Instance' }))

    fireEvent.change(
      await screen.findByPlaceholderText('Search MySQL, Redis, Kafka, or MinIO...'),
      { target: { value: 'redpanda' } }
    )

    expect(await screen.findByText(/Kafka-Compatible/i)).toBeInTheDocument()
    clickChooserOption('Kafka-Compatible')

    expect(await screen.findByText('Create Kafka-Compatible instance')).toBeInTheDocument()
    expect(screen.getByLabelText(/^Endpoint/)).toBeInTheDocument()
  })

  it('reuses the same database-family layout for mongodb-compatible kinds', async () => {
    render(<ServiceInstancesPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add Instance' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add Instance' }))
    await screen.findByText('MongoDB-Compatible')
    clickChooserOption('MongoDB-Compatible')

    expect(await screen.findByLabelText(/^Username/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Password/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Host/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Port/)).toHaveValue(27017)
    expect(screen.queryByLabelText(/^Endpoint/)).not.toBeInTheDocument()
  })

  it('keeps secret-only password editing and remembers ssl mode for existing instances', async () => {
    sendMock.mockImplementation(
      (path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
        if (path === '/api/instances/templates') {
          return Promise.resolve([buildMySQLTemplate()])
        }
        if (path === '/api/instances' && (!options?.method || options.method === 'GET')) {
          return Promise.resolve([
            {
              id: 'instance-1',
              created: '2026-04-11T08:30:00Z',
              updated: '2026-04-11T09:45:00Z',
              name: 'mysql-prod',
              kind: 'mysql-compatible',
              template_id: 'generic-mysql',
              endpoint: 'db.example.com:3306',
              credential: 'secret-1',
              config: {
                database: 'appdb',
                username: 'root',
                ssl_enabled: true,
              },
            },
          ])
        }
        if (path === '/api/instances/reachability' && options?.method === 'POST') {
          return Promise.resolve([])
        }
        if (path.startsWith('/api/collections/monitor_latest_status/records?')) {
          return Promise.resolve({
            items: [
              {
                target_id: 'instance-1',
                status: 'unreachable',
                reason: 'dial tcp 127.0.0.1:6379: connect: connection refused',
                last_checked_at: '2026-04-11T10:00:00Z',
              },
            ],
          })
        }
        if (path.startsWith('/api/collections/secrets/records?filter=')) {
          return Promise.resolve({ items: [{ id: 'secret-1', name: 'db-password' }] })
        }
        if (path === '/api/provider-accounts') {
          return Promise.resolve([])
        }
        if (path === '/api/collections/groups/records?perPage=500&sort=name') {
          return Promise.resolve({ items: [] })
        }
        if (path === "/api/collections/certificates/records?filter=(status='active')&sort=name") {
          return Promise.resolve({ items: [{ id: 'cert-1', name: 'Demo CA' }] })
        }
        return Promise.resolve([])
      }
    )

    render(<ServiceInstancesPage />)

    await waitFor(() => {
      expect(screen.getByText('mysql-prod')).toBeInTheDocument()
    })

    expect(screen.getByText('Unreachable')).toBeInTheDocument()
    expect(screen.getByText('2026-04-11 10:00:00')).toBeInTheDocument()
    expect(screen.queryByText('Created')).not.toBeInTheDocument()
    expect(screen.queryByText('Updated')).not.toBeInTheDocument()

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/instances/reachability', {
        method: 'POST',
        body: { ids: ['instance-1'] },
      })
    })

    fireEvent.pointerDown(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(await screen.findByText('Edit'))

    await waitFor(() => {
      expect(screen.getByText('db-password')).toBeInTheDocument()
    })

    expect(screen.queryByPlaceholderText('Search secrets...')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Show password')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit secret' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }))
    expect(screen.getByLabelText('One-way SSL')).toBeChecked()
    expect(screen.getByLabelText('Mutual SSL')).not.toBeChecked()
  }, 15000)

  it('persists edited host values for database-family instances', async () => {
    sendMock.mockImplementation(
      (path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
        if (path === '/api/instances/templates') {
          return Promise.resolve([buildMySQLTemplate()])
        }
        if (path === '/api/instances' && (!options?.method || options.method === 'GET')) {
          return Promise.resolve([
            {
              id: 'instance-1',
              name: 'mysql-prod',
              kind: 'mysql-compatible',
              template_id: 'generic-mysql',
              endpoint: 'db.example.com:3306',
              credential: 'secret-1',
              config: {
                database: 'appdb',
                username: 'root',
              },
            },
          ])
        }
        if (path === '/api/instances/reachability' && options?.method === 'POST') {
          return Promise.resolve([])
        }
        if (path.startsWith('/api/collections/monitor_latest_status/records?')) {
          return Promise.resolve({ items: [] })
        }
        if (path.startsWith('/api/collections/secrets/records?filter=')) {
          return Promise.resolve({ items: [{ id: 'secret-1', name: 'db-password' }] })
        }
        if (path === '/api/provider-accounts') {
          return Promise.resolve([])
        }
        if (path === '/api/collections/groups/records?perPage=500&sort=name') {
          return Promise.resolve({ items: [] })
        }
        if (path === "/api/collections/certificates/records?filter=(status='active')&sort=name") {
          return Promise.resolve({ items: [] })
        }
        if (path === '/api/instances/instance-1' && options?.method === 'PUT') {
          return Promise.resolve({ ok: true })
        }
        return Promise.resolve([])
      }
    )

    render(<ServiceInstancesPage />)

    await waitFor(() => {
      expect(screen.getByText('mysql-prod')).toBeInTheDocument()
    })

    fireEvent.pointerDown(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(await screen.findByText('Edit'))

    const hostInput = (await screen.findByLabelText(/^Host/)) as HTMLInputElement
    fireEvent.change(hostInput, { target: { value: 'db-new.example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/instances/instance-1', {
        method: 'PUT',
        body: expect.objectContaining({
          endpoint: 'db-new.example.com:3306',
          template_id: 'generic-mysql',
        }),
      })
    })
  })

  it('creates a password secret inline for mysql', async () => {
    render(<ServiceInstancesPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add Instance' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add Instance' }))
    await screen.findByText('MySQL-Compatible')
    clickChooserOption('MySQL-Compatible')

    fireEvent.click(screen.getByTitle('Use a saved secret'))
    fireEvent.click(screen.getByRole('button', { name: 'New Secret' }))

    expect(
      await screen.findByText(
        'Create a reusable password secret and attach it to this service instance.'
      )
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'mysql-prod-password' } })
    fireEvent.change(screen.getByLabelText('Value *'), { target: { value: 's3cr3t' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Credential' }))

    await waitFor(() => {
      expect(createSecretMock).toHaveBeenCalledWith({
        name: 'mysql-prod-password',
        description: '',
        template_id: 'single_value',
        scope: 'global',
        visible_to: ['service_instance'],
        payload: { value: 's3cr3t' },
      })
    })
  })

  it('overlays live reachability results on top of cached monitor status', async () => {
    sendMock.mockImplementation(
      (path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
        if (path === '/api/instances/templates') {
          return Promise.resolve([
            {
              id: 'generic-redis',
              category: 'cache',
              kind: 'redis-compatible',
              title: 'Generic Redis',
              endpointShape: 'url',
              credentialPresentation: 'secret_or_inline',
              credentialLabel: 'password',
              fields: [],
            },
          ])
        }
        if (path === '/api/instances' && (!options?.method || options.method === 'GET')) {
          return Promise.resolve([
            {
              id: 'instance-live',
              name: 'redis-live',
              kind: 'redis-compatible',
              template_id: 'generic-redis',
              endpoint: 'redis.internal:6379',
              config: {},
            },
          ])
        }
        if (path.startsWith('/api/collections/monitor_latest_status/records?')) {
          return Promise.resolve({
            items: [
              {
                target_id: 'instance-live',
                status: 'unreachable',
                reason: 'cached failure',
                last_checked_at: '2026-04-11T10:00:00Z',
              },
            ],
          })
        }
        if (path === '/api/instances/reachability' && options?.method === 'POST') {
          return Promise.resolve([
            {
              id: 'instance-live',
              status: 'online',
              checked_at: '2026-04-11T10:05:00Z',
            },
          ])
        }
        if (path === '/api/provider-accounts') {
          return Promise.resolve([])
        }
        if (path === SERVICE_INSTANCE_SECRET_PATH) {
          return Promise.resolve({ items: [] })
        }
        if (path === '/api/collections/groups/records?perPage=500&sort=name') {
          return Promise.resolve({ items: [] })
        }
        if (path === "/api/collections/certificates/records?filter=(status='active')&sort=name") {
          return Promise.resolve({ items: [] })
        }
        if (path === '/api/secrets/templates') {
          return Promise.resolve([])
        }
        return Promise.resolve([])
      }
    )

    render(<ServiceInstancesPage />)

    expect(await screen.findByText('redis-live')).toBeInTheDocument()
    expect(await screen.findByText('Healthy')).toBeInTheDocument()
    expect(screen.getByText('2026-04-11 10:05:00')).toBeInTheDocument()
  })

  it('edits an existing secret inline without navigating away', async () => {
    sendMock.mockImplementation(
      (path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
        if (path === '/api/instances/templates') {
          return Promise.resolve([buildMySQLTemplate()])
        }
        if (path === '/api/secrets/templates') {
          return Promise.resolve([
            {
              id: 'single_value',
              label: 'Single Value',
              fields: [{ key: 'value', label: 'Value', type: 'password', required: true }],
            },
          ])
        }
        if (path === '/api/instances' && (!options?.method || options.method === 'GET')) {
          return Promise.resolve([
            {
              id: 'instance-1',
              created: '2026-04-11T08:30:00Z',
              updated: '2026-04-11T09:45:00Z',
              name: 'mysql-prod',
              kind: 'mysql-compatible',
              template_id: 'generic-mysql',
              endpoint: 'db.example.com:3306',
              credential: 'secret-1',
              config: {
                database: 'appdb',
                username: 'root',
                ssl_enabled: true,
              },
            },
          ])
        }
        if (path.startsWith('/api/collections/monitor_latest_status/records?')) {
          return Promise.resolve({ items: [] })
        }
        if (path.startsWith('/api/collections/secrets/records?filter=')) {
          return Promise.resolve({ items: [{ id: 'secret-1', name: 'db-password' }] })
        }
        if (path === '/api/provider-accounts') {
          return Promise.resolve([])
        }
        if (path === '/api/collections/groups/records?perPage=500&sort=name') {
          return Promise.resolve({ items: [] })
        }
        if (path === "/api/collections/certificates/records?filter=(status='active')&sort=name") {
          return Promise.resolve({ items: [] })
        }
        if (path === '/api/secrets/secret-1/payload') {
          return Promise.resolve({ ok: true })
        }
        return Promise.resolve([])
      }
    )

    render(<ServiceInstancesPage />)

    await waitFor(() => {
      expect(screen.getByText('mysql-prod')).toBeInTheDocument()
    })

    fireEvent.pointerDown(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(await screen.findByText('Edit'))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Edit secret' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit secret' }))

    expect(
      await screen.findByText(
        'Update the selected Secret without leaving service instance editing.'
      )
    ).toBeInTheDocument()
    expect(getSecretMock).toHaveBeenCalledWith('secret-1')

    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'db-password-updated' } })
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'updated description' },
    })
    fireEvent.change(await screen.findByLabelText('Value *'), {
      target: { value: 'new-secret-value' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save Secret' }))

    await waitFor(() => {
      expect(updateSecretMock).toHaveBeenCalledWith('secret-1', {
        name: 'db-password-updated',
        description: 'updated description',
      })
    })

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/secrets/secret-1/payload', {
        method: 'PUT',
        body: { payload: { value: 'new-secret-value' } },
      })
    })

    await waitFor(() => {
      expect(
        screen.queryByText('Update the selected Secret without leaving service instance editing.')
      ).not.toBeInTheDocument()
    })
  }, 15000)

  it('stores a typed password in secrets automatically when creating mysql', async () => {
    render(<ServiceInstancesPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add Instance' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add Instance' }))
    await screen.findByText('MySQL-Compatible')
    clickChooserOption('MySQL-Compatible')

    fireEvent.change(screen.getByLabelText(/^Database/), { target: { value: 'appdb' } })
    fireEvent.change(screen.getByLabelText(/^Username/), { target: { value: 'appuser' } })
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 's3cr3t-pass' } })
    fireEvent.change(screen.getByLabelText(/^Host/), { target: { value: 'db.internal' } })
    fireEvent.change(screen.getByLabelText(/^Port/), { target: { value: '3306' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Create' }).at(-1) as HTMLElement)

    await waitFor(() => {
      expect(createSecretMock).toHaveBeenCalledWith(
        expect.objectContaining({
          template_id: 'single_value',
          scope: 'global',
        })
      )
    })

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(
        '/api/instances',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({
            credential: 'secret-created',
            endpoint: 'db.internal:3306',
          }),
        })
      )
    })
  })

  it('reuses the password-or-secret credential flow for redis and kafka kinds', async () => {
    render(<ServiceInstancesPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add Instance' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add Instance' }))
    await screen.findByText('Redis-Compatible')
    clickChooserOption('Redis-Compatible')
    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }))

    expect(await screen.findByLabelText(/^Password/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Use a saved secret'))
    expect(screen.getByPlaceholderText('Search secrets...')).toBeInTheDocument()

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(SERVICE_INSTANCE_SECRET_PATH, {})
    })

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add Instance' }))
    await screen.findByText('Kafka-Compatible')
    clickChooserOption('Kafka-Compatible')
    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }))

    expect(await screen.findByLabelText(/^Credential/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Use a saved secret'))
    expect(screen.getByPlaceholderText('Search secrets...')).toBeInTheDocument()

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(SERVICE_INSTANCE_SECRET_PATH, {})
    })

    expect(sendMock).not.toHaveBeenCalledWith(
      '/api/collections/secrets/records?perPage=500&sort=name',
      {}
    )
  }, 15000)
})
