import { type SettingsPageController } from '../-settings-controller'
import { settingsDomainRegistrations } from './registry'

export function getActiveDomainSectionHelp(controller: SettingsPageController) {
  for (const domain of settingsDomainRegistrations) {
    const help = domain.getSectionHelp(controller)
    if (help) {
      return help
    }
  }
  return null
}

export function renderActiveDomainSection(controller: SettingsPageController) {
  for (const domain of settingsDomainRegistrations) {
    const section = domain.renderSection(controller)
    if (section) {
      return section
    }
  }
  return null
}