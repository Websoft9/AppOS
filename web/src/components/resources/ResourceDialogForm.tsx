import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ResourceFormField } from './ResourceFormField'
import type { FieldDef, RelationOption } from './resource-page-types'

type ResourceDialogFormProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  className?: string
  title: ReactNode
  description?: ReactNode
  formData: Record<string, unknown>
  editingItem: Record<string, unknown> | null
  headerFields: FieldDef[]
  primaryFields: FieldDef[]
  advancedFields: FieldDef[]
  relationOptions: Record<string, RelationOption[]>
  updateField: (key: string, value: unknown) => void
  handleChange: (field: FieldDef, raw: unknown) => void
  addRelationOption: (
    fieldKey: string,
    id: string,
    label: string,
    raw?: Record<string, unknown>
  ) => void
  openRelationCreate: (field: FieldDef) => void
  handleFileUpload: (key: string, e: ChangeEvent<HTMLInputElement>) => void
  fileInputRef: (key: string, element: HTMLInputElement | null) => void
  selectedSummary?: ReactNode
  error?: string
  saving?: boolean
  submitLabel: string
  cancelLabel?: string
  resetAction?: { label: string; onClick: () => void }
  onCancel?: () => void
  dialogExtra?: ReactNode
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

export function ResourceDialogForm({
  open,
  onOpenChange,
  className,
  title,
  description,
  formData,
  editingItem,
  headerFields,
  primaryFields,
  advancedFields,
  relationOptions,
  updateField,
  handleChange,
  addRelationOption,
  openRelationCreate,
  handleFileUpload,
  fileInputRef,
  selectedSummary,
  error,
  saving,
  submitLabel,
  cancelLabel = 'Cancel',
  resetAction,
  onCancel,
  dialogExtra,
  onSubmit,
}: ResourceDialogFormProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false)

  useEffect(() => {
    if (!open) {
      setAdvancedOpen(false)
    }
  }, [open])

  const renderField = (field: FieldDef) => (
    <ResourceFormField
      key={field.key}
      field={field}
      formData={formData}
      editingItem={editingItem}
      relationOptions={relationOptions[field.key] ?? []}
      updateField={updateField}
      handleChange={handleChange}
      addRelationOption={(id, label, raw) => addRelationOption(field.key, id, label, raw)}
      openRelationCreate={openRelationCreate}
      handleFileUpload={handleFileUpload}
      fileInputRef={fileInputRef}
    />
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${className ?? 'sm:max-w-lg'} max-h-[85vh] overflow-y-auto`}>
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
            {headerFields.length > 0 ? (
              <div className="mt-4 grid gap-3">{headerFields.map(renderField)}</div>
            ) : null}
          </DialogHeader>

          {selectedSummary ?? null}

          {primaryFields.map(renderField)}

          {advancedFields.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-border/70 bg-card/80 shadow-sm">
              <button
                type="button"
                className={`flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-muted/40 ${advancedOpen ? 'border-b border-border/70 bg-muted/20' : 'bg-muted/10'}`}
                onClick={() => setAdvancedOpen(prev => !prev)}
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">Advanced</div>
                  <div className="text-xs text-muted-foreground">
                    Optional overrides and operational settings.
                  </div>
                </div>
                <div className="inline-flex items-center gap-3">
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {advancedFields.length}
                  </span>
                {advancedOpen ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
                </div>
              </button>

              {advancedOpen ? (
                <div className="space-y-4 bg-background px-4 py-4">
                  {advancedFields.map(renderField)}
                </div>
              ) : null}
            </div>
          )}

          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          {dialogExtra ?? null}

          <DialogFooter>
            {resetAction ? (
              <Button type="button" variant="outline" onClick={resetAction.onClick}>
                {resetAction.label}
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => (onCancel ? onCancel() : onOpenChange(false))}
              >
                {cancelLabel}
              </Button>
            )}
            <Button type="submit" disabled={saving}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
