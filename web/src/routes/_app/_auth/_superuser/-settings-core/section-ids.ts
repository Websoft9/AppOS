export const FEEDS_SECTION_IDS = ['feeds-policy'] as const
export const MONITOR_SECTION_IDS = [
  'monitor',
  'monitor-scheduling',
  'monitor-policy',
  'monitor-platform-self-observation',
  'monitor-managed-collector-policy',
] as const
export const SPACE_SECTION_IDS = ['space-quota'] as const
export const TOPIC_SECTION_IDS = ['topics', 'topic-share', 'topic-comment-policy', 'topic-import-policy'] as const
export const TERMINAL_SECTION_IDS = ['terminal', 'connect-terminal', 'connect-sftp'] as const
export const DOCKER_SECTION_IDS = ['docker-mirror', 'docker-registries'] as const
export const PROXY_SECTION_IDS = ['proxy-network'] as const
export const AI_SECTION_IDS = ['ai'] as const
export const SMTP_SECTION_IDS = ['smtp'] as const
export const DEPLOY_PREFLIGHT_SECTION_IDS = ['deploy-preflight'] as const
export const IAC_FILES_SECTION_IDS = ['iac-files'] as const
export const TUNNEL_SECTION_IDS = ['tunnel-port-range'] as const
export const BASIC_SECTION_IDS = ['basic'] as const
export const BRANDING_SECTION_IDS = ['branding'] as const
export const S3_SECTION_IDS = ['s3'] as const
export const LOGS_SECTION_IDS = ['logs'] as const
export const SECRETS_POLICY_SECTION_IDS = ['secrets-policy'] as const

export function matchesSectionIds(activeSection: string, sectionIds: readonly string[]) {
  return sectionIds.includes(activeSection)
}