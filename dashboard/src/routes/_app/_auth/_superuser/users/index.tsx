import { createFileRoute } from '@tanstack/react-router'
import { useState, useCallback, useEffect, useRef } from 'react'
import { Search, Loader2, UserPlus, Trash2, Edit2, KeyRound } from 'lucide-react'
import type { ListResult } from 'pocketbase'
import { pb } from '@/lib/pb'
import { type AuthRecord, escapeFilter } from '@/lib/auth-types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { CreateUserSheet } from '@/components/users/CreateUserSheet'
import { EditUserSheet } from '@/components/users/EditUserSheet'
import { ResetPasswordDialog } from '@/components/users/ResetPasswordDialog'

// ─── Constants ───────────────────────────────────────────

const PAGE_SIZE = 20

// ─── Helpers ─────────────────────────────────────────────

function formatDate(iso: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString()
}

function getAvatarUrl(record: AuthRecord): string | null {
  if (!record.avatar) return null
  return pb.files.getURL(record, record.avatar)
}

function getInitials(record: AuthRecord): string {
  if (record.name) {
    return record.name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }
  return record.email.slice(0, 2).toUpperCase()
}

// ─── Avatar component ─────────────────────────────────────

function Avatar({ record }: { record: AuthRecord }) {
  const url = getAvatarUrl(record)
  if (url) {
    return (
      <img
        src={url}
        alt={record.name ?? record.email}
        className="h-8 w-8 rounded-full object-cover"
      />
    )
  }
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium">
      {getInitials(record)}
    </div>
  )
}

// ─── Users table ─────────────────────────────────────────

interface UsersTableProps {
  collection: 'users' | '_superusers'
  onAddUser: () => void
  refreshKey?: number
}

