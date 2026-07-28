import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SecretCreateDialog } from './SecretCreateDialog'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'form.type': 'Type',
        'form.selectType': 'Select type',
        'form.selectTypeHint': 'Select type to render fields',
        'form.showValue': 'Show value',
        'form.hideValue': 'Hide value',
        'form.sshKeyHintPublic':
          'This looks like a public key. Paste or upload the private key instead.',
        'form.sshKeyHintPPK':
          'PuTTY PPK files are not supported here. Export the key as OpenSSH or PEM private key text.',
        'form.generate': 'Generate',
        'visibility.title': 'Visible In',
        'visibility.description': 'Choose which resource dialogs can discover this secret.',
        'visibility.all': 'All supported dialogs',
        'visibility.none': 'No dialogs selected',
        'visibility.selectedCount': '{{count}} targets selected',
        'visibility.servers': 'Servers',
        'visibility.serversDescription': 'Shown in server credential forms.',
        'visibility.applications': 'Applications',
        'visibility.applicationsDescription': 'Shown in application credential forms.',
        'visibility.runtimeInstances': 'Runtime Instances',
        'visibility.runtimeInstancesDescription': 'Shown in runtime instance forms.',
        'visibility.externalServices': 'External Services',
        'visibility.externalServicesDescription': 'Shown in external service credential forms.',
        'visibility.providerAccounts': 'Provider Accounts',
        'visibility.providerAccountsDescription': 'Shown in provider account forms.',
        'visibility.aiProviders': 'AI Providers',
        'visibility.aiProvidersDescription': 'Shown in AI provider forms.',
        'dialogs.name': 'Name',
        'dialogs.description': 'Description',
        'dialogs.advanced': 'Advanced',
        'common:cancel': 'Cancel',
        'generator.secretValueTitle': 'Generate Secret Value',
        'generator.secretValueDescription': 'Choose the value length before filling the field.',
        'generator.secretValueLengthLabel': 'Value Length',
        'generator.secretValueConfirmLabel': 'Fill Secret Value',
      }

      const template = translations[key]
      if (!template) return key
      return template.replace(/\{\{(\w+)\}\}/g, (_, token: string) => String(values?.[token] ?? ''))
    },
  }),
}))

const sendMock = vi.fn()
const createMock = vi.fn()

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
    collection: () => ({
      create: (...args: unknown[]) => createMock(...args),
    }),
  },
}))

vi.mock('./PasswordGeneratorDialog', () => ({
  PasswordGeneratorDialog: ({ open }: { open: boolean }) =>
    open ? <div>Generate Secret Value</div> : null,
}))

