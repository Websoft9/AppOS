export const SETTINGS_API_PATH = '/api/settings'
export const SETTINGS_TEST_EMAIL_API_PATH = '/api/settings/test/email'
export const SETTINGS_TEST_S3_API_PATH = '/api/settings/test/s3'
export const EXT_SETTINGS_WORKSPACE_API_PATH = '/api/settings/workspace'
export const TUNNEL_SETTINGS_API_PATH = '/api/settings/tunnel'
export const SECRETS_SETTINGS_API_PATH = '/api/settings/secrets'

export type ExtSettingsModule = 'space' | 'connect' | 'proxy' | 'docker' | 'llm'

export function extSettingsModulePath(module: ExtSettingsModule): string {
  return `${EXT_SETTINGS_WORKSPACE_API_PATH}/${module}`
}