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
import type { DeploymentRecord } from '@/pages/deploy/deploy-types'

type DeleteDeploymentDialogProps = {
  deployments: DeploymentRecord[]
  onOpenChange: (open: boolean) => void
  onConfirm: (deployments: DeploymentRecord[]) => void
}

export function DeleteDeploymentDialog({ deployments, onOpenChange, onConfirm }: DeleteDeploymentDialogProps) {
  const singleDeployment = deployments.length === 1 ? deployments[0] : null
  return (
    <AlertDialog open={deployments.length > 0} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{deployments.length > 1 ? 'Delete Deployments' : 'Delete Deployment'}</AlertDialogTitle>
          <AlertDialogDescription>
            {deployments.length > 1
              ? `Delete ${deployments.length} selected deployments? This removes their deployment records from history.`
              : singleDeployment
                ? `Delete ${singleDeployment.compose_project_name || singleDeployment.id}? This removes the deployment record from history.`
                : 'Delete this deployment record?'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              if (deployments.length > 0) onConfirm(deployments)
            }}
          >
            {deployments.length > 1 ? `Delete ${deployments.length}` : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}