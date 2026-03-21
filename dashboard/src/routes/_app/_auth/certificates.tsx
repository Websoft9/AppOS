import React, { useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Download,
  Filter,
  MoreVertical,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react'
import { pb } from '@/lib/pb'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
import { getLocale } from '@/lib/i18n'

// ─── Types ───────────────────────────────────────────────

interface CertTemplateField {
  key: string
  label: string
  type: string
  required?: boolean
  upload?: boolean
}

interface CertTemplate {
  id: string
  label: string
  kind: string
  description?: string
  fields: CertTemplateField[]
}

interface CertRecord {
  id: string
  name: string
  domain: string
  template_id: string
  kind: string
  cert_pem?: string
  key?: string
  issuer?: string
  subject?: string
  expires_at?: string
  issued_at?: string
  serial_number?: string
  signature_algorithm?: string
  key_bits?: number
  cert_version?: number
  status: string
  auto_renew: boolean
  description?: string
  created?: string
}

type SortField = 'name' | 'domain' | 'expires_at' | 'issued_at'
type SortDir = 'asc' | 'desc'
type KindFilter = 'all' | 'self_signed' | 'ca_issued'
type StatusFilter = 'all' | 'active' | 'expired' | 'revoked'

const CERT_EXTENSIONS = new Set(['pem', 'crt', 'cer', 'txt'])
const BINARY_CERT_EXTENSIONS = new Set(['p12', 'pfx'])
const DEFAULT_VALIDITY_DAYS = 365
const CREATE_SECRET_OPTION_VALUE = '__create_tls_private_key__'

function formatDate(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const bcp47 = getLocale() === 'zh' ? 'zh-CN' : 'en-US'
  return d.toLocaleDateString(bcp47, { year: 'numeric', month: 'short', day: 'numeric' })
}

function isExpiringSoon(iso?: string): boolean {
  if (!iso) return false
  const d = new Date(iso)
  if (isNaN(d.getTime())) return false
  const daysLeft = (d.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  return daysLeft > 0 && daysLeft <= 30
}

function daysUntil(iso?: string): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

function downloadFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'application/x-pem-file' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function humanizeKind(kind: string): string {
  switch (kind) {
    case 'self_signed':
      return 'Self-Signed'
    case 'ca_issued':
      return 'CA-Issued'
    default:
      return kind
  }
}

function StatusBadge({ status, expiresAt }: { status: string; expiresAt?: string }) {
  if (status === 'expired') return <Badge variant="destructive">expired</Badge>
  if (status === 'revoked') return <Badge variant="secondary">revoked</Badge>
  if (isExpiringSoon(expiresAt))
    return (
      <Badge variant="outline" className="border-yellow-500 text-yellow-600">
        ⚠ expiring
      </Badge>
    )
  return <Badge variant="outline">active</Badge>
}

// ─── Reusable components ─────────────────────────────────

function SortableHeader({
  label,
  field,
  current,
  dir,
  onSort,
}: {
  label: string
  field: SortField
  current: SortField | null
  dir: SortDir
  onSort: (f: SortField) => void
}) {
  const active = current === field
  return (
    <button
      type="button"
      className="flex items-center gap-1 hover:text-foreground"
      onClick={() => onSort(field)}
    >
      {label}
      {active ? (
        dir === 'asc' ? (
          <ArrowUp className="h-3.5 w-3.5" />
        ) : (
          <ArrowDown className="h-3.5 w-3.5" />
        )
      ) : (
        <ArrowDown className="h-3.5 w-3.5 opacity-30" />
      )}
    </button>
  )
}

// ─── Detail row (inline expandable) ──────────────────────

function CertDetailRow({ item, colSpan }: { item: CertRecord; colSpan: number }) {
  const remaining = daysUntil(item.expires_at)
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="bg-muted/30 px-8 py-4">
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm max-w-2xl">
          <div>
            <span className="text-muted-foreground text-xs font-medium">ID</span>
            <p className="font-mono text-xs">{item.id}</p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs font-medium">Kind</span>
            <p>{humanizeKind(item.kind)}</p>
          </div>
          {item.cert_version != null && (
            <div>
              <span className="text-muted-foreground text-xs font-medium">Version</span>
              <p>v{item.cert_version}</p>
            </div>
          )}
          {item.serial_number && (
            <div>
              <span className="text-muted-foreground text-xs font-medium">Serial Number</span>
              <p className="font-mono text-xs break-all">{item.serial_number.toUpperCase()}</p>
            </div>
          )}
          {item.signature_algorithm && (
            <div>
              <span className="text-muted-foreground text-xs font-medium">Signature Algorithm</span>
              <p>{item.signature_algorithm}</p>
            </div>
          )}
          {item.key_bits != null && item.key_bits > 0 && (
            <div>
              <span className="text-muted-foreground text-xs font-medium">Public Key</span>
              <p>{item.key_bits}-bit</p>
            </div>
          )}
          <div>
            <span className="text-muted-foreground text-xs font-medium">Issuer (CN)</span>
            <p>{item.issuer || '—'}</p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs font-medium">Subject (CN)</span>
            <p>{item.subject || '—'}</p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs font-medium">Issued At</span>
            <p>{formatDate(item.issued_at)}</p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs font-medium">Expires At</span>
            <p>
              {formatDate(item.expires_at)}
              {remaining !== null && remaining > 0 && (
                <span className="text-muted-foreground ml-1">({remaining}d remaining)</span>
              )}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground text-xs font-medium">Status</span>
            <div className="mt-0.5">
              <StatusBadge status={item.status} expiresAt={item.expires_at} />
            </div>
          </div>
          {item.description && (
            <div className="col-span-2">
              <span className="text-muted-foreground text-xs font-medium">Description</span>
              <p>{item.description}</p>
            </div>
          )}
          {item.created && (
            <div>
              <span className="text-muted-foreground text-xs font-medium">Created</span>
              <p>{formatDate(item.created)}</p>
            </div>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

// ─── Main page ───────────────────────────────────────────

function CertificatesPage() {
  const [allItems, setAllItems] = useState<CertRecord[]>([])
  const [templates, setTemplates] = useState<CertTemplate[]>([])
  const [secrets, setSecrets] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Search, sort & filter
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  // Expandable detail
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Create form
  const [createOpen, setCreateOpen] = useState(false)
  const [createTemplateId, setCreateTemplateId] = useState('')
  const [createFields, setCreateFields] = useState<Record<string, string>>({})
  const [createValidityDays, setCreateValidityDays] = useState(DEFAULT_VALIDITY_DAYS)
  const [createSaving, setCreateSaving] = useState(false)
  const [createError, setCreateError] = useState('')

  // Edit form
  const [editOpen, setEditOpen] = useState(false)
  const [editRecord, setEditRecord] = useState<CertRecord | null>(null)
  const [editFields, setEditFields] = useState<Record<string, string>>({})
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')

  // Renew dialog
  const [renewTarget, setRenewTarget] = useState<{ id: string; name: string } | null>(null)
  const [renewDays, setRenewDays] = useState(DEFAULT_VALIDITY_DAYS)
  const [renewing, setRenewing] = useState(false)

  // Delete
  const [deleteAction, setDeleteAction] = useState<{ id: string; name: string } | null>(null)

  // File upload error
  const [uploadError, setUploadError] = useState('')

  // Quick create TLS private key secret
  const [quickSecretOpen, setQuickSecretOpen] = useState(false)
  const [quickSecretTarget, setQuickSecretTarget] = useState<'create' | 'edit' | null>(null)
  const [quickSecretName, setQuickSecretName] = useState('')
  const [quickSecretPrivateKey, setQuickSecretPrivateKey] = useState('')
  const [quickSecretSaving, setQuickSecretSaving] = useState(false)
  const [quickSecretError, setQuickSecretError] = useState('')

  async function fetchAll() {
    setLoading(true)
    setError('')
    try {
      const [certs, tpls] = await Promise.all([
        pb.collection('certificates').getFullList<CertRecord>({ sort: '-created' }),
        pb.send('/api/certificates/templates', { method: 'GET' }) as Promise<CertTemplate[]>,
      ])
      setAllItems(certs)
      setTemplates(tpls)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load certificates')
    } finally {
      setLoading(false)
    }
  }

  async function fetchSecrets() {
    try {
      const list = await pb
        .collection('secrets')
        .getFullList<{ id: string; name: string; template_id: string; status: string }>({
          filter: 'status = "active"',
          fields: 'id,name,template_id,status',
        })
      const tlsKeys = list.filter(s => s.template_id === 'tls_private_key')
      setSecrets(tlsKeys.length > 0 ? tlsKeys : list)
    } catch {
      setSecrets([])
    }
  }

  useEffect(() => {
    fetchAll()
    fetchSecrets()
  }, [])

  function openQuickSecretCreate(target: 'create' | 'edit') {
    setQuickSecretTarget(target)
    setQuickSecretName('')
    setQuickSecretPrivateKey('')
    setQuickSecretError('')
    setQuickSecretSaving(false)
    setQuickSecretOpen(true)
  }

  async function handleQuickSecretCreate() {
    if (!quickSecretTarget) return
    setQuickSecretSaving(true)
    setQuickSecretError('')

    try {
      const rec = await pb.collection('secrets').create<{ id: string }>({
        name: quickSecretName,
        template_id: 'tls_private_key',
        scope: 'global',
        payload: {
          private_key: quickSecretPrivateKey,
        },
      })

      await fetchSecrets()
      if (quickSecretTarget === 'create') {
        setCreateFields(prev => ({ ...prev, key: rec.id }))
      } else {
        setEditFields(prev => ({ ...prev, key: rec.id }))
      }
      setQuickSecretOpen(false)
    } catch (err: unknown) {
      setQuickSecretError(
        err instanceof Error ? err.message : 'Failed to create private key secret'
      )
    } finally {
      setQuickSecretSaving(false)
    }
  }

  const selectedCreateTemplate = useMemo(
    () => templates.find(t => t.id === createTemplateId),
    [templates, createTemplateId]
  )

  const filteredItems = useMemo(() => {
    let result = allItems
    if (kindFilter !== 'all') {
      result = result.filter(item => item.kind === kindFilter)
    }
    if (statusFilter !== 'all') {
      result = result.filter(item => item.status === statusFilter)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(
        item => item.name.toLowerCase().includes(q) || item.domain.toLowerCase().includes(q)
      )
    }
    if (sortField) {
      result = [...result].sort((a, b) => {
        const aVal = (a[sortField] ?? '') as string
        const bVal = (b[sortField] ?? '') as string
        const cmp = aVal.localeCompare(bVal)
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    return result
  }, [allItems, search, sortField, sortDir, kindFilter, statusFilter])

  function handleSort(field: SortField) {
    if (sortField === field) setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'))
    else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  // ─── Create ────────────────────────────────────────────

  function openCreate() {
    setCreateTemplateId('')
    setCreateFields({})
    setCreateValidityDays(DEFAULT_VALIDITY_DAYS)
    setCreateError('')
    setCreateSaving(false)
    setUploadError('')
    setCreateOpen(true)
  }

  async function handleCreate() {
    if (!selectedCreateTemplate) return
    setCreateSaving(true)
    setCreateError('')
    try {
      const data: Record<string, unknown> = {
        template_id: createTemplateId,
        kind: selectedCreateTemplate.kind,
      }
      for (const field of selectedCreateTemplate.fields) {
        if (field.key === 'key') {
          if (createFields[field.key]) data[field.key] = createFields[field.key]
        } else {
          data[field.key] = createFields[field.key] ?? ''
        }
      }
      if (!data.status) data.status = 'active'

      const created = await pb.collection('certificates').create<CertRecord>(data)

      if (selectedCreateTemplate.kind === 'self_signed') {
        try {
          await pb.send(`/api/certificates/${created.id}/generate-self-signed`, {
            method: 'POST',
            body: { validity_days: createValidityDays || DEFAULT_VALIDITY_DAYS },
          })
        } catch (genErr: unknown) {
          setCreateError(
            `Certificate created but generation failed: ${genErr instanceof Error ? genErr.message : 'unknown error'}. You can retry via Renew action.`
          )
          await fetchAll()
          return
        }
      }

      setCreateOpen(false)
      await fetchAll()
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create certificate')
    } finally {
      setCreateSaving(false)
    }
  }

  // ─── Edit ──────────────────────────────────────────────

  function openEdit(record: CertRecord) {
    setEditRecord(record)
    setEditFields({
      name: record.name,
      description: record.description ?? '',
      cert_pem: record.cert_pem ?? '',
      key: record.key ?? '',
    })
    setEditError('')
    setEditSaving(false)
    setUploadError('')
    setEditOpen(true)
  }

  async function handleEditSave() {
    if (!editRecord) return
    setEditSaving(true)
    setEditError('')
    try {
      const data: Record<string, unknown> = {
        name: editFields.name,
        description: editFields.description,
      }
      if (editRecord.kind === 'ca_issued') {
        data.cert_pem = editFields.cert_pem
        if (editFields.key) data.key = editFields.key
      }
      await pb.collection('certificates').update(editRecord.id, data)
      setEditOpen(false)
      await fetchAll()
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : 'Failed to update certificate')
    } finally {
      setEditSaving(false)
    }
  }

  // ─── Renew ─────────────────────────────────────────────

  function openRenew(item: CertRecord) {
    setRenewTarget({ id: item.id, name: item.name })
    setRenewDays(DEFAULT_VALIDITY_DAYS)
    setRenewing(false)
  }

  async function handleRenew() {
    if (!renewTarget) return
    setRenewing(true)
    try {
      await pb.send(`/api/certificates/${renewTarget.id}/renew-self-signed`, {
        method: 'POST',
        body: { validity_days: renewDays || DEFAULT_VALIDITY_DAYS },
      })
      setRenewTarget(null)
      await fetchAll()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Renew failed')
      setRenewTarget(null)
      await fetchAll()
    } finally {
      setRenewing(false)
    }
  }

  // ─── Delete ────────────────────────────────────────────

  async function handleDelete() {
    if (!deleteAction) return
    try {
      await pb.collection('certificates').delete(deleteAction.id)
      setDeleteAction(null)
      await fetchAll()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  // ─── File upload handler ───────────────────────────────

  function handleFileUpload(
    fieldKey: string,
    file: File,
    setter: (key: string, val: string) => void
  ) {
    setUploadError('')
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (BINARY_CERT_EXTENSIONS.has(ext)) {
      setUploadError(
        'Binary certificate formats are not supported. Export the certificate as PEM first.'
      )
      return
    }
    if (!CERT_EXTENSIONS.has(ext)) {
      setUploadError(`Unsupported file extension ".${ext}". Accepted: .pem, .crt, .cer, .txt`)
      return
    }
    const slice = file.slice(0, 8192)
    const probeReader = new FileReader()
    probeReader.onload = () => {
      const text = probeReader.result as string
      if (text.includes('\0')) {
        setUploadError(`"${file.name}" appears to be a binary file.`)
        return
      }
      const fullReader = new FileReader()
      fullReader.onload = () => setter(fieldKey, fullReader.result as string)
      fullReader.readAsText(file)
    }
    probeReader.readAsText(slice)
  }

  // ─── Render ────────────────────────────────────────────

  const colSpan = 7

  return (
    <div className="space-y-4 p-4 cursor-default">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Certificates</h1>
          <p className="text-muted-foreground mt-1">
            Manage TLS certificates — generate self-signed or import CA-issued.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" title="Refresh" onClick={fetchAll}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button onClick={openCreate}>New Certificate</Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Search + Kind filter */}
      <div className="flex items-center gap-2">
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search certificates..."
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Filter className="h-3.5 w-3.5" />
              {kindFilter === 'all' ? 'Kind' : humanizeKind(kindFilter)}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => setKindFilter('all')}>
              {kindFilter === 'all' && <span className="mr-1">✓</span>}All
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setKindFilter('self_signed')}>
              {kindFilter === 'self_signed' && <span className="mr-1">✓</span>}Self-Signed
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setKindFilter('ca_issued')}>
              {kindFilter === 'ca_issued' && <span className="mr-1">✓</span>}CA-Issued
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Filter className="h-3.5 w-3.5" />
              {statusFilter === 'all'
                ? 'Status'
                : statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => setStatusFilter('all')}>
              {statusFilter === 'all' && <span className="mr-1">✓</span>}All
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setStatusFilter('active')}>
              {statusFilter === 'active' && <span className="mr-1">✓</span>}Active
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setStatusFilter('expired')}>
              {statusFilter === 'expired' && <span className="mr-1">✓</span>}Expired
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setStatusFilter('revoked')}>
              {statusFilter === 'revoked' && <span className="mr-1">✓</span>}Revoked
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Table */}
      {loading ? null : filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-md border py-12 text-center">
          <p className="text-muted-foreground">No certificates found.</p>
          <button
            type="button"
            className="mt-2 text-sm text-primary hover:underline"
            onClick={openCreate}
          >
            Create your first one
          </button>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <SortableHeader
                  label="Name"
                  field="name"
                  current={sortField}
                  dir={sortDir}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead>
                <SortableHeader
                  label="Domain"
                  field="domain"
                  current={sortField}
                  dir={sortDir}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>
                <SortableHeader
                  label="Issued"
                  field="issued_at"
                  current={sortField}
                  dir={sortDir}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead>
                <SortableHeader
                  label="Expires"
                  field="expires_at"
                  current={sortField}
                  dir={sortDir}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredItems.map(item => {
              const isExpanded = expandedId === item.id
              return (
                <React.Fragment key={item.id}>
                  <TableRow className="group">
                    <TableCell
                      className="font-medium cursor-pointer"
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                        {item.name}
                      </span>
                    </TableCell>
                    <TableCell>{item.domain}</TableCell>
                    <TableCell>{humanizeKind(item.kind)}</TableCell>
                    <TableCell>{formatDate(item.issued_at)}</TableCell>
                    <TableCell>{formatDate(item.expires_at)}</TableCell>
                    <TableCell>
                      <StatusBadge status={item.status} expiresAt={item.expires_at} />
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" title="More actions">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(item)}>
                            <Pencil className="h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          {item.cert_pem && (
                            <DropdownMenuItem
                              onClick={() => downloadFile(`${item.name}.crt`, item.cert_pem!)}
                            >
                              <Download className="h-4 w-4" />
                              Download
                            </DropdownMenuItem>
                          )}
                          {item.kind === 'self_signed' && (
                            <DropdownMenuItem onClick={() => openRenew(item)}>
                              <RefreshCw className="h-4 w-4" />
                              Renew
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setDeleteAction({ id: item.id, name: item.name })}
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                  {isExpanded && <CertDetailRow item={item} colSpan={colSpan} />}
                </React.Fragment>
              )
            })}
          </TableBody>
        </Table>
      )}

      {/* ── Create Dialog ── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent
          className="max-w-lg max-h-[85vh] overflow-y-auto"
          onOpenAutoFocus={e => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>New Certificate</DialogTitle>
            <DialogDescription>Create a new certificate record.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Template</Label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={createTemplateId}
                onChange={e => {
                  setCreateTemplateId(e.target.value)
                  setCreateFields({})
                  setCreateValidityDays(DEFAULT_VALIDITY_DAYS)
                }}
              >
                <option value="">Select template</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              {selectedCreateTemplate?.description && (
                <p className="text-xs text-muted-foreground">
                  {selectedCreateTemplate.description}
                </p>
              )}
            </div>

            {selectedCreateTemplate &&
              selectedCreateTemplate.fields.map(field => (
                <div key={field.key} className="space-y-2">
                  <Label>
                    {field.label}
                    {field.required ? ' *' : ''}
                  </Label>
                  {field.type === 'textarea' ? (
                    <>
                      <Textarea
                        required={field.required}
                        value={createFields[field.key] ?? ''}
                        onChange={e => {
                          const val = e.target.value
                          setCreateFields(prev => ({ ...prev, [field.key]: val }))
                        }}
                        rows={6}
                        className="font-mono text-xs w-full min-w-0 break-all"
                        placeholder={field.upload ? 'Paste PEM content or upload a file...' : ''}
                      />
                      {field.upload && (
                        <div className="space-y-1">
                          <input
                            type="file"
                            className="hidden"
                            id={`create-upload-${field.key}`}
                            accept=".pem,.crt,.cer,.txt"
                            onChange={e => {
                              const file = e.target.files?.[0]
                              if (file)
                                handleFileUpload(field.key, file, (k, v) =>
                                  setCreateFields(prev => ({ ...prev, [k]: v }))
                                )
                              e.target.value = ''
                            }}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              document.getElementById(`create-upload-${field.key}`)?.click()
                            }
                          >
                            Upload File
                          </Button>
                        </div>
                      )}
                    </>
                  ) : field.type === 'relation' ? (
                    <select
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={createFields[field.key] ?? ''}
                      onChange={e => {
                        const val = e.target.value
                        if (val === CREATE_SECRET_OPTION_VALUE) {
                          openQuickSecretCreate('create')
                          return
                        }
                        setCreateFields(prev => ({ ...prev, [field.key]: val }))
                      }}
                    >
                      <option value="">None</option>
                      {secrets.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                      <option value={CREATE_SECRET_OPTION_VALUE}>
                        + Create Private Key Secret
                      </option>
                    </select>
                  ) : (
                    <Input
                      type="text"
                      required={field.required}
                      value={createFields[field.key] ?? ''}
                      onChange={e => {
                        const val = e.target.value
                        setCreateFields(prev => ({ ...prev, [field.key]: val }))
                      }}
                    />
                  )}
                </div>
              ))}

            {selectedCreateTemplate?.kind === 'self_signed' && (
              <>
                <div className="space-y-2">
                  <Label>Validity (days)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={3650}
                    value={createValidityDays}
                    onChange={e =>
                      setCreateValidityDays(parseInt(e.target.value) || DEFAULT_VALIDITY_DAYS)
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    How long the certificate stays valid (1–3650 days).
                  </p>
                </div>
                <p className="text-xs text-muted-foreground bg-muted p-2 rounded">
                  ℹ A certificate and private key will be generated on the server after saving.
                </p>
              </>
            )}

            {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
            {createError && <p className="text-sm text-destructive">{createError}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createSaving || !createTemplateId}>
              {createSaving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Dialog ── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent
          className="max-w-2xl max-h-[85vh] overflow-y-auto"
          onOpenAutoFocus={e => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Edit Certificate</DialogTitle>
            <DialogDescription>{editRecord?.name}</DialogDescription>
          </DialogHeader>

          {editRecord && (
            <div className="space-y-4 py-2 min-w-0 overflow-hidden">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={editFields.name ?? ''}
                  onChange={e => setEditFields(prev => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={editFields.description ?? ''}
                  onChange={e => setEditFields(prev => ({ ...prev, description: e.target.value }))}
                  rows={3}
                />
              </div>

              {/* Read-only metadata */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-md border p-4">
                {editRecord.issuer && (
                  <div className="space-y-0.5">
                    <span className="text-muted-foreground text-xs font-medium">Issuer</span>
                    <p className="text-sm">{editRecord.issuer}</p>
                  </div>
                )}
                {editRecord.subject && (
                  <div className="space-y-0.5">
                    <span className="text-muted-foreground text-xs font-medium">Subject</span>
                    <p className="text-sm">{editRecord.subject}</p>
                  </div>
                )}
                {editRecord.expires_at && (
                  <div className="space-y-0.5">
                    <span className="text-muted-foreground text-xs font-medium">Expires At</span>
                    <p className="text-sm">{formatDate(editRecord.expires_at)}</p>
                  </div>
                )}
                <div className="space-y-0.5">
                  <span className="text-muted-foreground text-xs font-medium">Status</span>
                  <div>
                    <StatusBadge status={editRecord.status} expiresAt={editRecord.expires_at} />
                  </div>
                </div>
              </div>

              {/* CA-issued: allow cert_pem and key edits */}
              {editRecord.kind === 'ca_issued' && (
                <>
                  <div className="space-y-2 min-w-0 overflow-hidden">
                    <Label>Certificate Chain (PEM)</Label>
                    <Textarea
                      value={editFields.cert_pem ?? ''}
                      onChange={e => setEditFields(prev => ({ ...prev, cert_pem: e.target.value }))}
                      rows={8}
                      className="font-mono text-xs w-full min-w-0 break-all"
                    />
                    <div className="space-y-1">
                      <input
                        type="file"
                        className="hidden"
                        id="edit-upload-cert"
                        accept=".pem,.crt,.cer,.txt"
                        onChange={e => {
                          const file = e.target.files?.[0]
                          if (file)
                            handleFileUpload('cert_pem', file, (k, v) =>
                              setEditFields(prev => ({ ...prev, [k]: v }))
                            )
                          e.target.value = ''
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => document.getElementById('edit-upload-cert')?.click()}
                      >
                        Upload File
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Private Key Secret</Label>
                    <select
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={editFields.key ?? ''}
                      onChange={e => {
                        const val = e.target.value
                        if (val === CREATE_SECRET_OPTION_VALUE) {
                          openQuickSecretCreate('edit')
                          return
                        }
                        setEditFields(prev => ({ ...prev, key: val }))
                      }}
                    >
                      <option value="">None</option>
                      {secrets.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                      <option value={CREATE_SECRET_OPTION_VALUE}>
                        + Create Private Key Secret
                      </option>
                    </select>
                  </div>
                </>
              )}

              {/* Action buttons */}
              <div className="flex items-center gap-2">
                {editRecord.cert_pem && (
                  <Button
                    variant="outline"
                    onClick={() => downloadFile(`${editRecord.name}.crt`, editRecord.cert_pem!)}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download Certificate
                  </Button>
                )}
                {editRecord.kind === 'self_signed' && editRecord.cert_pem && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditOpen(false)
                      openRenew(editRecord)
                    }}
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Renew Certificate
                  </Button>
                )}
              </div>

              {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
              {editError && <p className="text-sm text-destructive">{editError}</p>}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEditSave} disabled={editSaving}>
              {editSaving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Quick Create Private Key Secret ── */}
      <Dialog open={quickSecretOpen} onOpenChange={setQuickSecretOpen}>
        <DialogContent className="max-w-lg" onOpenAutoFocus={e => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Create Private Key Secret</DialogTitle>
            <DialogDescription>
              Create a TLS private key secret without leaving the certificate form.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={quickSecretName}
                onChange={e => setQuickSecretName(e.target.value)}
                placeholder="e.g. my-cert-key"
              />
            </div>
            <div className="space-y-2">
              <Label>Private Key (PEM)</Label>
              <Textarea
                rows={8}
                className="font-mono text-xs"
                value={quickSecretPrivateKey}
                onChange={e => setQuickSecretPrivateKey(e.target.value)}
                placeholder="-----BEGIN PRIVATE KEY-----"
              />
            </div>
            {quickSecretError && <p className="text-sm text-destructive">{quickSecretError}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setQuickSecretOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleQuickSecretCreate}
              disabled={
                quickSecretSaving ||
                quickSecretName.trim() === '' ||
                quickSecretPrivateKey.trim() === ''
              }
            >
              {quickSecretSaving ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Renew Dialog ── */}
      <Dialog
        open={!!renewTarget}
        onOpenChange={open => {
          if (!open) setRenewTarget(null)
        }}
      >
        <DialogContent className="max-w-sm" onOpenAutoFocus={e => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Renew Certificate</DialogTitle>
            <DialogDescription>
              Generate a new self-signed certificate for <strong>{renewTarget?.name}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Validity (days)</Label>
              <Input
                type="number"
                min={1}
                max={3650}
                value={renewDays}
                onChange={e => setRenewDays(parseInt(e.target.value) || DEFAULT_VALIDITY_DAYS)}
              />
              <p className="text-xs text-muted-foreground">
                How long the renewed certificate stays valid (1–3650 days).
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenewTarget(null)}>
              Cancel
            </Button>
            <Button onClick={handleRenew} disabled={renewing}>
              {renewing ? 'Renewing…' : 'Renew'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation ── */}
      <AlertDialog
        open={!!deleteAction}
        onOpenChange={open => {
          if (!open) setDeleteAction(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Certificate</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteAction?.name}</strong>? This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export const Route = createFileRoute('/_app/_auth/certificates')({
  component: CertificatesPage,
})
