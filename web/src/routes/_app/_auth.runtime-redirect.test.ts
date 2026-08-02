import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('AuthLayout runtime expiry redirect source guard', () => {
  it('keeps a runtime redirect effect when auth becomes invalid after mount', () => {
    const source = readFileSync('src/routes/_app/_auth.tsx', 'utf8')

    expect(source).toContain('const { isAuthenticated, isLoading } = useAuth()')
    expect(source).toContain('if (isLoading || isAuthenticated) return')
    expect(source).toContain("to: '/login'")
    expect(source).toContain('search: { redirect: location.href }')
    expect(source).toContain('replace: true')
    expect(source).toContain('useEffect(() => {')
  })
})
