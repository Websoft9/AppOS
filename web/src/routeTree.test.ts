import { describe, expect, it } from 'vitest'
import type { FileRoutesByFullPath } from './routeTree.gen'
import { routeTree } from './routeTree.gen'

type AIProvidersRoute = FileRoutesByFullPath['/resources/ai-providers']

describe('routeTree', () => {
  it('keeps the AI Providers route in the generated file-route map', () => {
    const generatedRouteKey: AIProvidersRoute | undefined = undefined
    expect(generatedRouteKey).toBeUndefined()
    expect(routeTree).toBeDefined()
  })
})
