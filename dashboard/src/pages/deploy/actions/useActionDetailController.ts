import { useEffect, useRef, useState, type UIEvent } from 'react'
import { pb } from '@/lib/pb'
import { buildActionWebSocketUrl, isActiveStatus } from '@/pages/deploy/actions/action-utils'
import type { ActionLogsResponse, ActionRecord, ActionStreamMessage } from '@/pages/deploy/actions/action-types'

export function useActionDetailController(actionId: string) {
  const [operation, setOperation] = useState<ActionRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [logText, setLogText] = useState('')
  const [logUpdatedAt, setLogUpdatedAt] = useState('')
  const [logTruncated, setLogTruncated] = useState(false)
  const [streamStatus, setStreamStatus] = useState<'idle' | 'connecting' | 'live' | 'closed'>('idle')
  const [error, setError] = useState('')
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true)
  const logViewportRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)

  useEffect(() => {
    void fetchActionDetail()
  }, [actionId])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetchActionDetail(false)
    }, 3000)
    return () => window.clearInterval(timer)
  }, [actionId])

  useEffect(() => {
    if (!operation) return
    if (!isActiveStatus(operation.status)) {
      setStreamStatus('idle')
      void fetchActionLogs()
      return
    }

    setStreamStatus('connecting')
    const ws = new WebSocket(buildActionWebSocketUrl(actionId))
    ws.onopen = () => setStreamStatus('live')
    ws.onmessage = event => {
      try {
        const message = JSON.parse(String(event.data)) as ActionStreamMessage
        if (message.type === 'error') {
          setStreamStatus('closed')
          return
        }
        if (message.type === 'snapshot') setLogText(message.content || '')
        if (message.type === 'append') setLogText(current => current + (message.content || ''))
        if (message.updated) setLogUpdatedAt(message.updated)
        if (typeof message.execution_log_truncated === 'boolean') setLogTruncated(message.execution_log_truncated)
        if (message.status) setOperation(current => (current ? { ...current, status: message.status || current.status } : current))
      } catch {
        setStreamStatus('closed')
      }
    }
    ws.onerror = () => setStreamStatus('closed')
    ws.onclose = () => setStreamStatus(current => (current === 'live' ? 'closed' : current))
    return () => ws.close()
  }, [operation, actionId])

  useEffect(() => {
    if (!logViewportRef.current || !autoScrollEnabled || !stickToBottomRef.current) return
    logViewportRef.current.scrollTop = logViewportRef.current.scrollHeight
  }, [autoScrollEnabled, logText])

  useEffect(() => {
    if (!logViewportRef.current || !autoScrollEnabled) return
    stickToBottomRef.current = true
    logViewportRef.current.scrollTop = logViewportRef.current.scrollHeight
  }, [autoScrollEnabled])

  async function fetchActionDetail(showSpinner = true) {
    if (showSpinner) setLoading(true)
    try {
      const response = await pb.send<ActionRecord>(`/api/actions/${actionId}`, { method: 'GET' })
      setOperation(response)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load execution detail')
    } finally {
      if (showSpinner) setLoading(false)
    }
  }

  async function fetchActionLogs() {
    try {
      const response = await pb.send<ActionLogsResponse>(`/api/actions/${actionId}/logs`, { method: 'GET' })
      setLogText(response.execution_log || '')
      setLogUpdatedAt(response.updated)
      setLogTruncated(Boolean(response.execution_log_truncated))
    } catch (err) {
      setLogText(err instanceof Error ? err.message : 'Failed to load action logs')
    }
  }

  function handleLogScroll(event: UIEvent<HTMLDivElement>) {
    const target = event.currentTarget
    if (!autoScrollEnabled) return
    stickToBottomRef.current = target.scrollHeight - target.scrollTop - target.clientHeight < 32
  }

  return {
    operation,
    loading,
    logText,
    logUpdatedAt,
    logTruncated,
    streamStatus,
    error,
    autoScrollEnabled,
    setAutoScrollEnabled,
    logViewportRef,
    handleLogScroll,
    refresh: () => fetchActionDetail(),
  }
}