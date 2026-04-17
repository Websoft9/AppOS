import { WandSparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'

interface PasswordGeneratorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  length: number
  onLengthChange: (length: number) => void
  onConfirm: () => void
  title?: string
  description?: string
  lengthLabel?: string
  confirmLabel?: string
}

export function PasswordGeneratorDialog({
  open,
  onOpenChange,
  length,
  onLengthChange,
  onConfirm,
  title = 'Generate Password',
  description = 'Choose the password length before filling the field.',
  lengthLabel = 'Password Length',
  confirmLabel = 'Fill Password',
}: PasswordGeneratorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="generated-password-length">{lengthLabel}</Label>
          <select
            id="generated-password-length"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={String(length)}
            onChange={event => onLengthChange(Number(event.target.value))}
          >
            {[16, 24, 32, 48].map(option => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              onConfirm()
              onOpenChange(false)
            }}
          >
            <WandSparkles className="mr-1.5 h-4 w-4" />
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
