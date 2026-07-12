import { readFileSync, readdirSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC_DIR: string = (import.meta as any).dirname ?? resolve(process.cwd(), 'src')

function walkTestFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...walkTestFiles(full))
    } else if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) {
      results.push(full)
    }
  }
  return results
}

const DANGEROUS_PATTERNS = [
  /\/web\/src\//,
  /\/backend\//,
] as const

const GUARD_FILE = import.meta.dirname ? resolve(import.meta.dirname, '-path-guard.test.ts') : ''

describe('path guard', () => {
  it('no test file hardcodes an absolute project source path', () => {
    const violations: string[] = []

    for (const filePath of walkTestFiles(SRC_DIR)) {
      if (GUARD_FILE && resolve(filePath) === resolve(GUARD_FILE)) continue

      const source = readFileSync(filePath, 'utf8')
      for (const pattern of DANGEROUS_PATTERNS) {
        const match = source.match(pattern)
        if (match) {
          const rel = relative(SRC_DIR, filePath)
          violations.push(`${rel}: contains "${match[0]}"`)
          break
        }
      }
    }

    if (violations.length > 0) {
      expect.fail(
        `Found hardcoded project source paths in test files.\n` +
          `These will fail on CI where the checkout directory differs.\n` +
          `Use relative paths with import.meta.url instead.\n\n` +
          violations.join('\n'),
      )
    }
  })
})
