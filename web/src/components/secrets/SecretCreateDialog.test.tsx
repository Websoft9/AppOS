import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SecretCreateDialog } from './SecretCreateDialog'

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
  })
})
