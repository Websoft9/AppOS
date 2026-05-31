import { useState } from 'react'
import { Info, Loader2, X } from 'lucide-react'
import { parseExtListInput } from '@/lib/ext-normalize'
import { type SettingsSection } from '@/lib/settings-api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getRegisteredSectionHelp } from './-settings-core/help'
import { buildNavigationItems, isNavigationItemActive } from './-settings-core/navigation'
import { renderRegisteredSection } from './-settings-core/render'
import { sectionLabel } from './-settings-sections/shared'
import { findSchemaEntry } from './-settings-core/schema-helpers'
import { type SettingsPageController } from './-settings-controller'

type SettingsScreenProps = {
  controller: SettingsPageController
}

function activeSectionHelp(controller: SettingsPageController) {
  const registeredHelp = getRegisteredSectionHelp(controller)
  if (registeredHelp) {
    return registeredHelp
  }

  const entry = findSchemaEntry(controller, controller.activeSection)
  return {
    title: controller.activeSection === 'space-quota' ? 'Space' : (entry?.title ?? 'Settings'),
    description:
      entry?.description ??
      'Select a setting from the menu to review its current purpose and controls.',
  }
}

function SettingsHelpPanel({
  title,
  description,
  onClose,
}: {
  title: string
  description: string
  onClose: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 text-muted-foreground">
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4" />
            <span className="text-sm font-medium">Help for:</span>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-sm text-muted-foreground">
          Click a setting in the menu to update this help panel.
        </p>
      </CardContent>
    </Card>
  )
}

function renderSection(controller: SettingsPageController, options?: { onOpenHelp?: () => void }) {
  const registeredSection = renderRegisteredSection(controller, {
    ...options,
    parseExtListInput,
  })
  if (registeredSection) {
    return registeredSection
  }

  return <div className="text-sm text-muted-foreground">No editor available for this entry.</div>
}

export function SettingsScreen({ controller }: SettingsScreenProps) {
  const [helpOpen, setHelpOpen] = useState(false)
  const groups = controller.schemaEntries.reduce<SettingsSection[]>((acc, entry) => {
    if (!acc.includes(entry.section)) {
      acc.push(entry.section)
    }
    return acc
  }, [])
  const help = activeSectionHelp(controller)

  return (
    <div>
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {controller.toasts.map(t => (
          <div
            key={t.id}
            className={`px-4 py-2 rounded-md shadow text-sm text-white ${t.ok ? 'bg-green-600' : 'bg-red-600'}`}
          >
            {t.msg}
          </div>
        ))}
      </div>

      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      {controller.pbLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div
          className={`grid gap-6 max-w-[1360px] ${
            helpOpen
              ? 'lg:grid-cols-[200px_minmax(0,760px)] xl:grid-cols-[220px_minmax(0,820px)] 2xl:grid-cols-[220px_minmax(0,820px)_320px]'
              : 'lg:grid-cols-[200px_minmax(0,760px)] xl:grid-cols-[220px_minmax(0,820px)]'
          }`}
        >
          <nav className="space-y-4 lg:sticky lg:top-6 lg:self-start">
            {groups.map(group => (
              <div key={group}>
                <p className="px-3 mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {sectionLabel(group)}
                </p>
                <div className="space-y-0.5">
                  {buildNavigationItems(controller, group).map(item => (
                    <button
                      key={item.id}
                      onClick={() => controller.setActiveSection(item.id)}
                      className={`w-full text-left px-3 py-2 text-sm rounded-md transition-colors ${
                        isNavigationItemActive(group, item.id, controller.activeSection)
                          ? 'bg-accent text-accent-foreground font-medium'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                      }`}
                    >
                      {item.title}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>

          <div className="min-w-0 lg:max-w-[760px] xl:max-w-[820px] space-y-4">
            {renderSection(controller, { onOpenHelp: () => setHelpOpen(true) })}
          </div>

          {helpOpen ? (
            <div className="min-w-0 lg:col-start-2 lg:row-start-2 2xl:col-start-3 2xl:row-start-1 2xl:sticky 2xl:top-6 2xl:self-start">
              <SettingsHelpPanel
                title={help.title}
                description={help.description}
                onClose={() => setHelpOpen(false)}
              />
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
