import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AICopilotPage } from './ai-copilot'
import { sendAICopilotMessage } from '@/lib/ai-copilot-api'

const listSessionsMock = vi.fn()
const createSessionMock = vi.fn()
const updateSessionMock = vi.fn()
const deleteSessionMock = vi.fn()
const listMessagesMock = vi.fn()
const listModelsMock = vi.fn()
const sendMessageMock = vi.fn()
const listAssetsMock = vi.fn()
const getAssetContentMock = vi.fn()
const navigateMock = vi.fn()
const extractPdfTextMock = vi.fn()
const extractDocxTextMock = vi.fn()
const extractSpreadsheetTextMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => config,
  useNavigate: () => navigateMock,
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
        case 'actions.uploadFilesHelp':
          return 'Supported for reading: text files, PDF, DOCX, XLSX, XLSM, CSV'
        case 'actions.sendMessage':
          return 'Send message'
        case 'actions.copyMarkdown':
          return 'Copy markdown'
        case 'actions.configureModels':
          return 'Configure models'
        case 'actions.tokenUsage':
          return 'Token usage'
        case 'fields.conversationTitle':
          return 'Conversation title'
        case 'fields.messagePlaceholder':
          return 'Ask any things...'
        case 'fields.fileUpload':
          return 'Chat file upload'
        case 'fields.modelSearchPlaceholder':
          return 'Search models...'
        case 'fields.noModelsAvailable':
          return 'No AI models available'
        case 'fields.noModelsMatchSearch':
          return 'No models match your search'
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
        case 'messages.unsupportedAttachmentType':
          return 'Only text, PDF, DOCX, XLSX, XLSM, and CSV uploads can be read here.'
        case 'messages.readingAttachments':
          return `Reading ${options?.count ?? ''} attachment(s)...`
        case 'messages.attachmentsReady':
          return `Read ${options?.count ?? ''} attachment(s). Ready to send to the AI model.`
        case 'messages.attachmentsUnreadable':
          return 'The selected attachment(s) could not be read. Fix or remove them before sending.'
        case 'messages.attachmentsPartialReady':
          return `Read ${options?.count ?? ''} attachment(s). ${options?.failed ?? ''} attachment(s) will be skipped.`
        case 'messages.attachmentsNeedReadableContent':
          return 'No readable attachment content is available yet. Remove the failed files or add a new message before sending.'
        case 'messages.submittingAttachments':
          return `Submitting ${options?.count ?? ''} attachment(s) to the AI model...`
        case 'dialog.deleteTitle':
          return 'Delete conversation?'
        case 'dialog.deleteDescriptionPrefix':
          return 'This will permanently delete'
        case 'dialog.deleteDescriptionSuffix':
          return 'and its message history. This action cannot be undone.'
        case 'tokens.title':
          return 'Token usage estimate'
        case 'tokens.description':
          return 'Approximate budget for the next request with the selected model.'
        case 'tokens.currentModel':
          return 'Current model'
        case 'tokens.contextWindow':
          return 'Context window'
        case 'tokens.maxOutput':
          return 'Max output'
        case 'tokens.inputBudget':
          return 'Input budget'
        case 'tokens.visibleConversation':
          return 'Visible conversation'
        case 'tokens.currentDraft':
          return 'Current draft'
        case 'tokens.nextRequestEstimate':
          return 'Next request estimate'
        case 'tokens.remainingInput':
          return 'Remaining input'
        case 'tokens.note':
          return 'This is an estimate based on visible chat content and attachments. The server may further summarize or trim history before sending the final request.'
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

vi.mock('@/lib/ai-copilot-api', () => ({
  listAICopilotSessions: (...args: unknown[]) => listSessionsMock(...args),
  createAICopilotSession: (...args: unknown[]) => createSessionMock(...args),
  updateAICopilotSession: (...args: unknown[]) => updateSessionMock(...args),
  deleteAICopilotSession: (...args: unknown[]) => deleteSessionMock(...args),
  listAICopilotMessages: (...args: unknown[]) => listMessagesMock(...args),
  listAICopilotModels: (...args: unknown[]) => listModelsMock(...args),
  sendAICopilotMessage: (...args: unknown[]) => sendMessageMock(...args),
}))

vi.mock('@/lib/assets-api', () => ({
  listAssets: (...args: unknown[]) => listAssetsMock(...args),
  getAssetContent: (...args: unknown[]) => getAssetContentMock(...args),
}))

