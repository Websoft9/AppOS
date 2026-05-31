import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import { TerminalPanel, type TerminalPanelHandle } from './TerminalPanel'

const mocks = vi.hoisted(() => {
  class MockTerminal {
    static instances: MockTerminal[] = []

    cols = 120
    rows = 40
    loadAddonCallCount = 0
    open(container: HTMLElement) {
      const xterm = document.createElement('div')
      xterm.className = 'xterm'
      container.appendChild(xterm)

      const screen = document.createElement('div')
      screen.className = 'xterm-screen'
      xterm.appendChild(screen)

      const viewport = document.createElement('div')
      viewport.className = 'xterm-viewport'
      xterm.appendChild(viewport)
    }
    loadAddon() {
      this.loadAddonCallCount += 1
    }
    focus() {}
    write() {}
    scrollToBottom() {}
    dispose(container?: HTMLElement) {
      void container
    }
    onData() {}
    onResize() {}

    constructor() {
      MockTerminal.instances.push(this)
    }
  }

  class MockFitAddon {
    fit() {}
  }

  class MockWebSocket {
    static instances: MockWebSocket[] = []
    static urls: string[] = []
    static OPEN = 1

    readyState = MockWebSocket.OPEN
    binaryType = ''
    onopen: ((event: Event) => void) | null = null
    onmessage: ((event: MessageEvent) => void) | null = null
    onclose: ((event: CloseEvent) => void) | null = null
    onerror: ((event: Event) => void) | null = null
    send = vi.fn()
    close = vi.fn()

    constructor(url: string) {
      MockWebSocket.urls.push(url)
      MockWebSocket.instances.push(this)
      setTimeout(() => {
        this.onopen?.(new Event('open'))
      }, 0)
    }
  }

  return { MockTerminal, MockFitAddon, MockWebSocket }
})

vi.mock('@xterm/xterm', () => ({
  Terminal: mocks.MockTerminal,
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: mocks.MockFitAddon,
}))

vi.mock('@/lib/connect-api', () => ({
  sshWebSocketUrl: vi.fn(() => 'ws://localhost:8090/api/terminal/ssh/s1'),
  dockerWebSocketUrl: vi.fn(() => 'ws://localhost:8090/api/terminal/docker/c1'),
  loadPreferences: vi.fn(() => ({
    terminal_font_size: 14,
    terminal_scrollback: 1000,
  })),
}))

vi.mock('@/lib/pb', () => ({
  pb: {
    authStore: {
      token: 'test-token',
    },
  },
}))

