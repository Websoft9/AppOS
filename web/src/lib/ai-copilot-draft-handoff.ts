const AI_COPILOT_DRAFT_HANDOFF_KEY = 'ai-copilot.draft-handoff.v1'
const AI_COPILOT_SESSION_HANDOFF_KEY = 'ai-copilot.session-handoff.v1'

type AICopilotSessionHandoff = {
  systemPromptAssetId: string
}

export function saveAICopilotDraftHandoff(content: string): void {
  if (typeof window === 'undefined') return
  const trimmed = content.trim()
  if (!trimmed) return
  window.localStorage.setItem(AI_COPILOT_DRAFT_HANDOFF_KEY, trimmed)
}

export function consumeAICopilotDraftHandoff(): string {
  if (typeof window === 'undefined') return ''
  const value = window.localStorage.getItem(AI_COPILOT_DRAFT_HANDOFF_KEY) ?? ''
  window.localStorage.removeItem(AI_COPILOT_DRAFT_HANDOFF_KEY)
  return value.trim()
}

export function saveAICopilotSessionHandoff(input: AICopilotSessionHandoff): void {
  if (typeof window === 'undefined') return
  const systemPromptAssetId = input.systemPromptAssetId.trim()
  if (!systemPromptAssetId) return
  window.localStorage.setItem(
    AI_COPILOT_SESSION_HANDOFF_KEY,
    JSON.stringify({ systemPromptAssetId })
  )
}

export function consumeAICopilotSessionHandoff(): AICopilotSessionHandoff | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(AI_COPILOT_SESSION_HANDOFF_KEY)
  window.localStorage.removeItem(AI_COPILOT_SESSION_HANDOFF_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<AICopilotSessionHandoff>
    const systemPromptAssetId = String(parsed.systemPromptAssetId ?? '').trim()
    if (!systemPromptAssetId) return null
    return { systemPromptAssetId }
  } catch {
    return null
  }
}