vi.mock('@/lib/document-extraction', () => ({
  extractPdfText: (...args: unknown[]) => extractPdfTextMock(...args),
  extractDocxText: (...args: unknown[]) => extractDocxTextMock(...args),
  extractSpreadsheetText: (...args: unknown[]) => extractSpreadsheetTextMock(...args),
  isPdfFile: (file: File) => file.name.toLowerCase().endsWith('.pdf'),
  isDocxFile: (file: File) => file.name.toLowerCase().endsWith('.docx'),
  isSpreadsheetFile: (file: File) =>
    ['.xlsx', '.xlsm', '.csv'].some(ext => file.name.toLowerCase().endsWith(ext)),
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

describe('AICopilotPage', () => {
  beforeEach(() => {
    localStorage.clear()
    listSessionsMock.mockReset()
    createSessionMock.mockReset()
    updateSessionMock.mockReset()
    deleteSessionMock.mockReset()
    listMessagesMock.mockReset()
    listModelsMock.mockReset()
    sendMessageMock.mockReset()
    listAssetsMock.mockReset()
    getAssetContentMock.mockReset()
    navigateMock.mockReset()
    extractPdfTextMock.mockReset()
    extractDocxTextMock.mockReset()
    extractSpreadsheetTextMock.mockReset()
    listSessionsMock.mockResolvedValue([{ id: 'session-1', title: 'Ops chat' }])
    listMessagesMock.mockResolvedValue([
      { id: 'msg-1', session_id: 'session-1', role: 'user', content: 'hello' },
      { id: 'msg-2', session_id: 'session-1', role: 'assistant', content: 'hi' },
    ])
    listModelsMock.mockResolvedValue([
      {
        provider_id: 'provider-1',
        endpoint: 'https://openrouter.ai/api/v1',
        model_id: 'openai/gpt-4.1-mini',
        label: 'openai/gpt-4.1-mini · OpenRouter',
        context_size: 131072,
        max_completion_tokens: 31100,
      },
      {
        provider_id: 'provider-2',
        endpoint: 'https://api.openai.com/v1',
        model_id: 'gpt-4.1',
        label: 'gpt-4.1',
        context_size: 128000,
        max_completion_tokens: 16384,
      },
    ])
    createSessionMock.mockResolvedValue({ id: 'session-new', title: 'New chat' })
    updateSessionMock.mockResolvedValue({ id: 'session-1', title: 'Renamed chat' })
    deleteSessionMock.mockResolvedValue(undefined)
    listAssetsMock.mockResolvedValue([
      {
        id: 'prompt-system',
        name: 'Default system prompt',
        kind: 'prompt',
        storage_kind: 'file',
        source_kind: 'local',
        path: 'default-system-prompt.md',
        entrypoint: '',
        prompt_scope: 'system',
      },
      {
        id: 'prompt-task',
        name: 'Task helper',
        kind: 'prompt',
        storage_kind: 'file',
        source_kind: 'local',
        path: 'task-helper.md',
        entrypoint: '',
        prompt_scope: 'task',
      },
    ])
    getAssetContentMock.mockResolvedValue({
      id: 'prompt-task',
      storage_kind: 'file',
      path: 'task-helper.md',
      entrypoint: '',
      content: 'Task helper content',
    })
    vi.mocked(navigator.clipboard.writeText).mockReset()
    vi.mocked(navigator.clipboard.writeText).mockResolvedValue(undefined)
    extractPdfTextMock.mockResolvedValue('pdf content')
    extractDocxTextMock.mockResolvedValue('docx content')
    extractSpreadsheetTextMock.mockResolvedValue('sheet content')
  })

  it('loads sessions and message history', async () => {
    render(<AICopilotPage />)

    expect(await screen.findByRole('heading', { name: 'Ops chat' })).toBeInTheDocument()
    expect(await screen.findByText('hello')).toBeInTheDocument()
    expect(screen.getByText('hi')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'AI Copilot' })).toBeInTheDocument()
  })

  it('consumes a handed-off draft from assets', async () => {
    localStorage.setItem('ai-copilot.draft-handoff.v1', 'Refine this prompt')

    render(<AICopilotPage />)

    const input = await screen.findByPlaceholderText('Ask any things...')

    expect(input).toHaveValue('Refine this prompt')
    expect(localStorage.getItem('ai-copilot.draft-handoff.v1')).toBeNull()
  })

  it('creates a new conversation from a system prompt handoff', async () => {
    localStorage.setItem(
      'ai-copilot.session-handoff.v1',
      JSON.stringify({ systemPromptAssetId: 'prompt-system' })
    )

    render(<AICopilotPage />)

    await waitFor(() =>
      expect(createSessionMock).toHaveBeenCalledWith({ systemPromptAssetId: 'prompt-system' })
    )
    expect(await screen.findByRole('heading', { name: 'New chat' })).toBeInTheDocument()
    expect(localStorage.getItem('ai-copilot.session-handoff.v1')).toBeNull()
  })

  it('disables empty sends and renders streamed assistant output', async () => {
    render(<AICopilotPage />)
    const input = await screen.findByPlaceholderText('Ask any things...')
    const sendButton = screen.getByRole('button', { name: 'Send message' })

    expect(sendButton).toBeDisabled()

    sendMessageMock.mockImplementation(
      async (
        _sessionId: string,
        _content: string,
        _providerId: string,
        _model: string,
        callbacks: Parameters<typeof sendAICopilotMessage>[4]
      ) => {
        callbacks.onChunk('received: ')
        callbacks.onChunk('check traefik')
        callbacks.onDone?.({
          id: 'msg-3',
          session_id: 'session-1',
          role: 'assistant',
          content: 'received: check traefik',
        })
      }
    )

    fireEvent.change(input, { target: { value: 'check traefik' } })
    fireEvent.click(sendButton)

    expect(await screen.findByText('check traefik')).toBeInTheDocument()
    expect(await screen.findByText('received: check traefik')).toBeInTheDocument()
    await waitFor(() =>
      expect(sendMessageMock).toHaveBeenCalledWith(
        'session-1',
        'check traefik',
        'provider-1',
        'openai/gpt-4.1-mini',
        expect.any(Object),
        [],
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    )
  })

  it('lets the user switch to another provider-backed model before sending', async () => {
    render(<AICopilotPage />)

    const input = await screen.findByPlaceholderText('Ask any things...')
    const modelTrigger = await screen.findByText('openai/gpt-4.1-mini · OpenRouter')
    fireEvent.click(modelTrigger)
    const gptOption = await screen.findByText('gpt-4.1')
    expect(gptOption).toBeInTheDocument()
    fireEvent.click(gptOption)

    sendMessageMock.mockImplementation(
      async (
        _sessionId: string,
        _content: string,
        _providerId: string,
        _model: string,
        callbacks: Parameters<typeof sendAICopilotMessage>[4]
      ) => {
        callbacks.onDone?.({
          id: 'msg-3',
          session_id: 'session-1',
          role: 'assistant',
          content: 'switched provider',
        })
      }
    )

    fireEvent.change(input, { target: { value: 'use direct openai' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() =>
      expect(sendMessageMock).toHaveBeenCalledWith(
        'session-1',
        'use direct openai',
        'provider-2',
        'gpt-4.1',
        expect.any(Object),
        [],
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    )
  })

  it('navigates to AI providers when configuring models', async () => {
    render(<AICopilotPage />)

    const modelTrigger = await screen.findByText('openai/gpt-4.1-mini · OpenRouter')
    fireEvent.click(modelTrigger)
    fireEvent.click(await screen.findByRole('button', { name: 'Configure models' }))

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/resources/ai-providers',
        search: { create: undefined },
      })
    })
  })

  it('shows estimated token usage details for the selected model', async () => {
    render(<AICopilotPage />)

    await screen.findByRole('heading', { name: 'Ops chat' })
    fireEvent.change(screen.getByPlaceholderText('Ask any things...'), {
      target: { value: 'Check traefik logs and summarize the findings' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Token usage' }))

    expect(await screen.findByText('Token usage estimate')).toBeInTheDocument()
    expect(screen.getByText('Current model')).toBeInTheDocument()
    expect(screen.getByText('Input budget')).toBeInTheDocument()
    expect(screen.getByText('31,100')).toBeInTheDocument()
  })

  it('shows provider setup errors without erasing persisted history', async () => {
    render(<AICopilotPage />)
    const input = await screen.findByPlaceholderText('Ask any things...')
    sendMessageMock.mockRejectedValue(new Error('default LLM provider is not configured'))

    fireEvent.change(input, { target: { value: 'hello again' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    expect(await screen.findByText('default LLM provider is not configured')).toBeInTheDocument()
    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(listMessagesMock).toHaveBeenCalledWith('session-1')
  })

  it('renames and deletes saved conversations', async () => {
    render(<AICopilotPage />)

    await screen.findByRole('heading', { name: 'Ops chat' })
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Conversation actions for Ops chat' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit name' }))
    fireEvent.change(screen.getByLabelText('Conversation title'), {
      target: { value: 'Renamed chat' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateSessionMock).toHaveBeenCalledWith('session-1', { title: 'Renamed chat' })
    )
    expect(await screen.findByRole('heading', { name: 'Renamed chat' })).toBeInTheDocument()

    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Conversation actions for Renamed chat' })
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    expect(await screen.findByRole('heading', { name: 'Delete conversation?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(deleteSessionMock).toHaveBeenCalledWith('session-1'))
    expect(createSessionMock).not.toHaveBeenCalled()
    expect(await screen.findByText('Start a conversation')).toBeInTheDocument()
  })

  it('attaches uploaded files when sending a message', async () => {
    render(<AICopilotPage />)
    const input = await screen.findByPlaceholderText('Ask any things...')
    const upload = screen.getByLabelText('Chat file upload') as HTMLInputElement
    const sendButton = screen.getByRole('button', { name: 'Send message' })
    const file = new File(['http:\n  routers: {}\n'], 'traefik.yml', { type: 'text/plain' })

    Object.defineProperty(upload, 'files', {
      value: [file],
      configurable: true,
    })
    fireEvent.change(upload)

    sendMessageMock.mockImplementation(
      async (
        _sessionId: string,
        _content: string,
        _providerId: string,
        _model: string,
        callbacks: Parameters<typeof sendAICopilotMessage>[4]
      ) => {
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
        'provider-1',
        'openai/gpt-4.1-mini',
        expect.any(Object),
        [
          expect.objectContaining({
            name: 'traefik.yml',
            mime_type: 'text/plain',
            text_content: 'http:\n  routers: {}',
          }),
        ],
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    )
    expect(await screen.findByText('received attachment')).toBeInTheDocument()
  })

  it('reads uploaded pdf files before sending them', async () => {
    render(<AICopilotPage />)
    const input = await screen.findByPlaceholderText('Ask any things...')
    const upload = screen.getByLabelText('Chat file upload') as HTMLInputElement
    const sendButton = screen.getByRole('button', { name: 'Send message' })
    const file = new File(['pdf'], 'report.pdf', { type: 'application/pdf' })

    Object.defineProperty(upload, 'files', {
      value: [file],
      configurable: true,
    })
    fireEvent.change(upload)

    sendMessageMock.mockResolvedValue(undefined)

    await screen.findByText('Read 1 attachment(s). Ready to send to the AI model.')
    fireEvent.change(input, { target: { value: 'review pdf' } })
    fireEvent.click(sendButton)

    await waitFor(() =>
      expect(sendMessageMock).toHaveBeenCalledWith(
        'session-1',
        'review pdf',
        'provider-1',
        'openai/gpt-4.1-mini',
        expect.any(Object),
        [
          expect.objectContaining({
            name: 'report.pdf',
            text_content: 'pdf content',
          }),
        ],
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    )
  })

  it('reads uploaded spreadsheet files before sending them', async () => {
    render(<AICopilotPage />)
    const input = await screen.findByPlaceholderText('Ask any things...')
    const upload = screen.getByLabelText('Chat file upload') as HTMLInputElement
    const sendButton = screen.getByRole('button', { name: 'Send message' })
    const file = new File(['sheet'], 'report.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    Object.defineProperty(upload, 'files', {
      value: [file],
      configurable: true,
    })
    fireEvent.change(upload)

    sendMessageMock.mockResolvedValue(undefined)

    await screen.findByText('Read 1 attachment(s). Ready to send to the AI model.')
    fireEvent.change(input, { target: { value: 'review spreadsheet' } })
    fireEvent.click(sendButton)

    await waitFor(() =>
      expect(sendMessageMock).toHaveBeenCalledWith(
        'session-1',
        'review spreadsheet',
        'provider-1',
        'openai/gpt-4.1-mini',
        expect.any(Object),
        [
          expect.objectContaining({
            name: 'report.xlsx',
            text_content: 'sheet content',
          }),
        ],
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    )
  })

  it('does not call the model when only unreadable attachments are present', async () => {
    render(<AICopilotPage />)
    const upload = (await screen.findByLabelText('Chat file upload')) as HTMLInputElement
    const sendButton = screen.getByRole('button', { name: 'Send message' })
    const file = new File(['legacy doc'], 'legacy.doc', { type: 'application/msword' })

    Object.defineProperty(upload, 'files', {
      value: [file],
      configurable: true,
    })
    fireEvent.change(upload)

    await waitFor(() => {
      expect(sendButton).toBeEnabled()
    })
    fireEvent.click(sendButton)

    expect(sendMessageMock).not.toHaveBeenCalled()
    expect(
      await screen.findByText(
        'No readable attachment content is available yet. Remove the failed files or add a new message before sending.'
      )
    ).toBeInTheDocument()
  })

  it('copies the assistant markdown raw content', async () => {
    render(<AICopilotPage />)

    await screen.findByText('hi')
    fireEvent.click(screen.getByRole('button', { name: 'Copy markdown' }))

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hi'))
  })

  it('loads assistant markdown table content without crashing', async () => {
    listMessagesMock.mockResolvedValue([
      {
        id: 'msg-1',
        session_id: 'session-1',
        role: 'assistant',
        content: '| Name | Value |\n| --- | --- |\n| CPU | 20% |',
      },
    ])

    render(<AICopilotPage />)

    await waitFor(() => expect(listMessagesMock).toHaveBeenCalledWith('session-1'))
    expect(await screen.findByRole('button', { name: 'Copy markdown' })).toBeInTheDocument()
  })

  it('creates a new conversation from the conversations header plus button', async () => {
    render(<AICopilotPage />)

    await screen.findByRole('heading', { name: 'Ops chat' })
    fireEvent.click(screen.getByRole('button', { name: 'Create conversation' }))

    await waitFor(() => expect(createSessionMock).toHaveBeenCalledTimes(1))
  })

  it('keeps a true empty state when no conversations exist', async () => {
    listSessionsMock.mockResolvedValueOnce([])

    render(<AICopilotPage />)

    expect(await screen.findByText('Start a conversation')).toBeInTheDocument()
    expect(createSessionMock).not.toHaveBeenCalled()
    expect(screen.getAllByRole('heading', { name: 'AI Copilot' })).toHaveLength(2)
    expect(screen.getByPlaceholderText('Ask any things...')).toBeEnabled()
  })

  it('creates a conversation when sending the first message from an empty state', async () => {
    listSessionsMock.mockResolvedValueOnce([])
    sendMessageMock.mockImplementation(
      async (
        _sessionId: string,
        _content: string,
        _providerId: string,
        _model: string,
        callbacks: Parameters<typeof sendAICopilotMessage>[4]
      ) => {
        callbacks.onDone?.({
          id: 'msg-3',
          session_id: 'session-new',
          role: 'assistant',
          content: 'created on demand',
        })
      }
    )

    render(<AICopilotPage />)

    const input = await screen.findByPlaceholderText('Ask any things...')
    fireEvent.change(input, { target: { value: 'hello from empty state' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => expect(createSessionMock).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(sendMessageMock).toHaveBeenCalledWith(
        'session-new',
        'hello from empty state',
        'provider-1',
        'openai/gpt-4.1-mini',
        expect.any(Object),
        [],
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    )
    expect(await screen.findByText('created on demand')).toBeInTheDocument()
  })

  it('opens the system prompt chooser from empty-state overflow instead of task instructions', async () => {
    listSessionsMock.mockResolvedValueOnce([])
    listAssetsMock.mockResolvedValueOnce([
      {
        id: 'system-1',
        name: 'System 1',
        kind: 'prompt',
        storage_kind: 'file',
        source_kind: 'local',
        path: 'system-1.md',
        entrypoint: '',
        prompt_scope: 'system',
      },
      {
        id: 'system-2',
        name: 'System 2',
        kind: 'prompt',
        storage_kind: 'file',
        source_kind: 'local',
        path: 'system-2.md',
        entrypoint: '',
        prompt_scope: 'system',
      },
      {
        id: 'system-3',
        name: 'System 3',
        kind: 'prompt',
        storage_kind: 'file',
        source_kind: 'local',
        path: 'system-3.md',
        entrypoint: '',
        prompt_scope: 'system',
      },
      {
        id: 'system-4',
        name: 'System 4',
        kind: 'prompt',
        storage_kind: 'file',
        source_kind: 'local',
        path: 'system-4.md',
        entrypoint: '',
        prompt_scope: 'system',
      },
      {
        id: 'system-5',
        name: 'System 5',
        kind: 'prompt',
        storage_kind: 'file',
        source_kind: 'local',
        path: 'system-5.md',
        entrypoint: '',
        prompt_scope: 'system',
      },
      {
        id: 'system-6',
        name: 'System 6',
        kind: 'prompt',
        storage_kind: 'file',
        source_kind: 'local',
        path: 'system-6.md',
        entrypoint: '',
        prompt_scope: 'system',
      },
      {
        id: 'task-1',
        name: 'Task helper',
        kind: 'prompt',
        storage_kind: 'file',
        source_kind: 'local',
        path: 'task-1.md',
        entrypoint: '',
        prompt_scope: 'task',
      },
    ])

    render(<AICopilotPage />)

    expect(await screen.findByText('Start a conversation')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '+2 more' }))

    expect(await screen.findByText('System 6')).toBeInTheDocument()
  })
})