describe('TerminalPanel regressions', () => {
  const OriginalWebSocket = globalThis.WebSocket
  const OriginalMutationObserver = globalThis.MutationObserver

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.MockTerminal.instances = []
    mocks.MockWebSocket.instances = []
    mocks.MockWebSocket.urls = []
    vi.stubGlobal('WebSocket', mocks.MockWebSocket)
  })

  it('applies full-width viewport inset styling to avoid right-edge overflow', async () => {
    const ref = createRef<TerminalPanelHandle>()
    const { container } = render(<TerminalPanel ref={ref} serverId="s1" isActive />)

    await waitFor(() => {
      expect(mocks.MockTerminal.instances.length).toBeGreaterThan(0)
      expect(container.querySelector('.xterm-screen')).toBeTruthy()
    })

    const frame = container.querySelector('[data-terminal-frame]') as HTMLElement
    const xterm = container.querySelector('.xterm') as HTMLElement
    const screen = container.querySelector('.xterm-screen') as HTMLElement
    expect(frame.className).toContain('bg-[#1a1b26]')
    expect(frame.style.paddingTop).toBe('0px')
    expect(frame.style.paddingRight).toBe('0px')
    expect(xterm.style.boxSizing).toBe('border-box')
    expect(xterm.style.padding).toBe('1em 1ch 8px 10px')
    expect(screen.style.boxSizing).toBe('border-box')
    expect(screen.style.width).toBe('100%')
    expect(screen.style.height).toBe('100%')

    const viewport = container.querySelector('.xterm-viewport') as HTMLElement
    expect(viewport.style.width).toBe('100%')
    expect(viewport.style.height).toBe('100%')
    expect(viewport.style.padding).toBe('1em 1ch 8px 10px')

    ref.current?.requestFit()
    await waitFor(() => {
      const terminal = mocks.MockTerminal.instances[0]
      expect(terminal.loadAddonCallCount).toBeGreaterThan(0)
    })
  })

  it('does not attach MutationObserver to prevent switch-loop regressions', async () => {
    const mutationObserverSpy = vi.fn()
    class MutationObserverMock {
      constructor() {
        mutationObserverSpy()
      }
      observe() {}
      disconnect() {}
      takeRecords() {
        return []
      }
    }

    vi.stubGlobal('MutationObserver', MutationObserverMock)

    render(<TerminalPanel serverId="s1" isActive />)

    await new Promise(resolve => setTimeout(resolve, 0))

    expect(mutationObserverSpy).not.toHaveBeenCalled()
  })

  it('reconnects cleanly after a dropped connection even if the old socket closes late', async () => {
    render(<TerminalPanel serverId="s1" isActive />)

    let initialSocketCount = 0
    await waitFor(() => {
      expect(mocks.MockWebSocket.instances.length).toBeGreaterThan(0)
    })
    initialSocketCount = mocks.MockWebSocket.instances.length

    const firstSocket = mocks.MockWebSocket.instances[initialSocketCount - 1]
    firstSocket.onerror?.(new Event('error'))

    const reconnectButton = await screen.findByRole('button', { name: /reconnect/i })
    fireEvent.click(reconnectButton)

    await waitFor(() => {
      expect(mocks.MockWebSocket.instances.length).toBe(initialSocketCount + 1)
    })

    firstSocket.onclose?.(
      new CloseEvent('close', {
        code: 1006,
        reason: 'late close from previous socket',
      })
    )

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /reconnect/i })).not.toBeInTheDocument()
    })
  })

  it('reports the established backend session id from a control frame', async () => {
    const onSessionEstablished = vi.fn()

    render(<TerminalPanel serverId="s1" isActive onSessionEstablished={onSessionEstablished} />)

    await waitFor(() => {
      expect(mocks.MockWebSocket.instances.length).toBeGreaterThan(0)
    })

    const socket = mocks.MockWebSocket.instances[0]
    const payload = new TextEncoder().encode(
      JSON.stringify({ type: 'session', session_id: 'sess-123' })
    )
    const frame = new Uint8Array(1 + payload.length)
    frame[0] = 0x00
    frame.set(payload, 1)

    socket.onmessage?.(
      new MessageEvent('message', {
        data: frame.buffer,
      })
    )

    expect(onSessionEstablished).toHaveBeenCalledWith('sess-123')
  })

  it('does not reconnect after receiving the backend session control frame', async () => {
    const onSessionEstablished = vi.fn()

    render(<TerminalPanel serverId="s1" isActive onSessionEstablished={onSessionEstablished} />)

    await waitFor(() => {
      expect(mocks.MockWebSocket.instances.length).toBe(1)
    })

    const socket = mocks.MockWebSocket.instances[0]
    const payload = new TextEncoder().encode(
      JSON.stringify({ type: 'session', session_id: 'sess-stable' })
    )
    const frame = new Uint8Array(1 + payload.length)
    frame[0] = 0x00
    frame.set(payload, 1)

    socket.onmessage?.(
      new MessageEvent('message', {
        data: frame.buffer,
      })
    )

    await waitFor(() => {
      expect(onSessionEstablished).toHaveBeenCalledWith('sess-stable')
      expect(mocks.MockWebSocket.instances.length).toBe(1)
    })
  })

  it('passes session_id when reconnecting a container terminal', async () => {
    render(
      <TerminalPanel containerId="c1" sessionId="dock-sess-1" dockerServerId="srv-1" isActive />
    )

    await waitFor(() => {
      expect(mocks.MockWebSocket.instances.length).toBeGreaterThan(0)
    })

    const url = new URL(mocks.MockWebSocket.urls[0])
    expect(url.pathname).toBe('/api/terminal/docker/c1')
    expect(url.searchParams.get('session_id')).toBe('dock-sess-1')
    expect(url.searchParams.get('server_id')).toBe('srv-1')
  })

  it('drops a stale session id and reconnects fresh when the backend reports session not found', async () => {
    const onSessionInvalidated = vi.fn()

    render(
      <TerminalPanel
        serverId="s1"
        sessionId="stale-sess-1"
        isActive
        onSessionInvalidated={onSessionInvalidated}
      />
    )

    await waitFor(() => {
      expect(mocks.MockWebSocket.instances.length).toBe(1)
    })

    const firstUrl = new URL(mocks.MockWebSocket.urls[0])
    expect(firstUrl.searchParams.get('session_id')).toBe('stale-sess-1')

    const socket = mocks.MockWebSocket.instances[0]
    const payload = new TextEncoder().encode(
      JSON.stringify({ type: 'error', message: 'terminal session not found' })
    )
    const frame = new Uint8Array(1 + payload.length)
    frame[0] = 0x00
    frame.set(payload, 1)

    socket.onmessage?.(
      new MessageEvent('message', {
        data: frame.buffer,
      })
    )

    await waitFor(() => {
      expect(mocks.MockWebSocket.instances.length).toBe(2)
    })

    expect(onSessionInvalidated).toHaveBeenCalledWith('stale-sess-1')
    const retryUrl = new URL(mocks.MockWebSocket.urls[1])
    expect(retryUrl.searchParams.get('session_id')).toBeNull()
    expect(screen.queryByRole('button', { name: /reconnect/i })).not.toBeInTheDocument()
  })

  it('uses detach on unmount and disconnect on explicit close', async () => {
    const disconnectRef = createRef<TerminalPanelHandle>()
    const disconnectView = render(<TerminalPanel ref={disconnectRef} serverId="s1" isActive />)

    await waitFor(() => {
      expect(mocks.MockWebSocket.instances.length).toBeGreaterThan(0)
    })

    const disconnectSocket = mocks.MockWebSocket.instances[0]
    disconnectRef.current?.disconnect()
    expect(disconnectSocket.close).toHaveBeenCalledWith(1000, 'disconnect')
    disconnectView.unmount()

    const detachView = render(<TerminalPanel serverId="s1" isActive />)

    await waitFor(() => {
      expect(mocks.MockWebSocket.instances.length).toBeGreaterThan(1)
    })

    const detachSocket = mocks.MockWebSocket.instances[1]
    detachView.unmount()
    expect(detachSocket.close).toHaveBeenCalledWith(1000, 'detach')
  })

  afterAll(() => {
    vi.stubGlobal('WebSocket', OriginalWebSocket)
    if (OriginalMutationObserver) {
      vi.stubGlobal('MutationObserver', OriginalMutationObserver)
    }
  })
})
