export interface SecretPolicy {
  revealDisabled: boolean
  defaultAccessMode: string
  clipboardClearSeconds: number
}
export const DEFAULT_SECRET_ACCESS_MODE = 'use_only'

export const SECRET_ACCESS_MODE_OPTIONS = [
  { value: DEFAULT_SECRET_ACCESS_MODE, label: 'Use Only' },
  { value: 'reveal_once', label: 'Reveal Once' },
  { value: 'reveal_allowed', label: 'Reveal Allowed' },
] as const

export const DEFAULT_SECRET_POLICY: SecretPolicy = {
  revealDisabled: false,
  defaultAccessMode: DEFAULT_SECRET_ACCESS_MODE,
  clipboardClearSeconds: 0,
}

export function normalizeSecretPolicy(input: unknown): SecretPolicy {
  if (!input || typeof input !== 'object') {
    return DEFAULT_SECRET_POLICY
  }

  const raw = input as Record<string, unknown>
  const defaultAccessMode =
    typeof raw.defaultAccessMode === 'string' &&
    SECRET_ACCESS_MODE_OPTIONS.some(option => option.value === raw.defaultAccessMode)
      ? raw.defaultAccessMode
      : DEFAULT_SECRET_POLICY.defaultAccessMode

  const clipboardClearSeconds = Number(raw.clipboardClearSeconds)

  return {
    revealDisabled: raw.revealDisabled === true,
    defaultAccessMode,
    clipboardClearSeconds:
      Number.isFinite(clipboardClearSeconds) && clipboardClearSeconds >= 0
        ? Math.floor(clipboardClearSeconds)
        : DEFAULT_SECRET_POLICY.clipboardClearSeconds,
  }
}

export function canRevealSecret(accessMode: string, policy: SecretPolicy): boolean {
  return !policy.revealDisabled && accessMode !== DEFAULT_SECRET_ACCESS_MODE
}
