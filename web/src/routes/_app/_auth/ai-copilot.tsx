import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  Bot,
  Check,
  ChevronDown,
  Copy,
  File,
  Paperclip,
  Loader2,
  MoreVertical,
  PanelLeft,
  PanelLeftClose,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Square,
  Trash2,
  User,
  X,
} from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { MarkdownView } from '@/components/ui/markdown'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  createAICopilotSession,
  deleteAICopilotSession,
  listAICopilotModels,
  listAICopilotMessages,
  listAICopilotSessions,
  sendAICopilotMessage,
  updateAICopilotSession,
  type AICopilotAttachment,
  type AICopilotModelOption,
  type AICopilotMessage,
  type AICopilotSession,
} from '@/lib/ai-copilot-api'
import { getAssetContent, listAssets, type AssetRecord } from '@/lib/assets-api'
import {
  consumeAICopilotDraftHandoff,
  consumeAICopilotSessionHandoff,
} from '@/lib/ai-copilot-draft-handoff'
import { getApiErrorMessage } from '@/lib/api-error'
import { copyToClipboard } from '@/lib/clipboard'
import {
  extractDocxText,
  extractPdfText,
  extractSpreadsheetText,
  isDocxFile,
  isPdfFile,
  isSpreadsheetFile,
} from '@/lib/document-extraction'
import { getLocale } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const USER_MESSAGE_ENVELOPE_START = '[[APPOS_CHAT_V1]]'
const USER_MESSAGE_ENVELOPE_END = '[[/APPOS_CHAT_V1]]'
const TEXT_ATTACHMENT_BYTES_LIMIT = 120_000
const BINARY_DOCUMENT_BYTES_LIMIT = 10 * 1024 * 1024
const DEFAULT_INPUT_TOKEN_BUDGET = 24_000
const MAX_INPUT_TOKEN_BUDGET = 48_000
const MIN_INPUT_TOKEN_BUDGET = 2_048
const DEFAULT_COMPLETION_TOKEN_RESERVE = 4_096
const CHAT_TOKEN_SAFETY_MARGIN = 1_024

type DraftAttachment = {
  id: string
  name: string
  size: number
  mimeType: string
  textContent?: string
  loading: boolean
  error?: string
}

type ParsedUserMessage = {
  text: string
  attachments: AICopilotAttachment[]
}

type AttachmentStatus = {
  tone: 'info' | 'warning' | 'error'
  message: string
}

function modelSelectionValue(option: Pick<AICopilotModelOption, 'provider_id' | 'model_id'>) {
  return `${option.provider_id}::${option.model_id}`
}

function parseModelSelection(value: string) {
  const [providerId = '', ...rest] = value.split('::')
  return { providerId, model: rest.join('::') }
}

function isTextAttachment(file: File) {
  if (file.type.startsWith('text/')) return true
  const lower = file.name.toLowerCase()
  return /\.(md|txt|log|json|ya?ml|toml|ini|conf|env|csv|ts|tsx|js|jsx|css|scss|html|xml|py|go|rs|java|sh)$/.test(
    lower
  )
}

function formatAttachmentSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function estimateTextTokens(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return 0
  let score = 0
  for (const char of trimmed) {
    if (/\s/.test(char)) {
      score += 0.15
      continue
    }
    if (char.charCodeAt(0) <= 0x7f) {
      score += 0.28
      continue
    }
    score += 0.9
  }
  return Math.max(1, Math.ceil(score))
}

function estimateAttachmentTokens(attachment: Pick<DraftAttachment, 'name' | 'textContent'>) {
  return estimateTextTokens(attachment.name) + estimateTextTokens(attachment.textContent ?? '')
}

function estimatePersistedAttachmentTokens(attachment: AICopilotAttachment) {
  return estimateTextTokens(attachment.name) + estimateTextTokens(attachment.text_content ?? '')
}

function estimateMessageTokens(message: AICopilotMessage) {
  if (message.role === 'user') {
    const parsed = parseUserMessageContent(message)
    return (
      estimateTextTokens(parsed.text) +
      parsed.attachments.reduce(
        (total, attachment) => total + estimatePersistedAttachmentTokens(attachment),
        0
      )
    )
  }
  return estimateTextTokens(message.content)
}

function clampTokenBudget(value: number) {
  return Math.min(MAX_INPUT_TOKEN_BUDGET, Math.max(MIN_INPUT_TOKEN_BUDGET, value))
}

function inputTokenBudgetForModel(model: AICopilotModelOption | undefined) {
  const contextSize = Number(model?.context_size ?? 0)
  if (!Number.isFinite(contextSize) || contextSize <= 0) {
    return DEFAULT_INPUT_TOKEN_BUDGET
  }
  const completionReserve =
    Number(model?.max_completion_tokens ?? 0) > 0
      ? Number(model?.max_completion_tokens)
      : DEFAULT_COMPLETION_TOKEN_RESERVE
  return clampTokenBudget(contextSize - completionReserve - CHAT_TOKEN_SAFETY_MARGIN)
}

function formatRelativeTime(locale: 'en' | 'zh', value: string | undefined, justNowLabel: string) {
  if (!value) return justNowLabel
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return justNowLabel
  const diffMs = date.getTime() - Date.now()
  const diffMinutes = Math.round(diffMs / 60000)
  const formatter = new Intl.RelativeTimeFormat(locale === 'zh' ? 'zh-CN' : 'en', {
    numeric: 'auto',
  })

  if (Math.abs(diffMinutes) < 60) {
    return formatter.format(diffMinutes === 0 ? -1 : diffMinutes, 'minute')
  }
  const diffHours = Math.round(diffMinutes / 60)
  if (Math.abs(diffHours) < 24) {
    return formatter.format(diffHours, 'hour')
  }
  const diffDays = Math.round(diffHours / 24)
  if (Math.abs(diffDays) < 7) {
    return formatter.format(diffDays, 'day')
  }
  const diffWeeks = Math.round(diffDays / 7)
  if (Math.abs(diffWeeks) < 4) {
    return formatter.format(diffWeeks, 'week')
  }
  const diffMonths = Math.round(diffDays / 30)
  return formatter.format(diffMonths, 'month')
}

function TokenUsageRing({ percent }: { percent: number }) {
  const clamped = Math.min(100, Math.max(0, percent))
  const radius = 8
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - clamped / 100)
  const colorClass =
    clamped >= 100 ? 'text-destructive' : clamped >= 80 ? 'text-amber-500' : 'text-primary'

  return (
    <span className={cn('inline-flex h-5 w-5 items-center justify-center', colorClass)}>
      <svg viewBox="0 0 20 20" className="h-5 w-5 -rotate-90" aria-hidden="true">
        <circle
          cx="10"
          cy="10"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.16"
          strokeWidth="2.4"
        />
        <circle
          cx="10"
          cy="10"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
    </span>
  )
}

