import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AIChatPage } from './ai-chat'
import { sendAIChatMessage } from '@/lib/ai-chat-api'

const listSessionsMock = vi.fn()
const createSessionMock = vi.fn()
const updateSessionMock = vi.fn()
const deleteSessionMock = vi.fn()
const listMessagesMock = vi.fn()
const sendMessageMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => config,
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => {},
  },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      switch (key) {
        case 'nav.label':
          return 'AI Copilot'
        case 'page.title':
          return 'AI Copilot'
        case 'page.subtitle':
          return 'Resolve tasks faster with context-aware operational guidance.'
        case 'page.loading':
          return 'Loading...'
        case 'page.emptyTitle':
          return 'Start a conversation'
        case 'page.emptyDescription':
          return 'Ask about operations or upload a file for context.'
        case 'page.defaultSessionTitle':
          return 'New chat'
        case 'page.conversationList':
          return 'Conversations'
        case 'actions.refresh':
          return 'Refresh conversations'
        case 'actions.newChat':
          return 'New chat'
        case 'actions.createConversation':
          return 'Create conversation'
        case 'actions.shrinkConversationList':
          return 'Shrink conversation list'
        case 'actions.expandConversationList':
          return 'Expand conversation list'
        case 'actions.save':
          return 'Save'
        case 'actions.cancel':
          return 'Cancel'
        case 'actions.editName':
          return 'Edit name'
        case 'actions.delete':
          return 'Delete'
        case 'actions.uploadFiles':
          return 'Upload files'
        case 'actions.sendMessage':
          return 'Send message'
        case 'actions.copyMarkdown':
          return 'Copy markdown'
        case 'fields.conversationTitle':
          return 'Conversation title'
        case 'fields.messagePlaceholder':
          return 'Ask about operations, diagnosis, or AppOS knowledge'
        case 'fields.fileUpload':
          return 'Chat file upload'
        case 'messages.loadError':
          return 'Failed to load AI Copilot'
        case 'messages.renameError':
          return 'Failed to rename conversation'
        case 'messages.deleteError':
          return 'Failed to delete conversation'
        case 'messages.sendError':
          return 'Failed to send message'
        case 'messages.thinking':
          return 'Thinking...'
        case 'messages.attachedFiles':
          return 'Attached files'
        case 'messages.justNow':
          return 'just now'
        case 'messages.textPreviewSkipped':
          return `Text preview skipped: file exceeds ${options?.limit ?? ''}.`
        case 'messages.textPreviewUnavailable':
          return 'Text preview unavailable for this file.'
        case 'dialog.deleteTitle':
          return 'Delete conversation?'
        case 'dialog.deleteDescriptionPrefix':
          return 'This will permanently delete'
        case 'dialog.deleteDescriptionSuffix':
          return 'and its message history. This action cannot be undone.'
        case 'aria.conversationActions':
          return `Conversation actions for ${options?.title ?? ''}`
        case 'aria.removeAttachment':
          return `Remove ${options?.name ?? ''}`
        default:
          return key
      }
    },
    i18n: { language: 'en' },
  }),
}))

vi.mock('@/lib/ai-chat-api', () => ({
  listAIChatSessions: (...args: unknown[]) => listSessionsMock(...args),
  createAIChatSession: (...args: unknown[]) => createSessionMock(...args),
  updateAIChatSession: (...args: unknown[]) => updateSessionMock(...args),
  deleteAIChatSession: (...args: unknown[]) => deleteSessionMock(...args),
  listAIChatMessages: (...args: unknown[]) => listMessagesMock(...args),
  sendAIChatMessage: (...args: unknown[]) => sendMessageMock(...args),
}))

afterEach(() => {
  cleanup()
})

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: { writeText: vi.fn() },
    configurable: true,
  })
})

