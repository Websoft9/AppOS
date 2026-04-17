import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SecretCreateDialog } from './SecretCreateDialog'

const sendMock = vi.fn()

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
    collection: () => ({
      create: vi.fn(),
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

  it('prefills the name and shows Generate beside the secret value field', async () => {
    render(
      <SecretCreateDialog
        open
        onOpenChange={() => {}}
        title="Create Credential Secret"
        description="Create a reusable credential secret and attach it to this server."
        allowedTemplateIds={['single_value']}
        templateLabels={{ single_value: 'Password' }}
        defaultTemplateId="single_value"
        defaultName="server-credential-123456"
        onCreated={() => {}}
      />
    )

    await waitFor(() => {
      expect(screen.getByLabelText('Name')).toHaveValue('server-credential-123456')
    })

    expect(screen.getByLabelText('Secret Value *')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate Secret Value' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    expect(screen.getByText('Generate Secret Value')).toBeInTheDocument()
  })
})
