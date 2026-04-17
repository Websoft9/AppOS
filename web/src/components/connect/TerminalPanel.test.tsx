import { render, waitFor } from '@testing-library/react'
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
      const screen = document.createElement('div')
      screen.className = 'xterm-screen'
      container.appendChild(screen)

      const viewport = document.createElement('div')
      viewport.className = 'xterm-viewport'
      container.appendChild(viewport)
    }
    loadAddon() {
      this.loadAddonCallCount += 1
    }
    focus() {}
    write() {}
    scrollToBottom() {}
    dispose() {}
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
      void url
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
    vi.stubGlobal('WebSocket', mocks.MockWebSocket)
  })

  it('applies full-width viewport inset styling to avoid right-edge overflow', async () => {
    const ref = createRef<TerminalPanelHandle>()
    const { container } = render(<TerminalPanel ref={ref} serverId="s1" isActive />)

    await waitFor(() => {
      expect(mocks.MockTerminal.instances.length).toBeGreaterThan(0)
      expect(container.querySelector('.xterm-screen')).toBeTruthy()
    })

    const screen = container.querySelector('.xterm-screen') as HTMLElement
    expect(screen.style.boxSizing).toBe('border-box')
    expect(screen.style.padding).toBe('8px 10px')
    expect(screen.style.width).toBe('100%')
    expect(screen.style.minWidth).toBe('')

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

  afterAll(() => {
    vi.stubGlobal('WebSocket', OriginalWebSocket)
    if (OriginalMutationObserver) {
      vi.stubGlobal('MutationObserver', OriginalMutationObserver)
    }
  })
})
