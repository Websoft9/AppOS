import { pb } from '@/lib/pb'

export type AICopilotSession = {
  id: string
  title: string
  system_prompt_asset_id?: string
  created_at?: string
  updated_at?: string
  last_message_at?: string
}

export type AICopilotMessage = {
  id: string
  session_id: string
  role: 'system' | 'user' | 'assistant'
  content: string
  status?: string
  created_at?: string
}

export type AICopilotAttachment = {
  name: string
  mime_type?: string
  size?: number
  text_content?: string
  record_id?: string
}

export type AICopilotModelOption = {
  provider_id: string
  endpoint: string
  model_id: string
  label: string
  provider_name?: string
  provider_mode?: string
  gateway_name?: string
  context_size?: number
  max_completion_tokens?: number
}

export async function listAICopilotSessions(): Promise<AICopilotSession[]> {
  const response = (await pb.send('/api/ai/copilot/sessions', { method: 'GET' })) as {
    items?: AICopilotSession[]
  }
  return Array.isArray(response.items) ? response.items : []
}

export async function createAICopilotSession(input?: {
  title?: string
  systemPromptAssetId?: string
}): Promise<AICopilotSession> {
  return (await pb.send('/api/ai/copilot/sessions', {
    method: 'POST',
    body: {
      title: input?.title ?? '',
      system_prompt_asset_id: input?.systemPromptAssetId ?? '',
    },
  })) as AICopilotSession
}

export async function updateAICopilotSession(
  sessionId: string,
  patch: { title?: string; systemPromptAssetId?: string }
): Promise<AICopilotSession> {
  return (await pb.send(`/api/ai/copilot/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    body: {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.systemPromptAssetId !== undefined
        ? { system_prompt_asset_id: patch.systemPromptAssetId }
        : {}),
    },
  })) as AICopilotSession
}

export async function deleteAICopilotSession(sessionId: string): Promise<void> {
  await pb.send(`/api/ai/copilot/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  })
}

export async function listAICopilotMessages(sessionId: string): Promise<AICopilotMessage[]> {
  const response = (await pb.send(
    `/api/ai/copilot/sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      method: 'GET',
    }
  )) as { items?: AICopilotMessage[] }
  return Array.isArray(response.items) ? response.items : []
}

export async function listAICopilotModels(): Promise<AICopilotModelOption[]> {
  const response = (await pb.send('/api/ai-providers/chat-models', {
    method: 'GET',
  })) as { items?: AICopilotModelOption[] }
  return Array.isArray(response.items) ? response.items : []
}

type StreamCallbacks = {
  onChunk: (content: string) => void
  onDone?: (message: AICopilotMessage) => void
}

type SendAICopilotMessageOptions = {
  signal?: AbortSignal
}

export async function sendAICopilotMessage(
  sessionId: string,
  content: string,
  providerId: string,
  model: string,
  callbacks: StreamCallbacks,
  attachments: AICopilotAttachment[] = [],
  options: SendAICopilotMessageOptions = {}
): Promise<void> {
  const response = await fetch(
    `/api/ai/copilot/sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: pb.authStore.token,
      },
      body: JSON.stringify({ content, provider_id: providerId, model, attachments }),
      signal: options.signal,
    }
  )
  if (!response.ok) {
    throw new Error(`Chat request failed with status ${response.status}`)
  }
  if (!response.body) {
    throw new Error('Chat stream is not available')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      handleSSEFrame(frame, callbacks)
    }
  }

  if (buffer.trim()) {
    handleSSEFrame(buffer, callbacks)
  }
}

function handleSSEFrame(frame: string, callbacks: StreamCallbacks) {
  const lines = frame.split('\n')
  const event =
    lines
      .find(line => line.startsWith('event:'))
      ?.slice(6)
      .trim() ?? 'message'
  const data = lines
    .find(line => line.startsWith('data:'))
    ?.slice(5)
    .trim()
  if (!data) return
  const payload = JSON.parse(data) as { content?: string; message?: unknown; code?: string }
  if (event === 'chunk') {
    callbacks.onChunk(String(payload.content ?? ''))
    return
  }
  if (event === 'done' && payload.message && typeof payload.message === 'object') {
    callbacks.onDone?.(payload.message as AICopilotMessage)
    return
  }
  if (event === 'error') {
    throw new Error(String(payload.message ?? payload.code ?? 'Chat request failed'))
  }
}
