import type { ChangeEvent } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ReferenceSelect } from './ReferenceSelect'
import type { FieldDef, RelationOption, SelectOption } from './resource-page-types'

const INPUT_CLASS =
  'w-full px-3 py-2 bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-foreground text-sm'

function renderSelectOptions(options: SelectOption[] | undefined) {
  if (!options || options.length === 0) {
    return null
  }

  const hasGroups = options.some(option => option.group)
  if (!hasGroups) {
    return options.map(option => (
      <option key={option.value} value={option.value}>
        {option.label}
      </option>
    ))
  }

  const groups: { group: string; options: SelectOption[] }[] = []
  for (const option of options) {
    const groupName = option.group ?? 'Other'
    const existing = groups.find(group => group.group === groupName)
    if (existing) {
      existing.options.push(option)
      continue
    }
    groups.push({ group: groupName, options: [option] })
  }

  return groups.map(group => (
    <optgroup key={group.group} label={group.group}>
      {group.options.map(option => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </optgroup>
  ))
}

interface ResourceFormFieldProps {
  field: FieldDef
  formData: Record<string, unknown>
  editingItem: Record<string, unknown> | null
  relationOptions: RelationOption[]
  updateField: (key: string, value: unknown) => void
  handleChange: (field: FieldDef, raw: unknown) => void
  addRelationOption: (id: string, label: string, raw?: Record<string, unknown>) => void
  openRelationCreate: (field: FieldDef) => void
  handleFileUpload: (key: string, e: ChangeEvent<HTMLInputElement>) => void
  fileInputRef: (key: string, element: HTMLInputElement | null) => void
}

export function ResourceFormField({
  field,
  formData,
  editingItem,
  relationOptions,
  updateField,
  handleChange,
  addRelationOption,
  openRelationCreate,
  handleFileUpload,
  fileInputRef,
}: ResourceFormFieldProps) {
  const inputId = `resource-field-${field.key}`
  const effectiveType = field.dynamicType
    ? field.dynamicType.values.includes(String(formData[field.dynamicType.field] ?? ''))
      ? field.dynamicType.as
      : field.type
    : field.type
  const isUploadable = effectiveType === 'file-textarea' || !!field.fileAccept
  const renderLabel = effectiveType !== 'boolean'

  return (
    <div key={field.key} className="space-y-1.5">
      {renderLabel && (
        <label htmlFor={inputId} className="text-sm font-medium text-foreground">
          {field.label}
          {field.required && <span className="text-destructive ml-1">*</span>}
        </label>
      )}

      {field.render ? (
        field.render({
          field,
          inputId,
          value: formData[field.key],
          formData,
          editingItem,
          updateField,
          setValue: value => handleChange(field, value),
          relationOptions,
          addRelationOption,
          openRelationCreate: () => openRelationCreate(field),
        })
      ) : effectiveType === 'select' ? (
        <select
          id={inputId}
          className={INPUT_CLASS}
          value={String(formData[field.key] ?? '')}
          onChange={e => handleChange(field, e.target.value)}
          required={field.required}
        >
          <option value="">Select…</option>
          {renderSelectOptions(field.options)}
        </select>
      ) : effectiveType === 'relation' && field.multiSelect ? (
        <div className="border border-input rounded-md p-2 max-h-44 overflow-y-auto space-y-1 bg-background">
          {relationOptions.length === 0 ? (
            <p className="text-xs text-muted-foreground px-1">No options available</p>
          ) : (
            relationOptions.map(option => {
              const selected = ((formData[field.key] as string[]) ?? []).includes(option.id)
              return (
                <label
                  key={option.id}
                  className="flex items-center gap-2 cursor-pointer px-1 py-0.5 rounded hover:bg-muted transition-colors"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-input"
                    checked={selected}
                    onChange={event => {
                      const current = (formData[field.key] as string[]) ?? []
                      if (event.target.checked) {
                        updateField(field.key, [...current, option.id])
                        return
                      }
                      updateField(
                        field.key,
                        current.filter(id => id !== option.id)
                      )
                    }}
                  />
                  <span className="text-sm">{option.label}</span>
                </label>
              )
            })
          )}
        </div>
      ) : effectiveType === 'relation' ? (
        <ReferenceSelect
          id={inputId}
          value={String(formData[field.key] ?? '')}
          options={relationOptions}
          onSelect={value => handleChange(field, value)}
          placeholder={field.placeholder ?? 'Select a reference'}
          searchPlaceholder={`Search ${field.label.toLowerCase()}...`}
          emptyMessage="No matching references."
          createLabel={field.relationCreateButton?.label ?? field.relationCreate?.label}
          editLabel={field.relationEditButton?.label}
          showNoneOption={field.relationShowNoneOption ?? !field.required}
          showSelectedIndicator={field.relationShowSelectedIndicator ?? true}
          borderlessMenu={field.relationBorderlessMenu ?? false}
          onEditSelected={
            field.relationEditButton
              ? value => field.relationEditButton?.onClick(value)
              : undefined
          }
          onCreate={
            field.relationCreateButton
              ? () => {
                  const fieldKey = field.key
                  field.relationCreateButton?.onClick({
                    addOption: (id: string, label: string) => {
                      addRelationOption(id, label)
                      updateField(fieldKey, id)
                    },
                  })
                }
              : field.relationCreate
                ? () => openRelationCreate(field)
                : undefined
          }
        />
      ) : effectiveType === 'textarea' || effectiveType === 'file-textarea' ? (
        <div className="space-y-1">
          <textarea
            id={inputId}
            className={INPUT_CLASS + ' min-h-[120px] resize-y font-mono text-xs'}
            value={String(formData[field.key] ?? '')}
            onChange={e => updateField(field.key, e.target.value)}
            placeholder={field.placeholder}
            required={field.required}
            rows={5}
          />
        </div>
      ) : effectiveType === 'boolean' ? (
        <label
          htmlFor={inputId}
          className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm cursor-pointer"
        >
          <input
            id={inputId}
            type="checkbox"
            className="h-4 w-4 rounded border-input"
            checked={Boolean(formData[field.key])}
            onChange={e => updateField(field.key, e.target.checked)}
          />
          <span className="text-foreground">{field.label}</span>
        </label>
      ) : (
        <input
          id={inputId}
          type={
            effectiveType === 'password'
              ? 'password'
              : effectiveType === 'number'
                ? 'number'
                : 'text'
          }
          className={INPUT_CLASS}
          value={String(formData[field.key] ?? '')}
          onChange={e => handleChange(field, e.target.value)}
          placeholder={field.placeholder}
          required={field.required}
          readOnly={field.readOnly}
        />
      )}

      {(effectiveType === 'textarea' || effectiveType === 'file-textarea') && isUploadable && (
        <input
          id={`resource-file-${field.key}`}
          ref={element => fileInputRef(field.key, element)}
          type="file"
          accept={field.fileAccept ?? '.pem,.key,.crt,.txt'}
          className="hidden"
          onChange={e => handleFileUpload(field.key, e)}
        />
      )}

      {(effectiveType === 'textarea' || effectiveType === 'file-textarea') && isUploadable && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const element = document.getElementById(
              `resource-file-${field.key}`
            ) as HTMLInputElement | null
            element?.click()
          }}
        >
          <Upload className="h-3 w-3 mr-1" />
          Upload file
        </Button>
      )}

      {field.helpText && <p className="text-xs text-muted-foreground">{field.helpText}</p>}
    </div>
  )
}
