import { useEffect, useRef, useState, type UIEvent } from 'react'
import { pb } from '@/lib/pb'
import { buildDeploymentWebSocketUrl, isActiveStatus } from '@/pages/deploy/deploy-utils'
import type { DeploymentLogsResponse, DeploymentRecord, DeploymentStreamMessage } from '@/pages/deploy/deploy-types'

export function useDeploymentDetailController(deploymentId: string) {
  const [deployment, setDeployment] = useState<DeploymentRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [logText, setLogText] = useState('')
  const [logUpdatedAt, setLogUpdatedAt] = useState('')
  const [logTruncated, setLogTruncated] = useState(false)
  const [streamStatus, setStreamStatus] = useState<'idle' | 'connecting' | 'live' | 'closed'>('idle')
  const [error, setError] = useState('')
  const logViewportRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)

  useEffect(() => {
    void fetchDeploymentDetail()
  }, [deploymentId])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetchDeploymentDetail(false)
    }, 3000)
    return () => window.clearInterval(timer)
  }, [deploymentId])

  useEffect(() => {
    if (!deployment) return
    if (!isActiveStatus(deployment.status)) {
      setStreamStatus('idle')
      void fetchDeploymentLogs()
      return
    }

    setStreamStatus('connecting')
    const ws = new WebSocket(buildDeploymentWebSocketUrl(deploymentId))
    ws.onopen = () => setStreamStatus('live')
    ws.onmessage = event => {
      try {
        const message = JSON.parse(String(event.data)) as DeploymentStreamMessage
        if (message.type === 'error') {
          setStreamStatus('closed')
          return
        }
        if (message.type === 'snapshot') setLogText(message.content || '')
        if (message.type === 'append') setLogText(current => current + (message.content || ''))
        if (message.updated) setLogUpdatedAt(message.updated)
        if (typeof message.execution_log_truncated === 'boolean') setLogTruncated(message.execution_log_truncated)
        if (message.status) setDeployment(current => (current ? { ...current, status: message.status || current.status } : current))
      } catch {
        setStreamStatus('closed')
      }
    }
    ws.onerror = () => setStreamStatus('closed')
    ws.onclose = () => setStreamStatus(current => (current === 'live' ? 'closed' : current))
    return () => ws.close()
  }, [deployment, deploymentId])

  useEffect(() => {
    if (!logViewportRef.current || !stickToBottomRef.current) return
    logViewportRef.current.scrollTop = logViewportRef.current.scrollHeight
  }, [logText])

  async function fetchDeploymentDetail(showSpinner = true) {
    if (showSpinner) setLoading(true)
    try {
      const response = await pb.send<DeploymentRecord>(`/api/deployments/${deploymentId}`, { method: 'GET' })
      setDeployment(response)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load deployment detail')
    } finally {
      if (showSpinner) setLoading(false)
    }
  }

  async function fetchDeploymentLogs() {
    try {
      const response = await pb.send<DeploymentLogsResponse>(`/api/deployments/${deploymentId}/logs`, { method: 'GET' })
      setLogText(response.execution_log || '')
      setLogUpdatedAt(response.updated)
      setLogTruncated(Boolean(response.execution_log_truncated))
    } catch (err) {
      setLogText(err instanceof Error ? err.message : 'Failed to load deployment logs')
    }
  }

  function handleLogScroll(event: UIEvent<HTMLDivElement>) {
    const target = event.currentTarget
    stickToBottomRef.current = target.scrollHeight - target.scrollTop - target.clientHeight < 32
  }

  return {
    deployment,
    loading,
    logText,
    logUpdatedAt,
    logTruncated,
    streamStatus,
    error,
    logViewportRef,
    handleLogScroll,
    refresh: () => fetchDeploymentDetail(),
  }
}