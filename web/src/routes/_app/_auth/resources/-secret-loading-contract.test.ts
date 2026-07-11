import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const TARGET_FILES = ['./servers.tsx', './ai-providers.tsx', './platform-accounts.tsx'] as const

describe('shared secret picker loading contract', () => {
  it('keeps each shared secret picker on the shared visibility-aware secret loader', () => {
    for (const fileName of TARGET_FILES) {
      const filePath = fileURLToPath(new URL(fileName, import.meta.url).href)
      const source = readFileSync(filePath, 'utf8')

      expect(source).toContain('buildUserVisibleSecretRelationApiPath(')
      expect(source).not.toContain('/api/collections/secrets/records?perPage=500&sort=name')
      expect(source).not.toContain('function buildSecretRelationApiPath(')
      expect(source).not.toContain('buildResourceSecretRelationApiPath(')
    }
  })
})
