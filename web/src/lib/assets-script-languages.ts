export const SCRIPT_LANGUAGE_OPTIONS = [
  { value: 'shell', label: 'Shell', extensions: ['sh'], defaultExtension: 'sh' },
  { value: 'bash', label: 'Bash', extensions: ['bash', 'sh'], defaultExtension: 'bash' },
  { value: 'zsh', label: 'Zsh', extensions: ['zsh'], defaultExtension: 'zsh' },
  { value: 'python', label: 'Python', extensions: ['py'], defaultExtension: 'py' },
  { value: 'javascript', label: 'JavaScript', extensions: ['js'], defaultExtension: 'js' },
  { value: 'typescript', label: 'TypeScript', extensions: ['ts'], defaultExtension: 'ts' },
  { value: 'powershell', label: 'PowerShell', extensions: ['ps1'], defaultExtension: 'ps1' },
  { value: 'ruby', label: 'Ruby', extensions: ['rb'], defaultExtension: 'rb' },
  { value: 'perl', label: 'Perl', extensions: ['pl'], defaultExtension: 'pl' },
  { value: 'php', label: 'PHP', extensions: ['php'], defaultExtension: 'php' },
  { value: 'lua', label: 'Lua', extensions: ['lua'], defaultExtension: 'lua' },
  { value: 'groovy', label: 'Groovy', extensions: ['groovy'], defaultExtension: 'groovy' },
  { value: 'r', label: 'R', extensions: ['r'], defaultExtension: 'r' },
  { value: 'other', label: 'Other', extensions: [], defaultExtension: '' },
] as const

export type ScriptLanguage = (typeof SCRIPT_LANGUAGE_OPTIONS)[number]['value']

const SCRIPT_LANGUAGE_OPTION_MAP = new Map(
  SCRIPT_LANGUAGE_OPTIONS.map(option => [option.value, option])
)

export function isScriptLanguage(value: string): value is ScriptLanguage {
  return SCRIPT_LANGUAGE_OPTION_MAP.has(value as ScriptLanguage)
}

export function getScriptLanguageOption(value: ScriptLanguage) {
  return SCRIPT_LANGUAGE_OPTION_MAP.get(value) ?? SCRIPT_LANGUAGE_OPTIONS[0]
}

export function formatScriptLanguageOptionLabel(value: ScriptLanguage) {
  const option = getScriptLanguageOption(value)
  if (option.extensions.length === 0) {
    return `${option.label} (custom suffix)`
  }
  return `${option.label} (.${option.extensions.join(', .')})`
}

export const SCRIPT_UPLOAD_ACCEPT = Array.from(
  new Set(
    SCRIPT_LANGUAGE_OPTIONS.flatMap(option => option.extensions.map(ext => `.${ext}`)).concat([
      '.txt',
      '.md',
    ])
  )
).join(',')