async function buildDraftAttachment(
  file: File,
  labels: {
    textPreviewSkipped: (limit: string) => string
    textPreviewUnavailable: string
    binaryDocumentTooLarge: (limit: string) => string
    unsupportedAttachmentType: string
  }
): Promise<DraftAttachment> {
  const draft: DraftAttachment = {
    id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name,
    size: file.size,
    mimeType: file.type || 'application/octet-stream',
    loading: false,
  }

  if (isPdfFile(file)) {
    if (file.size > BINARY_DOCUMENT_BYTES_LIMIT) {
      return {
        ...draft,
        error: labels.binaryDocumentTooLarge(formatAttachmentSize(BINARY_DOCUMENT_BYTES_LIMIT)),
      }
    }
    try {
      return { ...draft, textContent: await extractPdfText(file) }
    } catch {
      return { ...draft, error: labels.textPreviewUnavailable }
    }
  }

  if (isDocxFile(file)) {
    if (file.size > BINARY_DOCUMENT_BYTES_LIMIT) {
      return {
        ...draft,
        error: labels.binaryDocumentTooLarge(formatAttachmentSize(BINARY_DOCUMENT_BYTES_LIMIT)),
      }
    }
    try {
      return { ...draft, textContent: await extractDocxText(file) }
    } catch {
      return { ...draft, error: labels.textPreviewUnavailable }
    }
  }

  if (isSpreadsheetFile(file)) {
    if (file.size > BINARY_DOCUMENT_BYTES_LIMIT) {
      return {
        ...draft,
        error: labels.binaryDocumentTooLarge(formatAttachmentSize(BINARY_DOCUMENT_BYTES_LIMIT)),
      }
    }
    try {
      return { ...draft, textContent: await extractSpreadsheetText(file) }
    } catch {
      return { ...draft, error: labels.textPreviewUnavailable }
    }
  }

  if (!isTextAttachment(file)) {
    return {
      ...draft,
      error: labels.unsupportedAttachmentType,
    }
  }
  if (file.size > TEXT_ATTACHMENT_BYTES_LIMIT) {
    return {
      ...draft,
      error: labels.textPreviewSkipped(formatAttachmentSize(TEXT_ATTACHMENT_BYTES_LIMIT)),
    }
  }

  try {
    return {
      ...draft,
      textContent: (await file.text()).trim(),
    }
  } catch {
    return {
      ...draft,
      error: labels.textPreviewUnavailable,
    }
  }
}

function parseUserMessageContent(message: AICopilotMessage): ParsedUserMessage {
  if (message.role !== 'user') {
    return { text: message.content, attachments: [] }
  }
  const trimmed = message.content.trim()
  if (
    !trimmed.startsWith(USER_MESSAGE_ENVELOPE_START) ||
    !trimmed.endsWith(USER_MESSAGE_ENVELOPE_END)
  ) {
    return { text: message.content, attachments: [] }
  }

  try {
    const payload = JSON.parse(
      trimmed.slice(
        USER_MESSAGE_ENVELOPE_START.length,
        trimmed.length - USER_MESSAGE_ENVELOPE_END.length
      )
    ) as { text?: string; attachments?: AICopilotAttachment[] }
    return {
      text: payload.text?.trim() ?? '',
      attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
    }
  } catch {
    return { text: message.content, attachments: [] }
  }
}

