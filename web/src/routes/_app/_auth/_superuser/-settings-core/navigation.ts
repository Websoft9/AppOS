import { type SettingsSection } from '@/lib/settings-api'
import { type SettingsPageController } from '../-settings-controller'
import { settingsNavigationAliases } from './registry'

function navigationAliasesForGroup(group: SettingsSection) {
  return settingsNavigationAliases.filter(alias => !alias.group || alias.group === group)
}

function resolveNavigationAlias(group: SettingsSection, entryId: string) {
  return navigationAliasesForGroup(group).find(alias => alias.matchesEntryId(entryId))
}

function resolveNavigationAliasById(group: SettingsSection, itemId: string) {
  return navigationAliasesForGroup(group).find(alias => alias.id === itemId)
}

export function buildNavigationItems(controller: SettingsPageController, group: SettingsSection) {
  const items = controller.schemaEntries.filter(entry => entry.section === group)
  const result: Array<{ id: string; title: string }> = []
  const addedAliases = new Set<string>()

  for (const item of items) {
    const alias = resolveNavigationAlias(group, item.id)
    if (alias) {
      if (!addedAliases.has(alias.id)) {
        result.push({ id: alias.id, title: alias.title })
        addedAliases.add(alias.id)
      }
      continue
    }

    result.push({ id: item.id, title: item.title })
  }

  return result
}

export function isNavigationItemActive(
  group: SettingsSection,
  itemId: string,
  activeSection: string
) {
  const alias = resolveNavigationAliasById(group, itemId)
  if (alias) {
    return alias.matchesActiveSection(activeSection)
  }

  return itemId === activeSection
}
