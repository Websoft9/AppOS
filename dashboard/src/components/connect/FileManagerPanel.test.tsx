import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FileManagerPanel } from './FileManagerPanel'

const mockSftpList = vi.fn()
const mockSftpConstraints = vi.fn()
const mockSftpStat = vi.fn()
const mockSftpChmod = vi.fn()
const mockSftpChown = vi.fn()

vi.mock('@/lib/connect-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/connect-api')>('@/lib/connect-api')
  return {
    ...actual,
    sftpList: (...args: unknown[]) => mockSftpList(...args),
    sftpConstraints: (...args: unknown[]) => mockSftpConstraints(...args),
    sftpStat: (...args: unknown[]) => mockSftpStat(...args),
    sftpChmod: (...args: unknown[]) => mockSftpChmod(...args),
    sftpChown: (...args: unknown[]) => mockSftpChown(...args),
    sftpUpload: vi.fn(async () => {}),
    sftpSearch: vi.fn(async () => ({ path: '/', query: '', results: [] })),
    sftpDownloadUrl: vi.fn(() => '/download'),
    sftpMkdir: vi.fn(async () => {}),
    sftpRename: vi.fn(async () => {}),
    sftpDelete: vi.fn(async () => {}),
    sftpSymlink: vi.fn(async () => {}),
    sftpCopy: vi.fn(async () => {}),
    sftpMove: vi.fn(async () => {}),
    loadPreferences: vi.fn(() => ({
      terminal_font_size: 14,
      terminal_scrollback: 1000,
      sftp_show_hidden: false,
      sftp_view_mode: 'list',
    })),
    savePreferences: vi.fn(),
  }
})

vi.mock('@/lib/pb', () => ({
  pb: {
    authStore: { token: 'token', record: { id: 'u1' } },
    collection: vi.fn(() => ({ create: vi.fn(async () => ({ id: 'file-1' })) })),
  },
}))

vi.mock('./FileEditorDialog', () => ({
  FileEditorDialog: () => null,
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick, ...rest }: ComponentProps<'button'>) => (
    <button onClick={onClick} {...rest}>{children}</button>
  ),
}))

describe('FileManagerPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSftpConstraints.mockResolvedValue({ max_upload_files: 1 })
    mockSftpList.mockResolvedValue({
      path: '/',
      entries: [
        {
          name: 'a.txt',
          type: 'file',
          size: 12,
          mode: '-rw-r--r--',
          modified_at: new Date().toISOString(),
        },
      ],
    })
    mockSftpStat.mockResolvedValue({
      attrs: {
        path: '/a.txt',
        type: 'file',
        mode: '-rw-r--r--',
        owner: 0,
        group: 0,
        size: 12,
        accessed_at: new Date().toISOString(),
        modified_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      },
    })
  })

  it('enforces max upload files from settings (AC4)', async () => {
    render(<FileManagerPanel serverId="s1" />)

    await waitFor(() => expect(mockSftpConstraints).toHaveBeenCalledWith('s1'))

    const uploadInput = await screen.findByTestId('upload-input') as HTMLInputElement
    const f1 = new File(['a'], 'a.txt', { type: 'text/plain' })
    const f2 = new File(['b'], 'b.txt', { type: 'text/plain' })
    fireEvent.change(uploadInput, { target: { files: [f1, f2] } })

    await screen.findByText('Too many files: 2. Max allowed is 1')
  })

  it('opens properties flow and applies chmod/chown (AC1)', async () => {
    render(<FileManagerPanel serverId="s1" />)

    const propertiesItems = await screen.findAllByTestId('properties-a.txt')
    fireEvent.click(propertiesItems[0])

    const modeInput = await screen.findByTestId('properties-mode')
    const ownerInput = await screen.findByTestId('properties-owner')
    const groupInput = await screen.findByTestId('properties-group')

    fireEvent.change(modeInput, { target: { value: '755' } })
    fireEvent.change(ownerInput, { target: { value: '1000' } })
    fireEvent.change(groupInput, { target: { value: '1001' } })

    const saveBtn = await screen.findByTestId('properties-save')
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(mockSftpStat).toHaveBeenCalledWith('s1', '/a.txt')
      expect(mockSftpChmod).toHaveBeenCalledWith('s1', '/a.txt', '755', false)
      expect(mockSftpChown).toHaveBeenCalledWith('s1', '/a.txt', '1000', '1001')
    })
  })

  it('syncs permission matrix to mode and saves recursive chmod', async () => {
    mockSftpStat.mockResolvedValueOnce({
      attrs: {
        path: '/a.txt',
        type: 'file',
        mode: '700',
        owner: 0,
        group: 0,
        owner_name: 'root',
        group_name: 'root',
        size: 12,
        accessed_at: new Date().toISOString(),
        modified_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      },
    })

    render(<FileManagerPanel serverId="s1" />)

    const propertiesItems = await screen.findAllByTestId('properties-a.txt')
    fireEvent.click(propertiesItems[0])

    fireEvent.click(await screen.findByTestId('perm-group-read'))
    fireEvent.click(await screen.findByTestId('perm-group-execute'))
    fireEvent.click(await screen.findByTestId('perm-others-read'))
    fireEvent.click(await screen.findByTestId('perm-others-execute'))

    const modeInput = await screen.findByTestId('properties-mode') as HTMLInputElement
    await waitFor(() => expect(modeInput.value).toBe('755'))

    fireEvent.click(await screen.findByTestId('properties-recursive'))
    fireEvent.click(await screen.findByTestId('properties-save'))

    await waitFor(() => {
      expect(mockSftpChmod).toHaveBeenCalledWith('s1', '/a.txt', '755', true)
      expect(mockSftpChown).toHaveBeenCalledWith('s1', '/a.txt', 'root', 'root')
    })
  })

  it('syncs mode input back to permission matrix state', async () => {
    mockSftpStat.mockResolvedValueOnce({
      attrs: {
        path: '/a.txt',
        type: 'file',
        mode: '755',
        owner: 0,
        group: 0,
        owner_name: 'root',
        group_name: 'root',
        size: 12,
        accessed_at: new Date().toISOString(),
        modified_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      },
    })

    render(<FileManagerPanel serverId="s1" />)

    const propertiesItems = await screen.findAllByTestId('properties-a.txt')
    fireEvent.click(propertiesItems[0])

    const modeInput = await screen.findByTestId('properties-mode')
    fireEvent.change(modeInput, { target: { value: '640' } })

    await waitFor(() => {
      expect(screen.getByTestId('perm-owner-read')).toHaveAttribute('data-state', 'checked')
      expect(screen.getByTestId('perm-owner-write')).toHaveAttribute('data-state', 'checked')
      expect(screen.getByTestId('perm-owner-execute')).toHaveAttribute('data-state', 'unchecked')

      expect(screen.getByTestId('perm-group-read')).toHaveAttribute('data-state', 'checked')
      expect(screen.getByTestId('perm-group-write')).toHaveAttribute('data-state', 'unchecked')
      expect(screen.getByTestId('perm-group-execute')).toHaveAttribute('data-state', 'unchecked')

      expect(screen.getByTestId('perm-others-read')).toHaveAttribute('data-state', 'unchecked')
      expect(screen.getByTestId('perm-others-write')).toHaveAttribute('data-state', 'unchecked')
      expect(screen.getByTestId('perm-others-execute')).toHaveAttribute('data-state', 'unchecked')
    })
  })
})
