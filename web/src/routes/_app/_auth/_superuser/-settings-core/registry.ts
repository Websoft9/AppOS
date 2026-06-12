import { type SettingsSection } from '@/lib/settings-api'
import { getFeedsSectionHelp, renderFeedsSection } from '../-settings-domain-feeds'
import {
  getMonitorSectionHelp,
  isMonitorSectionId,
  renderMonitorSection,
} from '../-settings-domain-monitor'
import { type SettingsPageController } from '../-settings-controller'
import {
  AI_SECTION_IDS,
  DEPLOY_SECTION_IDS,
  DOCKER_SECTION_IDS,
  PROXY_SECTION_IDS,
  SPACE_SECTION_IDS,
  TERMINAL_SECTION_IDS,
  TOPIC_SECTION_IDS,
  matchesSectionIds,
} from './section-ids'

export type SettingsHelpDefinition = {
  title: string
  description: string
}

export type SettingsDomainRegistration = {
  getSectionHelp: (controller: SettingsPageController) => SettingsHelpDefinition | null
  renderSection: (controller: SettingsPageController) => React.ReactNode | null
}

export type SettingsNavigationAlias = {
  group?: SettingsSection
  id: string
  title: string
  matchesEntryId: (entryId: string) => boolean
  matchesActiveSection: (activeSection: string) => boolean
  help?: SettingsHelpDefinition
}

export const settingsDomainRegistrations: SettingsDomainRegistration[] = [
  {
    getSectionHelp: getFeedsSectionHelp,
    renderSection: renderFeedsSection,
  },
  {
    getSectionHelp: getMonitorSectionHelp,
    renderSection: renderMonitorSection,
  },
]

export const settingsNavigationAliases: SettingsNavigationAlias[] = [
  {
    id: 'space-quota',
    title: 'Space',
    matchesEntryId: entryId => matchesSectionIds(entryId, SPACE_SECTION_IDS),
    matchesActiveSection: activeSection => matchesSectionIds(activeSection, SPACE_SECTION_IDS),
  },
  {
    id: 'topics',
    title: 'Topics',
    matchesEntryId: entryId => matchesSectionIds(entryId, TOPIC_SECTION_IDS),
    matchesActiveSection: activeSection => matchesSectionIds(activeSection, TOPIC_SECTION_IDS),
    help: {
      title: 'Topics',
      description: 'Configure public topic share duration and guest comment policy from one place.',
    },
  },
  {
    id: 'terminal',
    title: 'Terminal',
    matchesEntryId: entryId => entryId === 'connect-terminal' || entryId === 'connect-sftp',
    matchesActiveSection: activeSection => matchesSectionIds(activeSection, TERMINAL_SECTION_IDS),
    help: {
      title: 'Terminal',
      description:
        'Control terminal and SFTP session limits without leaving the shared settings surface.',
    },
  },
  {
    id: 'deploy',
    title: 'Deploy',
    matchesEntryId: entryId => matchesSectionIds(entryId, DEPLOY_SECTION_IDS),
    matchesActiveSection: activeSection => matchesSectionIds(activeSection, DEPLOY_SECTION_IDS),
    help: {
      title: 'Deploy',
      description: 'Set deploy checks, wait times, and Git defaults.',
    },
  },
  {
    id: 'docker-mirror',
    title: 'Docker',
    matchesEntryId: entryId => entryId === 'docker-mirror',
    matchesActiveSection: activeSection => matchesSectionIds(activeSection, DOCKER_SECTION_IDS),
    help: {
      title: 'Docker',
      description: 'Configure AppOS image pull acceleration for deployment and update workflows.',
    },
  },
  {
    group: 'system',
    id: 'monitor',
    title: 'Monitor',
    matchesEntryId: entryId => isMonitorSectionId(entryId),
    matchesActiveSection: activeSection => isMonitorSectionId(activeSection),
  },
  {
    id: 'proxy-network',
    title: 'Proxy',
    matchesEntryId: entryId => matchesSectionIds(entryId, PROXY_SECTION_IDS),
    matchesActiveSection: activeSection => matchesSectionIds(activeSection, PROXY_SECTION_IDS),
    help: {
      title: 'Proxy',
      description: 'SOCKS5 overrides all outbound traffic; otherwise HTTP and HTTPS can be assigned independently.',
    },
  },
  {
    id: 'ai',
    title: 'AI',
    matchesEntryId: entryId => matchesSectionIds(entryId, AI_SECTION_IDS),
    matchesActiveSection: activeSection => matchesSectionIds(activeSection, AI_SECTION_IDS),
    help: {
      title: 'AI',
      description:
        'Choose the platform default AI model and manage provider records from the same workflow.',
    },
  },
]
