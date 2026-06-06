import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SHARED_SECRET_PICKER_FILES = [
  '/data/dev/appos/web/src/routes/_app/_auth/resources/servers.tsx',
  '/data/dev/appos/web/src/routes/_app/_auth/resources/service-instances.tsx',
  '/data/dev/appos/web/src/routes/_app/_auth/resources/ai-providers.tsx',
  '/data/dev/appos/web/src/routes/_app/_auth/resources/platform-accounts.tsx',
  '/data/dev/appos/web/src/routes/_app/_auth/_superuser/-settings-sections/ai-section.tsx',
] as const

describe('shared secret picker loading contract', () => {
  it('keeps each shared secret picker on the shared visibility-aware secret loader', () => {
    for (const filePath of SHARED_SECRET_PICKER_FILES) {
      const source = readFileSync(filePath, 'utf8')

      expect(source).toContain("buildUserVisibleSecretRelationApiPath(")
      expect(source).not.toContain('/api/collections/secrets/records?perPage=500&sort=name')
      expect(source).not.toContain('function buildSecretRelationApiPath(')
      expect(source).not.toContain('buildResourceSecretRelationApiPath(')
    }
  })
})