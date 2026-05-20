import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('ImagesTab pull history labels', () => {
  it('uses the updated tab labels and removes redundant pending section copy', () => {
    const source = readFileSync('src/components/docker/ImagesTab.tsx', 'utf8')

    expect(source).toContain('<TabsTrigger value="pulling">Pending</TabsTrigger>')
    expect(source).toContain('<TabsTrigger value="recents">History</TabsTrigger>')
    expect(source).toContain("if (operation.phase === 'accepted') return 'Queued'")
    expect(source).toContain("return 'Pulling'")

    expect(source).not.toContain('<TabsTrigger value="pulling">Pulling</TabsTrigger>')
    expect(source).not.toContain('<TabsTrigger value="recents">Recents</TabsTrigger>')
    expect(source).not.toContain('Running now')
    expect(source).not.toContain('These pulls are actively downloading on the target server.')
    expect(source).not.toContain('These pulls are waiting for an available pull slot on this server.')
  })
})