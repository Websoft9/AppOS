import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { ReferenceSelect } from '@/components/resources/ReferenceSelect'
import type { RelationOption } from '@/components/resources/resource-page-types'
import { PasswordGeneratorDialog } from './PasswordGeneratorDialog'

function buildRandomPassword(length: number) {
  const normalizedLength = Math.min(Math.max(length, 12), 64)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()-_=+'
  const cryptoObject = globalThis.crypto
  if (cryptoObject?.getRandomValues) {
    const bytes = new Uint32Array(normalizedLength)
    cryptoObject.getRandomValues(bytes)
    return Array.from(bytes, value => alphabet[value % alphabet.length]).join('')
  }
  return Array.from(
    { length: normalizedLength },
    () => alphabet[Math.floor(Math.random() * alphabet.length)]
  ).join('')
}

interface SecretCredentialFieldProps {
  inputId: string
  manualValue: string
  onManualValueChange: (value: string) => void
  useReference: boolean
  onUseReferenceChange: (checked: boolean) => void
  referenceValue: string
  onReferenceValueChange: (value: string) => void
  options: RelationOption[]
  onCreateReference?: () => void
}

export function SecretCredentialField({
  inputId,
  manualValue,
  onManualValueChange,
  useReference,
  onUseReferenceChange,
  referenceValue,
  onReferenceValueChange,
  options,
  onCreateReference,
}: SecretCredentialFieldProps) {
  const [generatorOpen, setGeneratorOpen] = useState(false)
  const [length, setLength] = useState(24)

  return (
    <div className="space-y-3">
      {!useReference ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-muted/30 p-3">
          <Input
            id={inputId}
            type="password"
            value={manualValue}
            onChange={event => onManualValueChange(event.target.value)}
            placeholder="Enter a password"
            className="min-w-[220px] flex-1 bg-background"
          />
          <Button type="button" variant="outline" size="sm" onClick={() => setGeneratorOpen(true)}>
            Generate
          </Button>
          <label className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm">
            <Checkbox
              checked={useReference}
              onCheckedChange={checked => onUseReferenceChange(Boolean(checked))}
            />
            <span>Select a Secret</span>
          </label>
        </div>
      ) : (
        <div className="space-y-2 rounded-xl border border-border/70 bg-muted/30 p-3">
          <label className="inline-flex w-fit items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm">
            <Checkbox
              checked={useReference}
              onCheckedChange={checked => onUseReferenceChange(Boolean(checked))}
            />
            <span>Select a Secret</span>
          </label>
          <ReferenceSelect
            id={`${inputId}-reference`}
            value={referenceValue}
            options={options}
            onSelect={onReferenceValueChange}
            placeholder="Select a Secret"
            searchPlaceholder="Search secrets..."
            emptyMessage="No matching secrets."
            createLabel={onCreateReference ? 'New Secret' : undefined}
            onCreate={onCreateReference}
            autoOpen
          />
        </div>
      )}

      <PasswordGeneratorDialog
        open={generatorOpen}
        onOpenChange={setGeneratorOpen}
        length={length}
        onLengthChange={setLength}
        onConfirm={() => onManualValueChange(buildRandomPassword(length))}
      />
    </div>
  )
}
