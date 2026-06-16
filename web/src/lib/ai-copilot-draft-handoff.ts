const AI_COPILOT_DRAFT_HANDOFF_KEY = 'ai-copilot.draft-handoff.v1'

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