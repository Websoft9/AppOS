import { type SettingsPageController } from '../-settings-controller'
import { getActiveDomainSectionHelp } from './domains'
import { settingsNavigationAliases } from './registry'

export function getRegisteredSectionHelp(controller: SettingsPageController) {
  const domainHelp = getActiveDomainSectionHelp(controller)
  if (domainHelp) {
    return domainHelp
  }

  return (
    settingsNavigationAliases.find(
      alias => alias.help && alias.matchesActiveSection(controller.activeSection)
    )?.help ?? null
  )
}
