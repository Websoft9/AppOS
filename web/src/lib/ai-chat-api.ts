import { pb } from '@/lib/pb'

export type AIChatSession = {
  id: string
  title: string
  created_at?: string
  updated_at?: string
  last_message_at?: string
}

export type AIChatMessage = {
  id: string
  session_id: string
  role: 'system' | 'user' | 'assistant'
  content: string
  status?: string
  created_at?: string
}

export type AIChatAttachment = {
  name: string
  mime_type?: string
  size?: number
  text_content?: string
  record_id?: string
}

export async function listAIChatSessions(): Promise<AIChatSession[]> {
  const response = (await pb.send('/api/ai/chat/sessions', { method: 'GET' })) as {
    items?: AIChatSession[]
  }
  return Array.isArray(response.items) ? response.items : []
}

export async function createAIChatSession(title?: string): Promise<AIChatSession> {
  return (await pb.send('/api/ai/chat/sessions', {
    method: 'POST',
    body: { title: title ?? '' },
  })) as AIChatSession
}

export async function updateAIChatSession(
  sessionId: string,
  title: string
): Promise<AIChatSession> {
  return (await pb.send(`/api/ai/chat/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    body: { title },
  })) as AIChatSession
}

export async function deleteAIChatSession(sessionId: string): Promise<void> {
  await pb.send(`/api/ai/chat/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  })
}

export async function listAIChatMessages(sessionId: string): Promise<AIChatMessage[]> {
  const response = (await pb.send(
    `/api/ai/chat/sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      method: 'GET',
    }
  )) as { items?: AIChatMessage[] }
  return Array.isArray(response.items) ? response.items : []
}

type StreamCallbacks = {
  onChunk: (content: string) => void
  onDone?: (message: AIChatMessage) => void
}

export async function sendAIChatMessage(
  sessionId: string,
  content: string,
  callbacks: StreamCallbacks,
  attachments: AIChatAttachment[] = []
): Promise<void> {
  const response = await fetch(`/api/ai/chat/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: pb.authStore.token,
    },
    body: JSON.stringify({ content, attachments }),
  })
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
    callbacks.onDone?.(payload.message as AIChatMessage)
    return
  }
  if (event === 'error') {
    throw new Error(String(payload.message ?? payload.code ?? 'Chat request failed'))
  }
}