function UsersTable({ collection, onAddUser, refreshKey }: UsersTableProps) {
  const [records, setRecords] = useState<AuthRecord[]>([])
  const [totalItems, setTotalItems] = useState(0)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AuthRecord | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [editTarget, setEditTarget] = useState<AuthRecord | null>(null)
  const [resetTarget, setResetTarget] = useState<AuthRecord | null>(null)
  // internal counter to force re-fetch even when page is already 1
  const [internalKey, setInternalKey] = useState(0)
  // track previous refreshKey to reset page on external refresh
  const prevRefreshKey = useRef(refreshKey)

  const currentId = pb.authStore.record?.id

  // Debounce search query
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(t)
  }, [query])

  // Reset to page 1 on query change
  useEffect(() => {
    setPage(1)
  }, [debouncedQuery])

  // Reset to page 1 when parent triggers a refresh (e.g. after create)
  // If already on page 1, bump internalKey to force fetchRecords to get a new ref.
  useEffect(() => {
    if (refreshKey !== prevRefreshKey.current) {
      prevRefreshKey.current = refreshKey
      if (page !== 1) {
        setPage(1) // page change cascades to fetchRecords
      } else {
        setInternalKey((k) => k + 1) // page already 1 — force re-fetch directly
      }
    }
  }, [refreshKey, page])

  const fetchRecords = useCallback(async () => {
    setLoading(true)
    try {
      const q = escapeFilter(debouncedQuery.trim())
      const filter = q
        ? collection === 'users'
          ? `name ~ "${q}" || email ~ "${q}"`
          : `email ~ "${q}"`
        : ''

      const result: ListResult<AuthRecord> = await pb
        .collection(collection)
        .getList<AuthRecord>(page, PAGE_SIZE, {
          filter,
          sort: '-created',
        })

      setRecords(result.items as AuthRecord[])
      setTotalItems(result.totalItems)
    } catch (e) {
      console.error('Failed to fetch users', e)
    } finally {
      setLoading(false)
    }
  }, [collection, page, debouncedQuery, internalKey])

  useEffect(() => {
    fetchRecords()
  }, [fetchRecords])

  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE))

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleteError(null)
    try {
      await pb.collection(collection).delete(deleteTarget.id)
      setDeleteTarget(null)
      fetchRecords()
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message ?? 'Delete failed'
      // Map backend guard messages
      if (msg.includes('cannot_delete_self')) {
        setDeleteError('You cannot delete your own account.')
      } else if (msg.includes('cannot_delete_last_superuser')) {
        setDeleteError('Cannot delete the last superuser.')
      } else {
        setDeleteError(msg)
      }
    }
  }

  const isEmpty = !loading && records.length === 0 && !debouncedQuery

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={collection === 'users' ? 'Search by name or email…' : 'Search by email…'}
            className="pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Button onClick={onAddUser} size="sm">
          <UserPlus className="mr-2 h-4 w-4" />
          Add User
        </Button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : isEmpty ? (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <p className="text-muted-foreground">No users yet.</p>
          <Button onClick={onAddUser}>
            <UserPlus className="mr-2 h-4 w-4" />
            Add User
          </Button>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>Name / Email</TableHead>
              <TableHead>Verified</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((record) => (
              <TableRow key={record.id}>
                <TableCell>
                  <Avatar record={record} />
                </TableCell>
                <TableCell>
                  <div className="font-medium">{record.name ?? <span className="text-muted-foreground italic">—</span>}</div>
                  <div className="text-sm text-muted-foreground">{record.email}</div>
                </TableCell>
                <TableCell>
                  {record.verified ? (
                    <Badge variant="secondary">Verified</Badge>
                  ) : (
                    <Badge variant="outline">Unverified</Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {formatDate(record.created)}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" title="Edit" onClick={() => setEditTarget(record)}>
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    {record.id !== currentId && (
                      <Button variant="ghost" size="icon" title="Reset Password" onClick={() => setResetTarget(record)}>
                        <KeyRound className="h-4 w-4" />
                      </Button>
                    )}
                    {record.id !== currentId && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Delete"
                        className="text-destructive hover:text-destructive"
                        onClick={() => { setDeleteTarget(record); setDeleteError(null) }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{totalItems} total</span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <span className="flex items-center px-2">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeleteError(null) } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.email}</strong>. This action cannot be undone.
              {deleteError && (
                <span className="mt-2 block text-destructive">{deleteError}</span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit user sheet */}
      {editTarget && (
        <EditUserSheet
          open={!!editTarget}
          onOpenChange={(open) => { if (!open) setEditTarget(null) }}
          record={editTarget}
          collection={collection}
          onSuccess={() => { setEditTarget(null); fetchRecords() }}
        />
      )}

      {/* Reset password dialog */}
      <ResetPasswordDialog
        open={!!resetTarget}
        onOpenChange={(open) => { if (!open) setResetTarget(null) }}
        userId={resetTarget?.id ?? ''}
        userEmail={resetTarget?.email ?? ''}
        collection={collection}
        onSuccess={() => { setResetTarget(null) }}
      />
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────

function UsersPage() {
  const [addUserOpen, setAddUserOpen] = useState(false)
  const [membersRefreshKey, setMembersRefreshKey] = useState(0)
  const [superusersRefreshKey, setSuperusersRefreshKey] = useState(0)
  const [activeTab, setActiveTab] = useState<'members' | 'superusers'>('members')

  function handleCreateSuccess(collection: 'users' | '_superusers') {
    if (collection === 'users') {
      setMembersRefreshKey((k) => k + 1)
      setActiveTab('members')
    } else {
      setSuperusersRefreshKey((k) => k + 1)
      setActiveTab('superusers')
    }
  }

  return (
    <div className="container mx-auto max-w-5xl space-y-6 py-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="text-sm text-muted-foreground">Manage platform members and superusers.</p>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'members' | 'superusers')}>
        <TabsList>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="superusers">Superusers</TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="mt-4">
          <UsersTable
            collection="users"
            onAddUser={() => setAddUserOpen(true)}
            refreshKey={membersRefreshKey}
          />
        </TabsContent>

        <TabsContent value="superusers" className="mt-4">
          <UsersTable
            collection="_superusers"
            onAddUser={() => setAddUserOpen(true)}
            refreshKey={superusersRefreshKey}
          />
        </TabsContent>
      </Tabs>

      <CreateUserSheet
        open={addUserOpen}
        onOpenChange={setAddUserOpen}
        onSuccess={handleCreateSuccess}
      />
    </div>
  )
}

export const Route = createFileRoute('/_app/_auth/_superuser/users/')({
  component: UsersPage,
})
