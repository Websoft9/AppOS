import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TabsContent } from '@/components/ui/tabs'
import { AppDetailDisplaySection } from '@/pages/apps/AppDetailDisplaySection'
import type { SettingsTabProps } from '@/pages/apps/AppDetailTabPanelTypes'
import { formatTime } from '@/pages/apps/types'

export function AppDetailAutomationTab() {
  return (
    <TabsContent value="automation" className="space-y-2.5">
      <Card>
        <CardHeader className="pb-2.5">
          <CardTitle>Schedules</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm text-muted-foreground">
          <p>App-scoped schedules and cron entries are not connected yet.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2.5">
          <CardTitle>Recent Runs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm text-muted-foreground">
          <p>Recent automation runs and their latest status will appear here.</p>
        </CardContent>
      </Card>
    </TabsContent>
  )
}

export function AppDetailSettingsTab({ app, displaySection }: SettingsTabProps) {
  return (
    <TabsContent value="settings" className="space-y-2.5">
      <Card>
        <CardHeader className="pb-2.5">
          <CardTitle>App Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 text-sm md:grid-cols-2">
            <div>
              <span className="text-muted-foreground">App ID:</span>{' '}
              <span className="font-mono text-xs">{app.id}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Source:</span>{' '}
              {app.source || app.current_pipeline?.selector?.source || '-'}
            </div>
            <div>
              <span className="text-muted-foreground">Created:</span> {formatTime(app.created)}
            </div>
            <div>
              <span className="text-muted-foreground">Updated:</span> {formatTime(app.updated)}
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2.5">
          <CardTitle>Security Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm text-muted-foreground">
          <p>Security scanning and app-scoped hardening summary are not connected yet.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2.5">
          <CardTitle>Metadata and Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm text-muted-foreground">
          <p>
            Operator notes, ownership, maintenance windows, and tags are planned for this section.
          </p>
        </CardContent>
      </Card>

      <AppDetailDisplaySection
        iconValue={displaySection.iconValue}
        labelValue={displaySection.labelValue}
        tagsValue={displaySection.tagsValue}
        tags={displaySection.tags}
        appName={app.name}
        saving={displaySection.saving}
        hasChanges={displaySection.hasChanges}
        onIconChange={displaySection.onIconChange}
        onLabelChange={displaySection.onLabelChange}
        onTagsChange={displaySection.onTagsChange}
        onSave={displaySection.onSave}
        onReset={displaySection.onReset}
      />
    </TabsContent>
  )
}
