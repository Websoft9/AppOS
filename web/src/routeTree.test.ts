import { describe, expect, it } from 'vitest'
import type { FileRoutesByFullPath } from './routeTree.gen'
import { routeTree } from './routeTree.gen'

type AIProvidersRoute = FileRoutesByFullPath['/resources/ai-providers']

function assertGeneratedRouteKey<T>(_value: T) {}

describe('routeTree', () => {
  it('keeps the AI Providers route in the generated file-route map', () => {
    assertGeneratedRouteKey<AIProvidersRoute | undefined>(undefined)
    expect(routeTree).toBeDefined()
  })
})