import { useState, useMemo, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Layers, PlusCircle, AlertTriangle, Search, Upload, X, File as FileIcon, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { AppIcon } from './AppIcon'
import type { Product } from '@/lib/store-types'
import type { CustomApp, CustomAppFormData } from '@/lib/store-custom-api'
import { iacLoadLibraryAppFiles } from '@/lib/iac-api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CustomAppDialogProps {
  open: boolean
  onClose: () => void
  onSave: (data: CustomAppFormData) => void
  isSaving?: boolean
  editApp?: CustomApp
  allProducts?: Product[]
  existingCustomKeys?: string[]
}

type Mode = 'select' | 'pick-app' | 'form'
type FormOrigin = 'scratch' | 'based-on' | 'edit'

const PAGE_SIZE = 20

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// ─── File upload button ───────────────────────────────────────────────────────

interface FileUploadButtonProps {
  accept?: string
  label: string
  onContent: (content: string) => void
}

function FileUploadButton({ accept = '*', label, onContent }: FileUploadButtonProps) {
  const ref = useRef<HTMLInputElement>(null)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => onContent(reader.result as string)
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <>
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={handleChange} />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-6 gap-1 text-xs px-2"
        onClick={() => ref.current?.click()}
      >
        <Upload className="h-3 w-3" />
        {label}
      </Button>
    </>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CustomAppDialog({
  open,
  onClose,
  onSave,
  isSaving,
  editApp,
  allProducts = [],
  existingCustomKeys = [],
}: CustomAppDialogProps) {
  const { t } = useTranslation('store')

  const [mode, setMode] = useState<Mode>(editApp ? 'form' : 'select')
  const [formOrigin, setFormOrigin] = useState<FormOrigin>(editApp ? 'edit' : 'scratch')
  const [basedOnSourceKey, setBasedOnSourceKey] = useState<string | null>(null)
  const [loadingLibrary, setLoadingLibrary] = useState(false)
  const [pickSearch, setPickSearch] = useState('')
  const [pickPage, setPickPage] = useState(1)
  const [keyManual, setKeyManual] = useState(!!editApp)

  const [form, setForm] = useState<CustomAppFormData>({
    key: editApp?.key ?? '',
    trademark: editApp?.trademark ?? '',
    logo_url: editApp?.logo_url ?? '',
    overview: editApp?.overview ?? '',
    description: editApp?.description ?? '',
    category_keys: editApp?.category_keys ?? [],
    compose_yaml: editApp?.compose_yaml ?? '',
    env_text: editApp?.env_text ?? '',
    visibility: editApp?.visibility ?? 'private',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Extra files to upload to templates/{key}/ via IAC
  const [extraFiles, setExtraFiles] = useState<File[]>([])
  const extraFilesRef = useRef<HTMLInputElement>(null)

  const setField = <K extends keyof CustomAppFormData>(k: K, v: CustomAppFormData[K]) => {
    setForm((f) => {
      const next = { ...f, [k]: v }
      if (k === 'trademark' && !keyManual) {
        next.key = slugify(v as string)
      }
      return next
    })
    setErrors((e) => ({ ...e, [k]: '' }))
  }

  // ─── Pick-app filtering ──────────────────────────────────────────────────

  const filteredProducts = useMemo(() => {
    if (!pickSearch.trim()) return allProducts
    const q = pickSearch.toLowerCase()
    return allProducts.filter(
      (p) =>
        p.trademark.toLowerCase().includes(q) ||
        p.key.toLowerCase().includes(q) ||
        (p.summary ?? '').toLowerCase().includes(q),
    )
  }, [allProducts, pickSearch])

  const displayedProducts = filteredProducts.slice(0, pickPage * PAGE_SIZE)
  const hasMore = displayedProducts.length < filteredProducts.length

  const listRef = useRef<HTMLDivElement>(null)

  const handleScroll = useCallback(() => {
    const el = listRef.current
    if (!el || !hasMore) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
      setPickPage((p) => p + 1)
    }
  }, [hasMore])

  const selectTemplate = async (product: Product) => {
    setForm({
      key: '',
      trademark: product.trademark,
      logo_url: product.logo?.imageurl ?? '',
      overview: product.summary ?? product.overview ?? '',
      description: '',
      category_keys: product.catalogCollection?.items.map((i) => i.key) ?? [],
      compose_yaml: '',
      env_text: '',
      visibility: 'private',
    })
    setKeyManual(false)
    setFormOrigin('based-on')
    setBasedOnSourceKey(product.key)
    setMode('form')

    // Load library compose/.env in background
    setLoadingLibrary(true)
    try {
      const { compose, env } = await iacLoadLibraryAppFiles(product.key)
      setForm((f) => ({
        ...f,
        compose_yaml: compose ?? f.compose_yaml,
        env_text: env ?? f.env_text,
      }))
    } catch {
      // library files not found — keep form empty
    } finally {
      setLoadingLibrary(false)
    }
  }

  // ─── Validation ──────────────────────────────────────────────────────────

  const validate = (): boolean => {
    const e: Record<string, string> = {}
    if (!form.trademark.trim()) e.trademark = t('customApp.fieldRequired')
    if (!form.overview.trim()) e.overview = t('customApp.fieldRequired')
    if (!form.key.trim()) e.key = t('customApp.fieldRequired')

    const conflictsOfficial = allProducts.some((p) => p.key === form.key)
    const conflictsCustom = existingCustomKeys.includes(form.key) && form.key !== editApp?.key
    if (conflictsOfficial || conflictsCustom) e.key = t('customApp.keyConflict')

    setErrors(e)
    return Object.keys(e).length === 0
  }

  // ─── Extra files handlers ──────────────────────────────────────────────────

  const handleExtraFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    setExtraFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name))
      return [...prev, ...files.filter((f) => !existing.has(f.name))]
    })
    e.target.value = ''
  }

  const removeExtraFile = (name: string) => {
    setExtraFiles((prev) => prev.filter((f) => f.name !== name))
  }

  const handleSave = () => {
    if (!validate()) return
    onSave({
      ...form,
      extraFiles: extraFiles.length > 0 ? extraFiles : undefined,
      basedOnKey: formOrigin === 'based-on' && basedOnSourceKey ? basedOnSourceKey : undefined,
    })
  }

  const handleClose = () => {
    setMode(editApp ? 'form' : 'select')
    setPickSearch('')
    setPickPage(1)
    setErrors({})
    setExtraFiles([])
    setBasedOnSourceKey(null)
    onClose()
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {editApp ? t('customApp.titleEdit') : t('customApp.titleAdd')}
          </DialogTitle>
        </DialogHeader>

        {/* ── Mode selection ── */}
        {mode === 'select' && (
          <div className="grid grid-cols-2 gap-3 mt-2">
            <button
              className="flex flex-col items-center gap-2 border rounded-lg p-4 hover:border-primary hover:bg-muted/50 transition-colors text-center"
              onClick={() => { setPickSearch(''); setPickPage(1); setMode('pick-app') }}
            >
              <Layers className="h-6 w-6 text-muted-foreground" />
              <span className="text-sm font-medium">{t('customApp.basedOn')}</span>
              <span className="text-xs text-muted-foreground">{t('customApp.basedOnDesc')}</span>
            </button>
            <button
              className="flex flex-col items-center gap-2 border rounded-lg p-4 hover:border-primary hover:bg-muted/50 transition-colors text-center"
              onClick={() => {
                setForm({ key: '', trademark: '', logo_url: '', overview: '', description: '', category_keys: [], compose_yaml: '', env_text: '', visibility: 'private' })
                setKeyManual(false)
                setFormOrigin('scratch')
                setMode('form')
              }}
            >
              <PlusCircle className="h-6 w-6 text-muted-foreground" />
              <span className="text-sm font-medium">{t('customApp.fromScratch')}</span>
              <span className="text-xs text-muted-foreground">{t('customApp.fromScratchDesc')}</span>
            </button>
          </div>
        )}

        {/* ── App picker ── */}
        {mode === 'pick-app' && (
          <div className="flex flex-col gap-3 mt-2 min-h-0 flex-1">
            {/* Search */}
            <div className="relative shrink-0">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('search.placeholder')}
                value={pickSearch}
                onChange={(e) => { setPickSearch(e.target.value); setPickPage(1) }}
                className="pl-8"
                autoFocus
              />
            </div>

            {/* Scrollable list */}
            <div
              ref={listRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto divide-y min-h-0 rounded-md border"
            >
              {displayedProducts.map((p) => (
                <button
                  key={p.key}
                  className="flex items-center gap-3 w-full px-3 py-2.5 hover:bg-muted/50 transition-colors text-left"
                  onClick={() => selectTemplate(p)}
                >
                  <div className="shrink-0">
                    <AppIcon appKey={p.key} trademark={p.trademark} logoUrl={p.logo?.imageurl} size="sm" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{p.trademark}</p>
                    <p className="text-xs text-muted-foreground line-clamp-1">{p.summary ?? p.overview}</p>
                  </div>
                </button>
              ))}
              {hasMore && (
                <div className="flex justify-center py-3">
                  <Button variant="ghost" size="sm" onClick={() => setPickPage((p) => p + 1)}>
                    {t('customApp.loadMore')}
                  </Button>
                </div>
              )}
              {filteredProducts.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">{t('search.noResults')}</p>
              )}
            </div>

            <Button variant="outline" size="sm" className="shrink-0" onClick={() => setMode('select')}>
              {t('customApp.back')}
            </Button>
          </div>
        )}

        {/* ── Form ── */}
        {mode === 'form' && (
          <div className="flex flex-col gap-3 mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
            {/* Trademark */}
            <div>
              <label className="text-xs font-medium">{t('customApp.trademark')} *</label>
              <Input
                value={form.trademark}
                onChange={(e) => setField('trademark', e.target.value)}
                placeholder={t('customApp.trademarkPlaceholder')}
              />
              {errors.trademark && <p className="text-xs text-destructive mt-1">{errors.trademark}</p>}
            </div>

            {/* Key */}
            <div>
              <label className="text-xs font-medium">{t('customApp.key')} *</label>
              <Input
                value={form.key}
                onChange={(e) => { setKeyManual(true); setField('key', e.target.value) }}
                placeholder="my-app"
              />
              {errors.key && <p className="text-xs text-destructive mt-1">{errors.key}</p>}
            </div>

            {/* Overview */}
            <div>
              <label className="text-xs font-medium">{t('customApp.overview')} *</label>
              <Input
                value={form.overview}
                onChange={(e) => setField('overview', e.target.value)}
                placeholder={t('customApp.overviewPlaceholder')}
              />
              {errors.overview && <p className="text-xs text-destructive mt-1">{errors.overview}</p>}
            </div>

            {/* Logo URL */}
            <div>
              <label className="text-xs font-medium">{t('customApp.logoUrl')}</label>
              <Input
                value={form.logo_url}
                onChange={(e) => setField('logo_url', e.target.value)}
                placeholder="https://..."
              />
            </div>

            {/* --- Advanced fields: always shown --- */}
            <Separator />

            {/* docker-compose.yml */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium">{t('customApp.compose')}</label>
                  {loadingLibrary && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                  {formOrigin === 'based-on' && !loadingLibrary && form.compose_yaml && (
                    <span className="text-xs text-muted-foreground">({t('customApp.defaultFromLibrary')})</span>
                  )}
                </div>
                <FileUploadButton
                  accept=".yml,.yaml,.txt"
                  label={t('customApp.uploadFile')}
                  onContent={(content) => setField('compose_yaml', content)}
                />
              </div>
              <Textarea
                value={form.compose_yaml}
                onChange={(e) => setField('compose_yaml', e.target.value)}
                className="font-mono text-xs min-h-[120px] resize-y"
                spellCheck={false}
                placeholder={'services:\n  app:\n    image: your-image:latest\n    ports:\n      - "8080:8080"'}
                disabled={loadingLibrary}
              />
            </div>

            {/* .env */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium">{t('customApp.envText')}</label>
                  {formOrigin === 'based-on' && !loadingLibrary && form.env_text && (
                    <span className="text-xs text-muted-foreground">({t('customApp.defaultFromLibrary')})</span>
                  )}
                </div>
                <FileUploadButton
                  accept=".env,.txt"
                  label={t('customApp.uploadFile')}
                  onContent={(content) => setField('env_text', content)}
                />
              </div>
              <p className="text-xs text-muted-foreground mb-1">{t('customApp.envTextDesc')}</p>
              <Textarea
                value={form.env_text}
                onChange={(e) => setField('env_text', e.target.value)}
                className="font-mono text-xs min-h-[80px] resize-y"
                spellCheck={false}
                placeholder={'APP_KEY=value\nDB_PASSWORD=secret'}
                disabled={loadingLibrary}
              />
            </div>

            {/* Extra files upload */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <div>
                  <label className="text-xs font-medium">{t('customApp.extraFiles')}</label>
                  <p className="text-xs text-muted-foreground">{t('customApp.extraFilesDesc')}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 gap-1 text-xs px-2 shrink-0 ml-2"
                  onClick={() => extraFilesRef.current?.click()}
                >
                  <Upload className="h-3 w-3" />
                  {t('customApp.addFiles')}
                </Button>
              </div>
              <input
                ref={extraFilesRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleExtraFilesChange}
              />
              {extraFiles.length > 0 && (
                <div className="border rounded-md divide-y mt-1">
                  {extraFiles.map((file) => (
                    <div key={file.name} className="flex items-center justify-between px-3 py-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-xs truncate">{file.name}</span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {(file.size / 1024).toFixed(1)} KB
                        </span>
                      </div>
                      <button
                        type="button"
                        className="shrink-0 ml-2 text-muted-foreground hover:text-destructive"
                        onClick={() => removeExtraFile(file.name)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Description — shown only when editing (advanced Markdown field) */}
            {editApp && (
              <>
                <Separator />
                <div>
                  <label className="text-xs font-medium">{t('customApp.description')}</label>
                  <Textarea
                    value={form.description}
                    onChange={(e) => setField('description', e.target.value)}
                    placeholder={t('customApp.descriptionPlaceholder')}
                    className="text-xs min-h-[60px] resize-y"
                  />
                </div>
              </>
            )}

            <Separator />

            {/* Visibility */}
            <div className="space-y-2">
              <label className="text-xs font-medium">{t('customApp.visibility')}</label>
              <div className="flex gap-4">
                {(['private', 'shared'] as const).map((v) => (
                  <label key={v} className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="radio"
                      name="visibility"
                      value={v}
                      checked={form.visibility === v}
                      onChange={() => setField('visibility', v)}
                      className="accent-primary"
                    />
                    {t(`customApp.${v}`)}
                  </label>
                ))}
              </div>
              {form.visibility === 'shared' && (
                <div className="flex items-start gap-2 text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/20 dark:text-amber-400 rounded-md px-3 py-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>{t('customApp.sharedWarning')}</span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2 justify-between pt-1 shrink-0">
              {!editApp && (
                <Button variant="outline" size="sm" onClick={() => setMode('select')}>
                  {t('customApp.back')}
                </Button>
              )}
              <div className="flex gap-2 ml-auto">
                <Button variant="ghost" size="sm" onClick={handleClose} disabled={isSaving}>
                  {t('note.cancel')}
                </Button>
                <Button size="sm" onClick={handleSave} disabled={isSaving}>
                  {t('note.save')}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
