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
import type { OperationRecord } from '@/pages/deploy/operations/operation-types'

type DeleteOperationDialogProps = {
  operations: OperationRecord[]
  onOpenChange: (open: boolean) => void
  onConfirm: (operations: OperationRecord[]) => void
}

export function DeleteOperationDialog({ operations, onOpenChange, onConfirm }: DeleteOperationDialogProps) {
  const singleOperation = operations.length === 1 ? operations[0] : null
  return (
    <AlertDialog open={operations.length > 0} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{operations.length > 1 ? 'Delete Actions' : 'Delete Action'}</AlertDialogTitle>
          <AlertDialogDescription>
            {operations.length > 1
              ? `Delete ${operations.length} selected actions? This removes their action records from history.`
              : singleOperation
                ? `Delete ${singleOperation.compose_project_name || singleOperation.id}? This removes the action record from history.`
                : 'Delete this action record?'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              if (operations.length > 0) onConfirm(operations)
            }}
          >
            {operations.length > 1 ? `Delete ${operations.length}` : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}