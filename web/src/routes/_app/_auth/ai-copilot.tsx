import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  Bot,
  Check,
  ChevronDown,
  Copy,
  FileUp,
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { MarkdownView } from '@/components/ui/markdown'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
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
import { getApiErrorMessage } from '@/lib/api-error'
import { copyToClipboard } from '@/lib/clipboard'
import { getLocale } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const USER_MESSAGE_ENVELOPE_START = '[[APPOS_CHAT_V1]]'
const USER_MESSAGE_ENVELOPE_END = '[[/APPOS_CHAT_V1]]'
const TEXT_ATTACHMENT_BYTES_LIMIT = 120_000

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

async function buildDraftAttachment(
  file: File,
  labels: {
    textPreviewSkipped: (limit: string) => string
    textPreviewUnavailable: string
  }
): Promise<DraftAttachment> {
  const draft: DraftAttachment = {
    id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name,
    size: file.size,
    mimeType: file.type || 'application/octet-stream',
    loading: false,
  }

  if (!isTextAttachment(file)) {
    return draft
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
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem('ai-copilot-model') ?? '')
  const [availableModels, setAvailableModels] = useState<AICopilotModelOption[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelSearchQuery, setModelSearchQuery] = useState('')
  const [modelPopoverOpen, setModelPopoverOpen] = useState(false)

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

  useEffect(() => {
    void refreshModels()
  }, [refreshModels])
  const [busySessionId, setBusySessionId] = useState('')
  const [renamingSessionId, setRenamingSessionId] = useState('')
  const [renameDraft, setRenameDraft] = useState('')
  const [attachments, setAttachments] = useState<DraftAttachment[]>([])
  const [conversationListWide, setConversationListWide] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<AICopilotSession | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const activeSession = useMemo(
    () => sessions.find(session => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions]
  )
  const locale = getLocale()
  const defaultSessionTitle = t('page.defaultSessionTitle')

  const attachmentsLoading = attachments.some(item => item.loading)

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
    const session = await createAICopilotSession()
    setSessions(prev => [session, ...prev])
    setActiveSessionId(session.id)
    setMessages([])
  }, [])

  const filteredModels = useMemo(() => {
    const query = modelSearchQuery.trim().toLowerCase()
    if (!query) return availableModels
    return availableModels.filter(
      m => m.label.toLowerCase().includes(query) ||
        m.model_id.toLowerCase().includes(query) ||
        (m.provider_name ?? '').toLowerCase().includes(query)
    )
  }, [availableModels, modelSearchQuery])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    refreshSessions()
      .then(async items => {
        if (cancelled) return
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
      const session = await updateAICopilotSession(sessionId, nextTitle)
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

  const addFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    const files = Array.from(fileList)
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
        })
      )
    )
    setAttachments(prev => {
      const existing = prev.filter(
        item => !placeholders.some(placeholder => placeholder.id === item.id)
      )
      return [...existing, ...built]
    })
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
    const outgoingAttachments: AICopilotAttachment[] = attachments.map(item => ({
      name: item.name,
      mime_type: item.mimeType,
      size: item.size,
      text_content: item.textContent,
    }))
    if (sending || attachmentsLoading || (!content && outgoingAttachments.length === 0)) return
    setDraft('')
    setAttachments([])
    setSending(true)
    setError('')

    let sessionId = activeSessionId
    if (!sessionId) {
      const created = await createAICopilotSession()
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
    }
    setMessages(prev => [...prev, userMessage, assistantMessage])

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
                  ? { ...message, content: message.content + chunk }
                  : message
              )
            )
          },
          onDone: message => {
            setMessages(prev => prev.map(item => (item.id === assistantId ? message : item)))
          },
        },
        outgoingAttachments
      )
      await refreshSessions()
    } catch (err) {
      setError(getApiErrorMessage(err, t('messages.sendError')))
      await loadMessages(sessionId)
    } finally {
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
              'min-h-0 overflow-hidden rounded-xl border bg-background transition-all duration-200',
              conversationListWide ? 'p-3 opacity-100' : 'w-0 border-transparent p-0 opacity-0'
            )}
            aria-hidden={!conversationListWide}
          >
            <div className="mb-2.5 flex items-center justify-between gap-2 border-b pb-2.5">
              <div className="flex items-center gap-1">
                <div className="text-sm font-semibold tracking-tight">
                  {t('page.conversationList')}
                </div>
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

            <div className="space-y-1 overflow-y-auto pr-1">
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
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </aside>

          <section className="relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-background">
            <div className="px-5 py-3">
              <div className="flex items-center gap-2">
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
                <h2 className="text-lg font-semibold">{activeSession?.title || t('page.title')}</h2>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 pb-36">
              {loading ? (
                <div className="text-sm text-muted-foreground">{t('page.loading')}</div>
              ) : messages.length === 0 ? (
                <div className="mx-auto flex max-w-lg flex-col items-center justify-center py-14 text-center text-sm text-muted-foreground">
                  <Bot className="mb-3 h-7 w-7" />
                  <div className="font-medium text-foreground">{t('page.emptyTitle')}</div>
                  <div className="mt-1">{t('page.emptyDescription')}</div>
                </div>
              ) : (
                <div className="mx-auto flex max-w-4xl flex-col gap-6">
                  {messages.map(message => (
                    <MessageBubble key={message.id} message={message} />
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            <form onSubmit={submit} className="absolute inset-x-0 bottom-0 z-10 px-5 pb-4 pt-5">
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background via-background/92 to-transparent" />
              <div className="pointer-events-auto mx-auto max-w-4xl space-y-2 rounded-2xl border border-border/60 bg-background/94 p-2 shadow-[0_14px_30px_-22px_rgba(15,23,42,0.32)] backdrop-blur-md transition-colors focus-within:border-primary/30">
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
                          <span className="font-medium text-foreground/85">{attachment.name}</span>
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
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="-ml-1 h-7 w-7 shrink-0 rounded-full text-muted-foreground hover:bg-background/70 hover:text-foreground"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={sending}
                      aria-label={t('actions.uploadFiles')}
                    >
                      <FileUp className="h-3 w-3" />
                    </Button>
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
                              {availableModels.find(m => modelSelectionValue(m) === selectedModel)?.label ?? selectedModel}
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
                                  modelSelectionValue(model) === selectedModel && 'bg-accent/50 font-medium'
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
                              {modelSearchQuery ? t('fields.noModelsMatchSearch') : t('fields.noModelsAvailable')}
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
                              await navigate({ to: '/resources/ai-providers', search: { create: undefined } })
                            }}
                          >
                            <Settings className="h-3.5 w-3.5" />
                            {t('actions.configureModels')}
                          </button>
                        </div>
                      </PopoverContent>
                    </Popover>
                    <div className="flex-1" />
                    <Button
                      type="submit"
                      size="icon"
                      variant="ghost"
                      className="-mr-1 h-7 w-7 shrink-0 rounded-full text-muted-foreground hover:bg-background/70 hover:text-foreground"
                      aria-label={t('actions.sendMessage')}
                      disabled={
                        sending || attachmentsLoading || (!draft.trim() && attachments.length === 0)
                      }
                    >
                      <Send className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
            </form>
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
          <AssistantMessageContent content={message.content || t('messages.thinking')} />
        )}
      </div>
    </div>
  )
}

function AssistantMessageContent({ content }: { content: string }) {
  const { t } = useTranslation('aiCopilot')
  const [copied, setCopied] = useState(false)

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
    </div>
  )
}

export const Route = createFileRoute('/_app/_auth/ai-copilot')({
  component: AICopilotPage,
})