describe('AIChatPage', () => {
  beforeEach(() => {
    listSessionsMock.mockReset()
    createSessionMock.mockReset()
    updateSessionMock.mockReset()
    deleteSessionMock.mockReset()
    listMessagesMock.mockReset()
    sendMessageMock.mockReset()
    listSessionsMock.mockResolvedValue([{ id: 'session-1', title: 'Ops chat' }])
    listMessagesMock.mockResolvedValue([
      { id: 'msg-1', session_id: 'session-1', role: 'user', content: 'hello' },
      { id: 'msg-2', session_id: 'session-1', role: 'assistant', content: 'hi' },
    ])
    createSessionMock.mockResolvedValue({ id: 'session-new', title: 'New chat' })
    updateSessionMock.mockResolvedValue({ id: 'session-1', title: 'Renamed chat' })
    deleteSessionMock.mockResolvedValue(undefined)
    vi.mocked(navigator.clipboard.writeText).mockReset()
    vi.mocked(navigator.clipboard.writeText).mockResolvedValue(undefined)
  })

  it('loads sessions and message history', async () => {
    render(<AIChatPage />)

    expect(await screen.findByRole('heading', { name: 'Ops chat' })).toBeInTheDocument()
    expect(await screen.findByText('hello')).toBeInTheDocument()
    expect(screen.getByText('hi')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'AI Copilot' })).toBeInTheDocument()
  })

  it('disables empty sends and renders streamed assistant output', async () => {
    render(<AIChatPage />)
    const input = await screen.findByPlaceholderText('Ask about operations, diagnosis, or AppOS knowledge')
    const sendButton = screen.getByRole('button', { name: 'Send message' })

    expect(sendButton).toBeDisabled()

    sendMessageMock.mockImplementation(
      async (_sessionId: string, _content: string, callbacks: Parameters<typeof sendAIChatMessage>[2]) => {
        callbacks.onChunk('received: ')
        callbacks.onChunk('check nginx')
        callbacks.onDone?.({
          id: 'msg-3',
          session_id: 'session-1',
          role: 'assistant',
          content: 'received: check nginx',
        })
      }
    )

    fireEvent.change(input, { target: { value: 'check nginx' } })
    fireEvent.click(sendButton)

    expect(await screen.findByText('check nginx')).toBeInTheDocument()
    expect(await screen.findByText('received: check nginx')).toBeInTheDocument()
    await waitFor(() =>
      expect(sendMessageMock).toHaveBeenCalledWith('session-1', 'check nginx', expect.any(Object), [])
    )
  })

  it('shows provider setup errors without erasing persisted history', async () => {
    render(<AIChatPage />)
    const input = await screen.findByPlaceholderText('Ask about operations, diagnosis, or AppOS knowledge')
    sendMessageMock.mockRejectedValue(new Error('default LLM provider is not configured'))

    fireEvent.change(input, { target: { value: 'hello again' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    expect(await screen.findByText('default LLM provider is not configured')).toBeInTheDocument()
    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(listMessagesMock).toHaveBeenCalledWith('session-1')
  })

  it('renames and deletes saved conversations', async () => {
    render(<AIChatPage />)

    await screen.findByRole('heading', { name: 'Ops chat' })
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Conversation actions for Ops chat' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit name' }))
    fireEvent.change(screen.getByLabelText('Conversation title'), {
      target: { value: 'Renamed chat' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateSessionMock).toHaveBeenCalledWith('session-1', 'Renamed chat'))
    expect(await screen.findByRole('heading', { name: 'Renamed chat' })).toBeInTheDocument()

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Conversation actions for Renamed chat' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    expect(await screen.findByRole('heading', { name: 'Delete conversation?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(deleteSessionMock).toHaveBeenCalledWith('session-1'))
    expect(createSessionMock).not.toHaveBeenCalled()
    expect(await screen.findByText('Start a conversation')).toBeInTheDocument()
  })

  it('attaches uploaded files when sending a message', async () => {
    render(<AIChatPage />)
    const input = await screen.findByPlaceholderText('Ask about operations, diagnosis, or AppOS knowledge')
    const upload = screen.getByLabelText('Chat file upload') as HTMLInputElement
    const sendButton = screen.getByRole('button', { name: 'Send message' })
    const file = new File(['worker_processes auto;'], 'nginx.conf', { type: 'text/plain' })

    Object.defineProperty(upload, 'files', {
      value: [file],
      configurable: true,
    })
    fireEvent.change(upload)

    sendMessageMock.mockImplementation(
      async (_sessionId: string, _content: string, callbacks: Parameters<typeof sendAIChatMessage>[2]) => {
        callbacks.onDone?.({
          id: 'msg-3',
          session_id: 'session-1',
          role: 'assistant',
          content: 'received attachment',
        })
      }
    )

    fireEvent.change(input, { target: { value: 'review attachment' } })
    await waitFor(() => expect(sendButton).toBeEnabled())
    fireEvent.click(sendButton)

    await waitFor(() =>
      expect(sendMessageMock).toHaveBeenCalledWith(
        'session-1',
        'review attachment',
        expect.any(Object),
        [
          expect.objectContaining({
            name: 'nginx.conf',
            mime_type: 'text/plain',
            text_content: 'worker_processes auto;',
          }),
        ]
      )
    )
    expect(await screen.findByText('received attachment')).toBeInTheDocument()
  })

  it('copies the assistant markdown raw content', async () => {
    render(<AIChatPage />)

    await screen.findByText('hi')
    fireEvent.click(screen.getByRole('button', { name: 'Copy markdown' }))

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hi'))
  })

  it('renders assistant markdown tables', async () => {
    listMessagesMock.mockResolvedValueOnce([
      { id: 'msg-1', session_id: 'session-1', role: 'assistant', content: '| Name | Value |\n| --- | --- |\n| CPU | 20% |' },
    ])

    render(<AIChatPage />)

    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'CPU' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '20%' })).toBeInTheDocument()
  })

  it('creates a new conversation from the conversations header plus button', async () => {
    render(<AIChatPage />)

    await screen.findByRole('heading', { name: 'Ops chat' })
    fireEvent.click(screen.getByRole('button', { name: 'Create conversation' }))

    await waitFor(() => expect(createSessionMock).toHaveBeenCalledTimes(1))
  })

  it('keeps a true empty state when no conversations exist', async () => {
    listSessionsMock.mockResolvedValueOnce([])

    render(<AIChatPage />)

    expect(await screen.findByText('Start a conversation')).toBeInTheDocument()
    expect(createSessionMock).not.toHaveBeenCalled()
    expect(screen.getAllByRole('heading', { name: 'AI Copilot' })).toHaveLength(2)
    expect(screen.getByPlaceholderText('Ask about operations, diagnosis, or AppOS knowledge')).toBeEnabled()
  })

  it('creates a conversation when sending the first message from an empty state', async () => {
    listSessionsMock.mockResolvedValueOnce([])
    sendMessageMock.mockImplementation(
      async (_sessionId: string, _content: string, callbacks: Parameters<typeof sendAIChatMessage>[2]) => {
        callbacks.onDone?.({
          id: 'msg-3',
          session_id: 'session-new',
          role: 'assistant',
          content: 'created on demand',
        })
      }
    )

    render(<AIChatPage />)

    const input = await screen.findByPlaceholderText('Ask about operations, diagnosis, or AppOS knowledge')
    fireEvent.change(input, { target: { value: 'hello from empty state' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => expect(createSessionMock).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(sendMessageMock).toHaveBeenCalledWith('session-new', 'hello from empty state', expect.any(Object), [])
    )
    expect(await screen.findByText('created on demand')).toBeInTheDocument()
  })
})