export function AICopilotPage() {
  const navigate = useNavigate()
  const { t } = useTranslation('aiCopilot')
  const [sessions, setSessions] = useState<AICopilotSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState('')
  const [messages, setMessages] = useState<AICopilotMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [selectedModel, setSelectedModel] = useState(
    () => localStorage.getItem('ai-copilot-model') ?? ''
  )
  const [availableModels, setAvailableModels] = useState<AICopilotModelOption[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelSearchQuery, setModelSearchQuery] = useState('')
  const [modelPopoverOpen, setModelPopoverOpen] = useState(false)
  const [promptAssets, setPromptAssets] = useState<AssetRecord[]>([])
  const [loadingPromptAssets, setLoadingPromptAssets] = useState(false)
  const [taskPromptPopoverOpen, setTaskPromptPopoverOpen] = useState(false)
  const [headerSystemPromptMenuOpen, setHeaderSystemPromptMenuOpen] = useState(false)
  const [emptySystemPromptPopoverOpen, setEmptySystemPromptPopoverOpen] = useState(false)
  const [selectedSystemPromptAssetId, setSelectedSystemPromptAssetId] = useState('')
  const [loadingTaskContent, setLoadingTaskContent] = useState(false)

  useEffect(() => {
    localStorage.setItem('ai-copilot-model', selectedModel)
  }, [selectedModel])

  const refreshModels = useCallback(async () => {
    setLoadingModels(true)
    try {
      const models = await listAICopilotModels()
      setAvailableModels(models)
      if (models.length > 0) {
        const stored = localStorage.getItem('ai-copilot-model')
        const fallback = modelSelectionValue(models[0])
        if (stored && models.some(m => modelSelectionValue(m) === stored)) {
          setSelectedModel(stored)
        } else {
          setSelectedModel(fallback)
        }
      } else {
        setSelectedModel('')
      }
    } catch {
      setAvailableModels([])
      setSelectedModel('')
    } finally {
      setLoadingModels(false)
    }
  }, [])

  const refreshPromptAssets = useCallback(async () => {
    setLoadingPromptAssets(true)
    try {
      const assets = await listAssets()
      setPromptAssets(assets.filter(item => item.kind === 'prompt'))
    } catch {
      setPromptAssets([])
    } finally {
      setLoadingPromptAssets(false)
    }
  }, [])

  useEffect(() => {
    void refreshModels()
  }, [refreshModels])

  useEffect(() => {
    void refreshPromptAssets()
  }, [refreshPromptAssets])

  useEffect(() => {
    const handoffDraft = consumeAICopilotDraftHandoff()
    if (!handoffDraft) return
    setDraft(current => (current.trim() ? `${current}\n\n${handoffDraft}` : handoffDraft))
  }, [])

  const [busySessionId, setBusySessionId] = useState('')
  const [renamingSessionId, setRenamingSessionId] = useState('')
  const [renameDraft, setRenameDraft] = useState('')
  const [attachments, setAttachments] = useState<DraftAttachment[]>([])
  const [attachmentStatus, setAttachmentStatus] = useState<AttachmentStatus | null>(null)
  const [conversationListWide, setConversationListWide] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<AICopilotSession | null>(null)
  const [batchDeleteMode, setBatchDeleteMode] = useState(false)
  const [batchDeleteSet, setBatchDeleteSet] = useState<Set<string>>(new Set())
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const activeRequestRef = useRef<AbortController | null>(null)

  const activeSession = useMemo(
    () => sessions.find(session => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions]
  )
  const systemPrompts = useMemo(
    () => promptAssets.filter(item => item.prompt_scope !== 'task'),
    [promptAssets]
  )
  const taskInstructions = useMemo(
    () => promptAssets.filter(item => item.prompt_scope === 'task'),
    [promptAssets]
  )
  const selectedPromptAsset = useMemo(
    () => systemPrompts.find(item => item.id === selectedSystemPromptAssetId) ?? null,
    [systemPrompts, selectedSystemPromptAssetId]
  )
  const locale = getLocale()
  const defaultSessionTitle = t('page.defaultSessionTitle')

  const attachmentsLoading = attachments.some(item => item.loading)

  useEffect(() => {
    if (!sending && attachments.length === 0) {
      setAttachmentStatus(null)
    }
  }, [attachments.length, sending])

  useEffect(() => {
    if (activeSession) {
      setSelectedSystemPromptAssetId(activeSession.system_prompt_asset_id ?? '')
    }
  }, [activeSession])

  const stopStreaming = useCallback(() => {
    activeRequestRef.current?.abort()
  }, [])

  const refreshSessions = useCallback(async () => {
    const items = await listAICopilotSessions()
    setSessions(items)
    return items
  }, [])

  const loadMessages = useCallback(async (sessionId: string) => {
    if (!sessionId) {
      setMessages([])
      return
    }
    setMessages(await listAICopilotMessages(sessionId))
  }, [])

  const createSession = useCallback(async () => {
    setError('')
    const session = await createAICopilotSession({
      systemPromptAssetId: selectedSystemPromptAssetId,
    })
    setSessions(prev => [session, ...prev])
    setActiveSessionId(session.id)
    setMessages([])
  }, [selectedSystemPromptAssetId])

  const filteredModels = useMemo(() => {
    const query = modelSearchQuery.trim().toLowerCase()
    if (!query) return availableModels
    return availableModels.filter(
      m =>
        m.label.toLowerCase().includes(query) ||
        m.model_id.toLowerCase().includes(query) ||
        (m.provider_name ?? '').toLowerCase().includes(query)
    )
  }, [availableModels, modelSearchQuery])

  const selectedModelMeta = useMemo(
    () => availableModels.find(model => modelSelectionValue(model) === selectedModel),
    [availableModels, selectedModel]
  )

  const draftTokenEstimate = useMemo(
    () =>
      estimateTextTokens(draft) +
      attachments.reduce((total, item) => total + estimateAttachmentTokens(item), 0),
    [draft, attachments]
  )

  const conversationTokenEstimate = useMemo(
    () => messages.reduce((total, message) => total + estimateMessageTokens(message), 0),
    [messages]
  )

  const currentInputBudget = useMemo(
    () => inputTokenBudgetForModel(selectedModelMeta),
    [selectedModelMeta]
  )

  const currentCompletionCap = Number(selectedModelMeta?.max_completion_tokens ?? 0)
  const currentContextSize = Number(selectedModelMeta?.context_size ?? 0)
  const estimatedNextRequestTokens = conversationTokenEstimate + draftTokenEstimate
  const estimatedRemainingInput = Math.max(0, currentInputBudget - estimatedNextRequestTokens)
  const tokenUsagePercent =
    currentInputBudget > 0
      ? Math.min(
          999,
          Math.max(0, Math.round((estimatedNextRequestTokens / currentInputBudget) * 100))
        )
      : 0

  useEffect(() => {
    let cancelled = false
    const sessionHandoff = consumeAICopilotSessionHandoff()
    setLoading(true)
    refreshSessions()
      .then(async items => {
        if (cancelled) return
        if (sessionHandoff?.systemPromptAssetId) {
          setSelectedSystemPromptAssetId(sessionHandoff.systemPromptAssetId)
          const created = await createAICopilotSession({
            systemPromptAssetId: sessionHandoff.systemPromptAssetId,
          })
          if (cancelled) return
          setSessions([created, ...items])
          setActiveSessionId(created.id)
          setMessages([])
          return
        }
        if (items.length === 0) {
          setSessions([])
          setActiveSessionId('')
          setMessages([])
          return
        }
        setActiveSessionId(items[0].id)
        await loadMessages(items[0].id)
      })
      .catch(err => {
        if (!cancelled) setError(getApiErrorMessage(err, t('messages.loadError')))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [loadMessages, refreshSessions])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  const selectSession = async (sessionId: string) => {
    setError('')
    setActiveSessionId(sessionId)
    await loadMessages(sessionId)
  }

  const startRename = (session: AICopilotSession) => {
    setRenamingSessionId(session.id)
    setRenameDraft(session.title || defaultSessionTitle)
  }

  const saveRename = async (sessionId: string) => {
    const nextTitle = renameDraft.trim()
    if (!nextTitle) return
    setBusySessionId(sessionId)
    setError('')
    try {
      const session = await updateAICopilotSession(sessionId, { title: nextTitle })
      setSessions(prev => prev.map(item => (item.id === sessionId ? session : item)))
      setRenamingSessionId('')
      setRenameDraft('')
    } catch (err) {
      setError(getApiErrorMessage(err, t('messages.renameError')))
    } finally {
      setBusySessionId('')
    }
  }

  const removeSession = async (session: AICopilotSession) => {
    setBusySessionId(session.id)
    setError('')
    try {
      await deleteAICopilotSession(session.id)
      const remaining = sessions.filter(item => item.id !== session.id)
      setSessions(remaining)
      setRenamingSessionId(prev => (prev === session.id ? '' : prev))
      if (activeSessionId === session.id) {
        if (remaining.length > 0) {
          await selectSession(remaining[0].id)
        } else {
          setActiveSessionId('')
          setMessages([])
        }
      }
    } catch (err) {
      setError(getApiErrorMessage(err, t('messages.deleteError')))
    } finally {
      setBusySessionId('')
      setDeleteTarget(null)
    }
  }

  const applySystemPromptSelection = async (assetId: string) => {
    const previous = selectedSystemPromptAssetId
    setSelectedSystemPromptAssetId(assetId)
    setHeaderSystemPromptMenuOpen(false)
    setEmptySystemPromptPopoverOpen(false)
    if (!activeSessionId) {
      return
    }
    setBusySessionId(activeSessionId)
    setError('')
    try {
      const updated = await updateAICopilotSession(activeSessionId, {
        systemPromptAssetId: assetId,
      })
      setSessions(prev => prev.map(item => (item.id === activeSessionId ? updated : item)))
    } catch (err) {
      setSelectedSystemPromptAssetId(previous)
      setError(getApiErrorMessage(err, t('messages.renameError')))
    } finally {
      setBusySessionId('')
    }
  }

  const applyTaskInstruction = async (assetId: string) => {
    setTaskPromptPopoverOpen(false)
    if (!assetId) return
    setLoadingTaskContent(true)
    try {
      const content = await getAssetContent(assetId)
      const text =
        'files' in content
          ? (content.files ?? []).map((f: { content: string }) => f.content).join('\n\n')
          : content.content
      setDraft(prev => {
        const trimmedPrev = prev.trim()
        const trimmedText = text.trim()
        return trimmedPrev ? `${trimmedPrev}\n\n${trimmedText}` : trimmedText
      })
    } catch {
      // silently ignore content fetch failures
    } finally {
      setLoadingTaskContent(false)
    }
  }

  const renderSystemPromptChooser = () => (
    <>
      <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {t('prompts.systemPromptGroup')}
      </div>
      <button
        type="button"
        className={cn(
          'flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground',
          !selectedSystemPromptAssetId && 'bg-accent/50 font-medium'
        )}
        onClick={() => void applySystemPromptSelection('')}
      >
        <span>{t('prompts.systemPromptNone')}</span>
        {!selectedSystemPromptAssetId ? <Check className="h-3.5 w-3.5" /> : null}
      </button>
      <div className="max-h-56 overflow-y-auto">
        {systemPrompts.map(asset => (
          <button
            key={asset.id}
            type="button"
            className={cn(
              'flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground',
              asset.id === selectedSystemPromptAssetId && 'bg-accent/50 font-medium'
            )}
            onClick={() => void applySystemPromptSelection(asset.id)}
          >
            <span className="truncate">{asset.name}</span>
            {asset.id === selectedSystemPromptAssetId ? (
              <Check className="h-3.5 w-3.5 shrink-0" />
            ) : null}
          </button>
        ))}
      </div>
    </>
  )

  const addFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    const files = Array.from(fileList)
    setAttachmentStatus({
      tone: 'info',
      message: t('messages.readingAttachments', { count: files.length }),
    })
    const placeholders = files.map(file => ({
      id: `${file.name}-${file.size}-${file.lastModified}`,
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      loading: true,
    }))
    setAttachments(prev => [...prev, ...placeholders])
    const built = await Promise.all(
      files.map(file =>
        buildDraftAttachment(file, {
          textPreviewSkipped: limit => t('messages.textPreviewSkipped', { limit }),
          textPreviewUnavailable: t('messages.textPreviewUnavailable'),
          binaryDocumentTooLarge: limit => t('messages.binaryDocumentTooLarge', { limit }),
          unsupportedAttachmentType: t('messages.unsupportedAttachmentType'),
        })
      )
    )
    setAttachments(prev => {
      const existing = prev.filter(
        item => !placeholders.some(placeholder => placeholder.id === item.id)
      )
      return [...existing, ...built]
    })
    const failedCount = built.filter(item => Boolean(item.error)).length
    const readableCount = built.length - failedCount
    if (failedCount === 0) {
      setAttachmentStatus({
        tone: 'info',
        message: t('messages.attachmentsReady', { count: readableCount }),
      })
    } else if (readableCount === 0) {
      setAttachmentStatus({
        tone: 'error',
        message: t('messages.attachmentsUnreadable', { count: failedCount }),
      })
    } else {
      setAttachmentStatus({
        tone: 'warning',
        message: t('messages.attachmentsPartialReady', {
          count: readableCount,
          failed: failedCount,
        }),
      })
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const removeAttachment = (attachmentId: string) => {
    setAttachments(prev => prev.filter(item => item.id !== attachmentId))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const content = draft.trim()
    const readableAttachments = attachments.filter(item => !item.loading && !item.error)
    const unreadableAttachments = attachments.filter(item => Boolean(item.error))
    const outgoingAttachments: AICopilotAttachment[] = readableAttachments.map(item => ({
      name: item.name,
      mime_type: item.mimeType,
      size: item.size,
      text_content: item.textContent,
    }))
    if (sending || attachmentsLoading || (!content && attachments.length === 0)) return
    if (content === '' && outgoingAttachments.length === 0 && unreadableAttachments.length > 0) {
      setAttachmentStatus({
        tone: 'error',
        message: t('messages.attachmentsNeedReadableContent'),
      })
      return
    }
    const previousDraft = draft
    const previousAttachments = attachments
    setDraft('')
    setSending(true)
    setError('')
    setAttachmentStatus(
      outgoingAttachments.length > 0 || unreadableAttachments.length > 0
        ? {
            tone: unreadableAttachments.length > 0 ? 'warning' : 'info',
            message: t('messages.submittingAttachments', { count: outgoingAttachments.length }),
          }
        : null
    )

    let sessionId = activeSessionId
    if (!sessionId) {
      const created = await createAICopilotSession({
        systemPromptAssetId: selectedSystemPromptAssetId,
      })
      sessionId = created.id
      setSessions(prev => [created, ...prev])
      setActiveSessionId(created.id)
      setMessages([])
    }

    const userMessage: AICopilotMessage = {
      id: `local-user-${Date.now()}`,
      session_id: sessionId,
      role: 'user',
      content:
        outgoingAttachments.length > 0
          ? `${USER_MESSAGE_ENVELOPE_START}${JSON.stringify({ text: content, attachments: outgoingAttachments })}${USER_MESSAGE_ENVELOPE_END}`
          : content,
    }
    const assistantId = `local-assistant-${Date.now()}`
    const assistantMessage: AICopilotMessage = {
      id: assistantId,
      session_id: sessionId,
      role: 'assistant',
      content: '',
      status: 'streaming',
    }
    setMessages(prev => [...prev, userMessage, assistantMessage])
    const controller = new AbortController()
    activeRequestRef.current = controller

    try {
      const targetModel = parseModelSelection(selectedModel)
      await sendAICopilotMessage(
        sessionId,
        content,
        targetModel.providerId,
        targetModel.model,
        {
          onChunk: chunk => {
            setMessages(prev =>
              prev.map(message =>
                message.id === assistantId
                  ? { ...message, content: message.content + chunk, status: 'streaming' }
                  : message
              )
            )
          },
          onDone: message => {
            setMessages(prev =>
              prev.map(item =>
                item.id === assistantId
                  ? { ...message, status: message.status ?? 'completed' }
                  : item
              )
            )
          },
        },
        outgoingAttachments,
        { signal: controller.signal }
      )
      await refreshSessions()
      setAttachments([])
      setAttachmentStatus(null)
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError'
      setDraft(previousDraft)
      setAttachments(previousAttachments)
      if (aborted) {
        setMessages(prev =>
          prev.map(item => (item.id === assistantId ? { ...item, status: 'stopped' } : item))
        )
        await refreshSessions()
      } else {
        setError(getApiErrorMessage(err, t('messages.sendError')))
        await loadMessages(sessionId)
      }
      if (previousAttachments.length > 0) {
        const failedCount = previousAttachments.filter(item => Boolean(item.error)).length
        const readableCount = previousAttachments.length - failedCount
        setAttachmentStatus(
          failedCount === 0
            ? {
                tone: 'info',
                message: t('messages.attachmentsReady', { count: readableCount }),
              }
            : readableCount === 0
              ? {
                  tone: 'error',
                  message: t('messages.attachmentsUnreadable', { count: failedCount }),
                }
              : {
                  tone: 'warning',
                  message: t('messages.attachmentsPartialReady', {
                    count: readableCount,
                    failed: failedCount,
                  }),
                }
        )
      }
    } finally {
      activeRequestRef.current = null
      setSending(false)
    }
  }

  return (
    <div className="-m-6 flex h-[calc(100%+3rem)] min-h-0 flex-col overflow-hidden px-6 py-6">
      <div className="shrink-0 pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('page.title')}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{t('page.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="outline"
              aria-label={t('actions.refresh')}
              onClick={() => void refreshSessions()}
            >
              <RefreshCw className={cn('h-4 w-4', loading ? 'animate-spin' : undefined)} />
            </Button>
            <Button size="sm" onClick={() => void createSession()}>
              <Plus className="mr-2 h-4 w-4" />
              {t('actions.newChat')}
            </Button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <main className="flex-1 min-h-0 overflow-hidden pt-4">
        <div
          className={cn(
            'grid h-full gap-4',
            conversationListWide
              ? 'grid-cols-1 xl:grid-cols-[19rem_minmax(0,1fr)]'
              : 'grid-cols-[0_minmax(0,1fr)]'
          )}
        >
          <aside
            className={cn(
              'flex min-h-0 flex-col overflow-hidden rounded-xl border bg-background transition-all duration-200',
              conversationListWide ? 'p-3 opacity-100' : 'w-0 border-transparent p-0 opacity-0'
            )}
            aria-hidden={!conversationListWide}
          >
            <div className="flex items-center justify-between gap-2 border-b pb-2.5">
              <span className="text-sm font-semibold tracking-tight">
                {t('page.conversationList')} ({sessions.length})
              </span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                aria-label={t('actions.createConversation')}
                onClick={() => void createSession()}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto space-y-1 py-2 pr-1">
              {sessions.map(session => {
                const isActive = session.id === activeSessionId
                const isRenaming = session.id === renamingSessionId
                const isBusy = session.id === busySessionId
                return (
                  <div
                    key={session.id}
                    className={cn(
                      'rounded-lg border border-transparent px-2 py-1.5 transition-colors',
                      isActive
                        ? 'border-primary/[0.07] bg-primary/[0.035] shadow-sm shadow-primary/[0.03]'
                        : 'hover:bg-muted/20'
                    )}
                  >
                    {isRenaming ? (
                      <div className="space-y-2">
                        <Input
                          value={renameDraft}
                          onChange={event => setRenameDraft(event.target.value)}
                          aria-label={t('fields.conversationTitle')}
                          disabled={isBusy}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => void saveRename(session.id)}
                            disabled={isBusy || !renameDraft.trim()}
                          >
                            {t('actions.save')}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setRenamingSessionId('')
                              setRenameDraft('')
                            }}
                            disabled={isBusy}
                          >
                            {t('actions.cancel')}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-1.5">
                        {batchDeleteMode ? (
                          <input
                            type="checkbox"
                            className="mt-1.5 h-4 w-4 shrink-0"
                            checked={batchDeleteSet.has(session.id)}
                            onChange={() => {
                              setBatchDeleteSet(prev => {
                                const next = new Set(prev)
                                if (next.has(session.id)) {
                                  next.delete(session.id)
                                } else {
                                  next.add(session.id)
                                }
                                return next
                              })
                            }}
                          />
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void selectSession(session.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="flex items-start gap-2">
                            <span
                              className={cn(
                                'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full transition-colors',
                                isActive ? 'bg-primary' : 'bg-muted-foreground/40'
                              )}
                            />
                            <div className="min-w-0">
                              <div className="line-clamp-2 text-[13px] font-medium leading-5">
                                {session.title || defaultSessionTitle}
                              </div>
                              <div className="mt-0.5 text-[11px] text-muted-foreground">
                                {formatRelativeTime(
                                  locale,
                                  session.last_message_at || session.updated_at,
                                  t('messages.justNow')
                                )}
                              </div>
                            </div>
                          </div>
                        </button>
                        {batchDeleteMode ? null : (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 shrink-0"
                                aria-label={t('aria.conversationActions', {
                                  title: session.title || defaultSessionTitle,
                                })}
                                disabled={isBusy}
                              >
                                {isBusy ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <MoreVertical className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => startRename(session)}>
                                <Pencil className="mr-2 h-4 w-4" />
                                {t('actions.editName')}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setDeleteTarget(session)}>
                                <Trash2 className="mr-2 h-4 w-4" />
                                {t('actions.delete')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="border-t pt-2.5 space-y-2">
              {sessions.length > 0 ? (
                <div className="flex items-center justify-between gap-1">
                  {batchDeleteMode ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => {
                          setBatchDeleteSet(new Set(sessions.map(s => s.id)))
                        }}
                      >
                        {t('actions.selectAll')}
                      </Button>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => {
                            setBatchDeleteMode(false)
                            setBatchDeleteSet(new Set())
                          }}
                        >
                          {t('actions.cancel')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          className="h-7 text-xs"
                          disabled={batchDeleteSet.size === 0}
                          onClick={async () => {
                            setError('')
                            const ids = Array.from(batchDeleteSet)
                            let first = true
                            for (const id of ids) {
                              setBusySessionId(id)
                              try {
                                await deleteAICopilotSession(id)
                                setSessions(prev => prev.filter(s => s.id !== id))
                                if (activeSessionId === id) {
                                  const remaining = sessions.filter(
                                    s => s.id !== id && !ids.includes(s.id)
                                  )
                                  if (remaining.length > 0 && first) {
                                    setActiveSessionId(remaining[0].id)
                                    await loadMessages(remaining[0].id)
                                  } else if (remaining.length === 0) {
                                    setActiveSessionId('')
                                    setMessages([])
                                  }
                                }
                              } catch {
                                // continue
                              } finally {
                                setBusySessionId('')
                              }
                              first = false
                            }
                            setBatchDeleteMode(false)
                            setBatchDeleteSet(new Set())
                          }}
                        >
                          {t('actions.deleteSelected', { count: batchDeleteSet.size })}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        aria-label={t('actions.batchDelete')}
                        onClick={() => setBatchDeleteMode(true)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        aria-label={
                          conversationListWide
                            ? t('actions.shrinkConversationList')
                            : t('actions.expandConversationList')
                        }
                        onClick={() => setConversationListWide(prev => !prev)}
                      >
                        {conversationListWide ? (
                          <PanelLeftClose className="h-3.5 w-3.5" />
                        ) : (
                          <PanelLeft className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </>
                  )}
                </div>
              ) : (
                <div className="flex justify-end">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    aria-label={
                      conversationListWide
                        ? t('actions.shrinkConversationList')
                        : t('actions.expandConversationList')
                    }
                    onClick={() => setConversationListWide(prev => !prev)}
                  >
                    {conversationListWide ? (
                      <PanelLeftClose className="h-3.5 w-3.5" />
                    ) : (
                      <PanelLeft className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              )}
            </div>
          </aside>

          <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-background">
            <div className="px-5 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  {!conversationListWide ? (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={t('actions.expandConversationList')}
                      onClick={() => setConversationListWide(true)}
                    >
                      <PanelLeft className="h-4 w-4" />
                    </Button>
                  ) : null}
                  <h2 className="truncate text-lg font-semibold">
                    {activeSession?.title || t('page.title')}
                  </h2>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <DropdownMenu
                    open={headerSystemPromptMenuOpen}
                    onOpenChange={setHeaderSystemPromptMenuOpen}
                  >
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                        aria-label={t('prompts.selectSystemPrompt')}
                        disabled={sending || busySessionId === activeSessionId}
                        title={selectedPromptAsset?.name || t('prompts.systemPromptNone')}
                      >
                        <Settings className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-64 p-1" align="end">
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger className="text-xs">
                          <Settings className="h-3.5 w-3.5" />
                          <div className="min-w-0">
                            <div className="truncate">{t('prompts.selectSystemPrompt')}</div>
                            <div className="truncate text-[11px] text-muted-foreground">
                              {selectedPromptAsset?.name || t('prompts.systemPromptNone')}
                            </div>
                          </div>
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-64 p-1">
                          {renderSystemPromptChooser()}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-xs text-muted-foreground"
                        onClick={event => event.preventDefault()}
                      >
                        {selectedPromptAsset?.name || t('prompts.systemPromptNone')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                        aria-label={t('actions.tokenUsage')}
                        disabled={!selectedModelMeta}
                      >
                        <TokenUsageRing percent={tokenUsagePercent} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-3" align="end">
                      <div className="space-y-3 text-xs">
                        <div>
                          <div className="font-medium text-foreground">{t('tokens.title')}</div>
                          <div className="mt-1 text-muted-foreground">
                            {t('tokens.description')}
                          </div>
                        </div>
                        <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                          <div className="flex items-center gap-2">
                            <TokenUsageRing percent={tokenUsagePercent} />
                            <div className="text-muted-foreground">
                              {selectedModelMeta?.label ?? '-'}
                            </div>
                          </div>
                          <div className="text-sm font-medium text-foreground">
                            {Math.min(tokenUsagePercent, 999)}%
                          </div>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn(
                              'h-full rounded-full transition-[width]',
                              tokenUsagePercent >= 100
                                ? 'bg-destructive'
                                : tokenUsagePercent >= 80
                                  ? 'bg-amber-500'
                                  : 'bg-primary'
                            )}
                            style={{ width: `${Math.min(tokenUsagePercent, 100)}%` }}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                          <div className="text-muted-foreground">{t('tokens.currentModel')}</div>
                          <div className="text-right text-foreground">
                            {selectedModelMeta?.label ?? '-'}
                          </div>
                          <div className="text-muted-foreground">{t('tokens.contextWindow')}</div>
                          <div className="text-right text-foreground">
                            {currentContextSize > 0 ? currentContextSize.toLocaleString() : '-'}
                          </div>
                          <div className="text-muted-foreground">{t('tokens.maxOutput')}</div>
                          <div className="text-right text-foreground">
                            {currentCompletionCap > 0 ? currentCompletionCap.toLocaleString() : '-'}
                          </div>
                          <div className="text-muted-foreground">{t('tokens.inputBudget')}</div>
                          <div className="text-right text-foreground">
                            {currentInputBudget.toLocaleString()}
                          </div>
                          <div className="text-muted-foreground">
                            {t('tokens.visibleConversation')}
                          </div>
                          <div className="text-right text-foreground">
                            {conversationTokenEstimate.toLocaleString()}
                          </div>
                          <div className="text-muted-foreground">{t('tokens.currentDraft')}</div>
                          <div className="text-right text-foreground">
                            {draftTokenEstimate.toLocaleString()}
                          </div>
                          <div className="text-muted-foreground">
                            {t('tokens.nextRequestEstimate')}
                          </div>
                          <div className="text-right text-foreground">
                            {estimatedNextRequestTokens.toLocaleString()}
                          </div>
                          <div className="text-muted-foreground">{t('tokens.remainingInput')}</div>
                          <div className="text-right text-foreground">
                            {estimatedRemainingInput.toLocaleString()}
                          </div>
                        </div>
                        <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 text-muted-foreground">
                          {t('tokens.note')}
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              {loading ? (
                <div className="text-sm text-muted-foreground">{t('page.loading')}</div>
              ) : messages.length === 0 ? (
                <div className="mx-auto flex max-w-lg flex-col items-center justify-center py-14 text-center text-sm text-muted-foreground">
                  <Bot className="mb-3 h-7 w-7" />
                  <div className="font-medium text-foreground">{t('page.emptyTitle')}</div>
                  <div className="mt-1">{t('page.emptyDescription')}</div>
                  <div className="mt-4 flex flex-col items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {t('prompts.selectSystemPrompt')}
                    </span>
                    <div className="grid w-full max-w-md grid-cols-3 gap-1.5">
                      <button
                        type="button"
                        className={cn(
                          'rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-accent hover:text-accent-foreground',
                          !selectedSystemPromptAssetId &&
                            'bg-primary/10 border-primary/30 text-primary font-medium'
                        )}
                        onClick={() => void applySystemPromptSelection('')}
                      >
                        None
                      </button>
                      {systemPrompts.slice(0, 4).map(asset => (
                        <button
                          key={asset.id}
                          type="button"
                          className={cn(
                            'truncate rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-accent hover:text-accent-foreground',
                            asset.id === selectedSystemPromptAssetId &&
                              'bg-primary/10 border-primary/30 text-primary font-medium'
                          )}
                          onClick={() => void applySystemPromptSelection(asset.id)}
                        >
                          {asset.name}
                        </button>
                      ))}
                      {systemPrompts.length > 4 ? (
                        <Popover
                          open={emptySystemPromptPopoverOpen}
                          onOpenChange={setEmptySystemPromptPopoverOpen}
                        >
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                            >
                              +{systemPrompts.length - 4} more
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-64 p-1" align="center">
                            {renderSystemPromptChooser()}
                          </PopoverContent>
                        </Popover>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mx-auto flex max-w-4xl flex-col gap-6">
                  {messages.map(message => (
                    <MessageBubble key={message.id} message={message} />
                  ))}
                  <div className="h-16" ref={messagesEndRef} />
                </div>
              )}
            </div>

            <div className="shrink-0 bg-background/96 px-5 pb-4 pt-3 backdrop-blur-md">
              <form onSubmit={submit} className="mx-auto max-w-4xl">
                <div className="space-y-2 rounded-2xl border border-border/60 bg-background/94 p-2 shadow-[0_14px_30px_-22px_rgba(15,23,42,0.32)] transition-colors focus-within:border-primary/30">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    aria-label={t('fields.fileUpload')}
                    onChange={event => void addFiles(event.target.files)}
                  />

                  {attachments.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {attachments.map(attachment => (
                        <div
                          key={attachment.id}
                          className="rounded-full border border-border/40 bg-muted/15 px-2 py-1 text-[11px]"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground/85">
                              {attachment.name}
                            </span>
                            <span className="text-muted-foreground">
                              {formatAttachmentSize(attachment.size)}
                            </span>
                            {attachment.loading ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : null}
                            <button
                              type="button"
                              onClick={() => removeAttachment(attachment.id)}
                              aria-label={t('aria.removeAttachment', { name: attachment.name })}
                              className="text-muted-foreground transition-colors hover:text-foreground"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                          {attachment.error ? (
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              {attachment.error}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="rounded-xl bg-muted/15 px-3 pt-1.5">
                    {attachmentStatus ? (
                      <div
                        className={cn(
                          'mb-2 rounded-lg border px-3 py-2 text-xs',
                          attachmentStatus.tone === 'error' &&
                            'border-destructive/40 bg-destructive/5 text-destructive',
                          attachmentStatus.tone === 'warning' &&
                            'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300',
                          attachmentStatus.tone === 'info' &&
                            'border-border/60 bg-background/80 text-muted-foreground'
                        )}
                      >
                        {attachmentStatus.message}
                      </div>
                    ) : null}
                    <Textarea
                      value={draft}
                      onChange={event => setDraft(event.target.value)}
                      onKeyDown={event => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault()
                          event.currentTarget.form?.requestSubmit()
                        }
                      }}
                      placeholder={t('fields.messagePlaceholder')}
                      className="min-h-10 max-h-28 resize-none rounded-none border-0 bg-transparent px-0.5 py-0 leading-5 shadow-none focus-visible:border-0 focus-visible:ring-0"
                      disabled={sending}
                    />
                    <div className="flex items-center gap-1.5 px-0.5 pb-1 pt-0.5">
                      <TooltipProvider delayDuration={150}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="-ml-1 h-7 w-7 shrink-0 rounded-full text-muted-foreground hover:bg-background/70 hover:text-foreground"
                              onClick={() => fileInputRef.current?.click()}
                              disabled={sending}
                              aria-label={t('actions.uploadFiles')}
                            >
                              <Paperclip className="h-3 w-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{t('actions.uploadFilesHelp')}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <Popover open={taskPromptPopoverOpen} onOpenChange={setTaskPromptPopoverOpen}>
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            className={cn(
                              'h-7 shrink-0 rounded-md text-muted-foreground hover:bg-background/70 hover:text-foreground px-2',
                              taskInstructions.length > 0 && 'text-foreground'
                            )}
                            disabled={
                              sending ||
                              loadingPromptAssets ||
                              loadingTaskContent ||
                              busySessionId === activeSessionId
                            }
                            aria-label="Task instruction"
                            title={t('prompts.taskInstructionTitle')}
                          >
                            {loadingPromptAssets || loadingTaskContent ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <>
                                <span
                                  className="inline-flex items-center gap-1 text-xs"
                                  title={t('prompts.taskInstructionTitle')}
                                >
                                  <File className="h-3 w-3" />
                                  <span>{t('prompts.taskInstruction')}</span>
                                </span>
                              </>
                            )}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-72 p-1" align="start">
                          <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            {t('prompts.taskInstructionGroup')}
                          </div>
                          <button
                            type="button"
                            className={cn(
                              'flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                            )}
                            onClick={() => setTaskPromptPopoverOpen(false)}
                          >
                            <span>None</span>
                          </button>
                          <div className="max-h-56 overflow-y-auto">
                            {taskInstructions.length === 0 ? (
                              <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                                {t('prompts.noTaskInstructions')}
                              </div>
                            ) : (
                              taskInstructions.map(asset => (
                                <button
                                  key={asset.id}
                                  type="button"
                                  className={cn(
                                    'flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground'
                                  )}
                                  onClick={() => void applyTaskInstruction(asset.id)}
                                >
                                  <span className="truncate">{asset.name}</span>
                                </button>
                              ))
                            )}
                          </div>
                        </PopoverContent>
                      </Popover>
                      <Popover open={modelPopoverOpen} onOpenChange={setModelPopoverOpen}>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex h-7 items-center gap-1 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                            disabled={sending || loadingModels}
                          >
                            {loadingModels ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : selectedModel ? (
                              <span className="max-w-[120px] truncate">
                                {availableModels.find(m => modelSelectionValue(m) === selectedModel)
                                  ?.label ?? selectedModel}
                              </span>
                            ) : (
                              <span>{t('fields.noModelsAvailable')}</span>
                            )}
                            <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64 p-0" align="start">
                          <div className="flex items-center border-b px-3 py-2">
                            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                            <input
                              className="flex h-8 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
                              placeholder={t('fields.modelSearchPlaceholder')}
                              value={modelSearchQuery}
                              onChange={e => setModelSearchQuery(e.target.value)}
                              autoFocus
                            />
                          </div>
                          <div className="max-h-48 overflow-y-auto p-1">
                            {filteredModels.length > 0 ? (
                              filteredModels.map(model => (
                                <button
                                  key={modelSelectionValue(model)}
                                  type="button"
                                  className={cn(
                                    'flex w-full items-center rounded-sm px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground',
                                    modelSelectionValue(model) === selectedModel &&
                                      'bg-accent/50 font-medium'
                                  )}
                                  onClick={() => {
                                    setSelectedModel(modelSelectionValue(model))
                                    setModelPopoverOpen(false)
                                    setModelSearchQuery('')
                                  }}
                                >
                                  <span className="truncate">{model.label}</span>
                                </button>
                              ))
                            ) : (
                              <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                                {modelSearchQuery
                                  ? t('fields.noModelsMatchSearch')
                                  : t('fields.noModelsAvailable')}
                              </div>
                            )}
                          </div>
                          <div className="border-t p-1">
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                              onClick={async () => {
                                setModelPopoverOpen(false)
                                setModelSearchQuery('')
                                await navigate({
                                  to: '/resources/ai-providers',
                                  search: { create: undefined },
                                })
                              }}
                            >
                              <Settings className="h-3.5 w-3.5" />
                              {t('actions.configureModels')}
                            </button>
                          </div>
                        </PopoverContent>
                      </Popover>
                      <div className="flex-1" />
                      {sending ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="-mr-1 h-7 w-7 shrink-0 rounded-full text-muted-foreground hover:bg-background/70 hover:text-foreground"
                          aria-label={t('actions.stopGeneration')}
                          onClick={stopStreaming}
                        >
                          <Square className="h-3 w-3 fill-current" />
                        </Button>
                      ) : (
                        <Button
                          type="submit"
                          size="icon"
                          variant="ghost"
                          className="-mr-1 h-7 w-7 shrink-0 rounded-full text-muted-foreground hover:bg-background/70 hover:text-foreground"
                          aria-label={t('actions.sendMessage')}
                          disabled={
                            attachmentsLoading || (!draft.trim() && attachments.length === 0)
                          }
                        >
                          <Send className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </form>
            </div>
          </section>
        </div>
      </main>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={open => (!open ? setDeleteTarget(null) : undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('dialog.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('dialog.deleteDescriptionPrefix')}{' '}
              <strong>{deleteTarget?.title || defaultSessionTitle}</strong>{' '}
              {t('dialog.deleteDescriptionSuffix')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={event => {
                event.preventDefault()
                if (!deleteTarget) return
                void removeSession(deleteTarget)
              }}
            >
              {t('actions.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function MessageBubble({ message }: { message: AICopilotMessage }) {
  const { t } = useTranslation('aiCopilot')
  const isUser = message.role === 'user'
  const parsed = parseUserMessageContent(message)

  return (
    <div className={cn('flex items-start gap-3', isUser ? 'ml-[4ch]' : undefined)}>
      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted/60">
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div
        className={cn(
          'min-w-0 max-w-[min(100%,52rem)] flex-1 space-y-1.5',
          isUser ? 'rounded-2xl border border-primary/[0.07] bg-primary/[0.04] px-3 py-3' : 'pt-0.5'
        )}
      >
        {isUser && parsed.attachments.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {parsed.attachments.map(attachment => (
              <div
                key={`${attachment.name}-${attachment.size}-${attachment.record_id ?? 'local'}`}
                className="rounded-full border border-border/60 bg-background/75 px-2.5 py-1 text-[11px]"
              >
                {attachment.name}
                {attachment.size ? ` · ${formatAttachmentSize(attachment.size)}` : ''}
              </div>
            ))}
          </div>
        ) : null}
        {isUser ? (
          <div className="whitespace-pre-wrap text-sm leading-6 text-foreground/90">
            {parsed.text || (parsed.attachments.length > 0 ? t('messages.attachedFiles') : '')}
          </div>
        ) : (
          <AssistantMessageContent
            content={message.content || t('messages.thinking')}
            status={String(message.status ?? '')}
          />
        )}
      </div>
    </div>
  )
}

function AssistantMessageContent({ content, status }: { content: string; status: string }) {
  const { t } = useTranslation('aiCopilot')
  const [copied, setCopied] = useState(false)
  const showActions = status !== 'streaming' && content.trim().length > 0

  const handleCopy = async () => {
    const ok = await copyToClipboard(content)
    if (!ok) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="space-y-1.5 text-sm leading-6 text-foreground/90">
      <MarkdownView className="prose prose-sm max-w-none text-foreground dark:prose-invert [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 prose-headings:mb-2 prose-headings:mt-4 prose-p:my-2.5 prose-p:leading-7 prose-ul:my-2.5 prose-ul:pl-5 prose-ol:my-2.5 prose-ol:pl-5 prose-li:my-1 prose-li:marker:text-muted-foreground prose-pre:my-4 prose-pre:rounded-xl prose-pre:border prose-pre:border-border/60 prose-pre:bg-muted/28 prose-pre:px-4 prose-pre:py-3 prose-pre:shadow-sm prose-code:rounded prose-code:bg-muted/35 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.92em] prose-code:text-foreground prose-code:before:hidden prose-code:after:hidden prose-blockquote:my-4 prose-blockquote:border-l-border prose-blockquote:bg-muted/16 prose-blockquote:py-0.5 prose-blockquote:text-foreground/80">
        {content}
      </MarkdownView>
      {showActions ? (
        <div className="flex justify-start pt-0.5">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => void handleCopy()}
            aria-label={t('actions.copyMarkdown')}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export const Route = createFileRoute('/_app/_auth/ai-copilot')({
  component: AICopilotPage,
})