describe('SecretCreateDialog', () => {
  beforeEach(() => {
    sendMock.mockReset()
    createMock.mockReset()
    sendMock.mockResolvedValue([
      {
        id: 'single_value',
        label: 'Password',
        description: 'Single secret value',
        fields: [{ key: 'value', label: 'Secret Value', type: 'password', required: true }],
      },
    ])
  })

  afterEach(() => {
    cleanup()
  })

  it('prefills the name, keeps description last, and supports password reveal', async () => {
    render(
      <SecretCreateDialog
        open
        onOpenChange={() => {}}
        title="Create Credential"
        description="Create a reusable credential and attach it to this server."
        allowedTemplateIds={['single_value']}
        templateLabels={{ single_value: 'Password' }}
        defaultTemplateId="single_value"
        defaultName="server-credential-123456"
        onCreated={() => {}}
      />
    )

    await waitFor(() => {
      expect(screen.getByLabelText('Name *')).toHaveValue('server-credential-123456')
    })

    expect(screen.getByLabelText('Secret Value *')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create Credential' })).toBeInTheDocument()
    expect(screen.queryByText('Single secret value')).toBeNull()

    const secretValueField = screen.getByLabelText('Secret Value *')
    expect(secretValueField).toHaveAttribute('type', 'password')

    fireEvent.click(screen.getByTitle('Show value'))
    expect(secretValueField).toHaveAttribute('type', 'text')

    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))

    const secretValueLabel = screen.getByText('Secret Value *')
    const descriptionLabel = screen.getByText('Description')
    expect(
      secretValueLabel.compareDocumentPosition(descriptionLabel) & Node.DOCUMENT_POSITION_FOLLOWING
    ).not.toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    expect(screen.getByText('Generate Secret Value')).toBeInTheDocument()
  })

  it('keeps SSH key textareas at a fixed size after upload-style content is loaded', async () => {
    sendMock.mockResolvedValueOnce([
      {
        id: 'ssh_key',
        label: 'SSH Key',
        fields: [
          {
            key: 'private_key',
            label: 'Private Key',
            type: 'textarea',
            required: true,
            upload: true,
          },
          {
            key: 'passphrase',
            label: 'Passphrase',
            type: 'password',
            description: 'Optional. Only fill this when the private key itself is encrypted.',
          },
        ],
      },
    ])

    render(
      <SecretCreateDialog
        open
        onOpenChange={() => {}}
        title="Create Credential"
        description="Create a reusable credential and attach it to this server."
        allowedTemplateIds={['ssh_key']}
        templateLabels={{ ssh_key: 'SSH Key' }}
        defaultTemplateId="ssh_key"
        defaultName="server-credential-123456"
        onCreated={() => {}}
      />
    )

    const privateKeyField = await screen.findByLabelText('Private Key *')
    expect(privateKeyField).toHaveStyle({ fieldSizing: 'fixed' })
    expect(privateKeyField).toHaveClass('min-h-32', 'max-h-80', 'resize-y', 'overflow-auto')
    expect(
      screen.getByText('Optional. Only fill this when the private key itself is encrypted.')
    ).toBeInTheDocument()
  })

  it('shows lightweight hints for public keys and PPK content in ssh key forms', async () => {
    sendMock.mockResolvedValueOnce([
      {
        id: 'ssh_key',
        label: 'SSH Key',
        fields: [
          {
            key: 'private_key',
            label: 'Private Key',
            type: 'textarea',
            required: true,
            upload: true,
          },
        ],
      },
    ])

    render(
      <SecretCreateDialog
        open
        onOpenChange={() => {}}
        title="Create Credential"
        description="Create a reusable credential and attach it to this server."
        allowedTemplateIds={['ssh_key']}
        templateLabels={{ ssh_key: 'SSH Key' }}
        defaultTemplateId="ssh_key"
        defaultName="server-credential-123456"
        onCreated={() => {}}
      />
    )

    const privateKeyField = (await screen.findByLabelText('Private Key *')) as HTMLTextAreaElement

    fireEvent.change(privateKeyField, {
      target: { value: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBrokenExample user@example' },
    })
    expect(
      screen.getByText('This looks like a public key. Paste or upload the private key instead.')
    ).toBeInTheDocument()

    fireEvent.change(privateKeyField, {
      target: { value: 'PuTTY-User-Key-File-3: ssh-ed25519\nEncryption: none\nComment: test' },
    })
    expect(
      screen.getByText(
        'PuTTY PPK files are not supported here. Export the key as OpenSSH or PEM private key text.'
      )
    ).toBeInTheDocument()
  })

  it('stores the invoking resource visibility under Advanced', async () => {
    render(
      <SecretCreateDialog
        open
        onOpenChange={() => {}}
        title="Create Credential"
        description="Create a reusable credential and attach it to this server."
        allowedTemplateIds={['single_value']}
        templateLabels={{ single_value: 'Password' }}
        defaultTemplateId="single_value"
        defaultVisibleTo={['server']}
        onCreated={() => {}}
      />
    )

    await screen.findByLabelText('Secret Value *')
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))
    expect(screen.getByText('Visible In')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'server-secret' } })
    fireEvent.change(screen.getByLabelText('Secret Value *'), { target: { value: 'top-secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Credential' }))

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          visible_to: ['server'],
        })
      )
    })
  })
})
