import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
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
  onEditReference?: (value: string) => void
  editMode?: boolean
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
  onEditReference,
  editMode = false,
}: SecretCredentialFieldProps) {
  const [generatorOpen, setGeneratorOpen] = useState(false)
  const [length, setLength] = useState(24)
  const [revealed, setRevealed] = useState(false)
  const showReferencePicker = editMode || useReference

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-3 rounded-xl border border-border/70 bg-muted/30 p-3">
        <div className="min-w-[220px] flex-1">
          {showReferencePicker ? (
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-[220px] flex-1">
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
                  autoOpen={!editMode}
                  showNoneOption={false}
                  showSelectedIndicator={false}
                  borderlessMenu
                />
              </div>
              {referenceValue && onEditReference && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-10"
                  onClick={() => onEditReference(referenceValue)}
                >
                  Edit Secret
                </Button>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-[220px] flex-1">
                <Input
                  id={inputId}
                  type={revealed ? 'text' : 'password'}
                  value={manualValue}
                  onChange={event => onManualValueChange(event.target.value)}
                  placeholder="Enter a password"
                  className="bg-background pr-10"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                  title={revealed ? 'Hide password' : 'Show password'}
                  onClick={() => setRevealed(prev => !prev)}
                >
                  {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button type="button" className="h-10" onClick={() => setGeneratorOpen(true)}>
                Generate
              </Button>
            </div>
          )}
        </div>
        {!editMode && (
          <label className="inline-flex h-10 shrink-0 items-center gap-2 self-start pt-0.5 text-sm">
            <Checkbox
              checked={useReference}
              onCheckedChange={checked => {
                const nextValue = Boolean(checked)
                if (nextValue) {
                  setRevealed(false)
                }
                onUseReferenceChange(nextValue)
              }}
            />
            <span>Select a Secret</span>
          </label>
        )}
      </div>

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
