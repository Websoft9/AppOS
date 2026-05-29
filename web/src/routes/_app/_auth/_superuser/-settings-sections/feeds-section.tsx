import { Loader2, Minus, Plus, Trash2 } from 'lucide-react'
import { type SettingsSchemaEntry } from '@/lib/settings-api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { SaveButton } from './shared'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { FeedsPolicyGroup } from './feeds-types'

export function FeedsPolicySection({
  entry: _entry,
  form,
  errors,
  saving,
  setForm,
  save,
  deleteDialogOpen,
  deleteLoading,
  deleteExecuting,
  deleteCount,
  deleteMaxCount,
  openDeleteDialog,
  closeDeleteDialog,
  setDeleteCount,
  executeDelete,
}: {
  entry: SettingsSchemaEntry
  form: FeedsPolicyGroup
  errors: Partial<Record<keyof FeedsPolicyGroup, string>>
  saving: boolean
  setForm: React.Dispatch<React.SetStateAction<FeedsPolicyGroup>>
  save: () => void
  deleteDialogOpen: boolean
  deleteLoading: boolean
  deleteExecuting: boolean
  deleteCount: number
  deleteMaxCount: number
  openDeleteDialog: () => Promise<void>
  closeDeleteDialog: () => void
  setDeleteCount: (value: number) => void
  executeDelete: () => Promise<void>
}) {
  const backoffMax = form.failureBackoffMaxHours
  const tier1 = Math.max(1, Math.floor(backoffMax / 12))
  const tier2 = Math.max(1, Math.floor(backoffMax / 4))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Feeds</CardTitle>
        <CardDescription>
          Control feed polling cadence, failure backoff, and article retention limits.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="pollIntervalHours">Poll Interval (hours)</Label>
            <Input
              id="pollIntervalHours"
              type="number"
              min={1}
              max={240}
              value={form.pollIntervalHours}
              onChange={e => setForm(c => ({ ...c, pollIntervalHours: Number(e.target.value) }))}
            />
            <p className="text-xs text-muted-foreground">1 - 240 hours</p>
            {errors.pollIntervalHours ? (
              <p className="text-xs text-destructive">{errors.pollIntervalHours}</p>
            ) : null}
          </div>

          <div className="space-y-1">
            <Label htmlFor="failureBackoffMaxHours">Failure Backoff (hours)</Label>
            <Input
              id="failureBackoffMaxHours"
              type="number"
              min={4}
              max={336}
              value={form.failureBackoffMaxHours}
              onChange={e =>
                setForm(c => ({ ...c, failureBackoffMaxHours: Number(e.target.value) }))
              }
            />
            <p className="text-xs text-muted-foreground">
              After 1 failure: {tier1}h · 2 failures: {tier2}h · 3+: {backoffMax}h
            </p>
            {errors.failureBackoffMaxHours ? (
              <p className="text-xs text-destructive">{errors.failureBackoffMaxHours}</p>
            ) : null}
          </div>

          <div className="space-y-1">
            <Label htmlFor="perSourceRetentionCap">Per Source Retention Cap</Label>
            <Input
              id="perSourceRetentionCap"
              type="number"
              min={20}
              max={1000}
              value={form.perSourceRetentionCap}
              onChange={e =>
                setForm(c => ({ ...c, perSourceRetentionCap: Number(e.target.value) }))
              }
            />
            <p className="text-xs text-muted-foreground">20 - 1000 articles per source</p>
            {errors.perSourceRetentionCap ? (
              <p className="text-xs text-destructive">{errors.perSourceRetentionCap}</p>
            ) : null}
          </div>

          <div className="space-y-1">
            <Label htmlFor="globalRetentionCap">Global Retention Cap</Label>
            <Input
              id="globalRetentionCap"
              type="number"
              min={5000}
              max={50000}
              value={form.globalRetentionCap}
              onChange={e => setForm(c => ({ ...c, globalRetentionCap: Number(e.target.value) }))}
            />
            <p className="text-xs text-muted-foreground">5000 - 50000 articles overall</p>
            {errors.globalRetentionCap ? (
              <p className="text-xs text-destructive">{errors.globalRetentionCap}</p>
            ) : null}
          </div>
        </div>
        <SaveButton onClick={save} saving={saving} />

        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <div className="space-y-1">
            <div className="text-sm font-medium text-destructive">Delete All Articles</div>
            <p className="text-xs text-muted-foreground">
              Manually delete pulled feed articles globally. If you choose fewer than the total, the oldest articles are deleted first.
            </p>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              This only deletes articles. Feed sources and automated retention remain unchanged.
            </p>
            <Button
              type="button"
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => void openDeleteDialog()}
              disabled={deleteLoading}
            >
              {deleteLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Delete All Articles
            </Button>
          </div>
        </div>
      </CardContent>

      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={open => {
          if (!open && !deleteExecuting) {
            closeDeleteDialog()
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Feed Articles</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteMaxCount > 0
                ? `Delete up to ${deleteMaxCount} pulled feed article${deleteMaxCount === 1 ? '' : 's'} globally. If you choose fewer than the total, the oldest articles are deleted first.`
                : 'There are no pulled feed articles to delete.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteMaxCount > 0 ? (
            <div className="space-y-2">
              <Label htmlFor="global-feed-delete-count">Article count</Label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => setDeleteCount(deleteCount - 1)}
                  disabled={deleteExecuting || deleteCount <= 1}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <Input
                  id="global-feed-delete-count"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={deleteCount > 0 ? deleteCount : ''}
                  onChange={event => setDeleteCount(Number(event.target.value))}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => setDeleteCount(deleteCount + 1)}
                  disabled={deleteExecuting || deleteCount >= deleteMaxCount}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">1 - {deleteMaxCount} articles</p>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteExecuting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={event => {
                event.preventDefault()
                void executeDelete()
              }}
              disabled={deleteExecuting || deleteMaxCount === 0 || deleteCount <= 0}
            >
              {deleteExecuting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete oldest articles
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}