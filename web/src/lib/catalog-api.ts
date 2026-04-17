import { useQuery } from '@tanstack/react-query'
import { pb } from '@/lib/pb'
import type { PrimaryCategory, Product, ProductWithCategories } from './store-types'

export interface CatalogCategoryChild {
  key: string
  title: string
  position?: number | null
  appCount: number
  parentKey: string
}

export interface CatalogCategoryNode {
  key: string
  title: string
  position?: number | null
  appCount: number
  children: CatalogCategoryChild[]
}

export interface CatalogCategoryTreeResponse {
  items: CatalogCategoryNode[]
  meta: {
    locale: 'en' | 'zh'
    sourceVersion: string
  }
}

export interface CatalogAppSummary {
  key: string
  title: string
  overview: string
  iconUrl?: string
  source: 'official' | 'custom'
  visibility: string
  primaryCategory?: CatalogCategoryRef | null
  secondaryCategories: CatalogCategoryRef[]
  badges: string[]
  template: {
    key: string
    source: string
    available: boolean
  }
  personalization: {
    isFavorite: boolean
    hasNote: boolean
  }
  updatedAt?: string
}

export interface CatalogAppListResponse {
  items: CatalogAppSummary[]
  page: {
    limit: number
    offset: number
    total: number
    hasMore: boolean
  }
  meta: {
    locale: 'en' | 'zh'
    sourceVersion: string
  }
}

export interface CatalogAppsQuery {
  locale: 'en' | 'zh'
  primaryCategory?: string | null
  secondaryCategory?: string | null
  q?: string
  source?: 'all' | 'official' | 'custom'
  visibility?: 'all' | 'owned' | 'shared'
  favorite?: boolean
  limit?: number
  offset?: number
}

export interface CatalogCategoryRef {
  key: string
  title: string
}

export interface CatalogScreenshot {
  key: string
  url: string
}

export interface CatalogAppDetail {
  key: string
  title: string
  overview: string
  description?: string
  iconUrl?: string
  screenshots: CatalogScreenshot[]
  source: {
    kind: 'official' | 'custom'
    visibility: string
    author?: string | null
    recordId?: string | null
  }
  categories: {
    primary?: CatalogCategoryRef | null
    secondary: CatalogCategoryRef[]
  }
  links: {
    website?: string
    docs?: string
    github?: string
  }
  requirements: {
    vcpu?: number
    memoryGb?: number
    storageGb?: number
  }
  template: {
    key: string
    source: string
    available: boolean
    pathHint?: string
  }
  deploy: {
    supported: boolean
    mode: string
    sourceKind: string
    defaultAppName: string
  }
  personalization: {
    isFavorite: boolean
    note?: string | null
  }
  audit: {
    createdAt?: string | null
    updatedAt?: string | null
  }
}

export interface CatalogDeploySource {
  app: {
    key: string
    title: string
    source: string
  }
  template: {
    key: string
    source: string
    available: boolean
  }
  install: {
    prefillMode: string
    prefillSource: string
    prefillAppKey: string
    prefillAppName: string
  }
  capabilities: {
    hasComposeTemplate: boolean
    hasEnvTemplate: boolean
    supportsDirectDeploy: boolean
  }
}

async function fetchCatalogAppDetail(locale: 'en' | 'zh', key: string): Promise<CatalogAppDetail> {
  return pb.send(`/api/catalog/apps/${encodeURIComponent(key)}?locale=${locale}`, {
    method: 'GET',
  })
}

async function fetchCatalogCategories(locale: 'en' | 'zh'): Promise<CatalogCategoryTreeResponse> {
  return pb.send(`/api/catalog/categories?locale=${locale}`, {
    method: 'GET',
  })
}

async function fetchCatalogApps(query: CatalogAppsQuery): Promise<CatalogAppListResponse> {
  const params = new URLSearchParams()
  params.set('locale', query.locale)
  if (query.primaryCategory) params.set('primaryCategory', query.primaryCategory)
  if (query.secondaryCategory) params.set('secondaryCategory', query.secondaryCategory)
  if (query.q?.trim()) params.set('q', query.q.trim())
  if (query.source) params.set('source', query.source)
  if (query.visibility) params.set('visibility', query.visibility)
  if (typeof query.favorite === 'boolean') params.set('favorite', String(query.favorite))
  if (typeof query.limit === 'number') params.set('limit', String(query.limit))
  if (typeof query.offset === 'number') params.set('offset', String(query.offset))

  return pb.send(`/api/catalog/apps?${params.toString()}`, {
    method: 'GET',
  })
}

export function toLegacyPrimaryCategories(
  response: CatalogCategoryTreeResponse
): PrimaryCategory[] {
  return response.items.map(item => ({
    key: item.key,
    title: item.title,
    position: item.position ?? null,
    linkedFrom: {
      catalogCollection: {
        items: item.children.map(child => ({
          key: child.key,
          title: child.title,
          position: child.position ?? null,
        })),
      },
    },
  }))
}

export function toLegacyProduct(summary: CatalogAppSummary): ProductWithCategories {
  return {
    sys: { id: summary.key },
    key: summary.key,
    trademark: summary.title,
    summary: summary.overview,
    overview: summary.overview,
    logo: summary.iconUrl ? { imageurl: summary.iconUrl } : undefined,
    catalogCollection: {
      items: summary.secondaryCategories.map(item => ({
        key: item.key,
        title: item.title,
        catalogCollection: summary.primaryCategory
          ? { items: [{ key: summary.primaryCategory.key }] }
          : undefined,
      })),
    },
    primaryCategoryKey: summary.primaryCategory?.key ?? null,
    secondaryCategoryKeys: summary.secondaryCategories.map(item => item.key),
  } as ProductWithCategories
}

export function toLegacyProducts(response: CatalogAppListResponse): Product[] {
  return response.items.map(item => ({
    sys: { id: item.key },
    key: item.key,
    trademark: item.title,
    summary: item.overview,
    overview: item.overview,
    logo: item.iconUrl ? { imageurl: item.iconUrl } : undefined,
    catalogCollection: {
      items: item.secondaryCategories.map(category => ({
        key: category.key,
        title: category.title,
        catalogCollection: item.primaryCategory
          ? { items: [{ key: item.primaryCategory.key }] }
          : undefined,
      })),
    },
  }))
}

async function fetchCatalogDeploySource(
  locale: 'en' | 'zh',
  key: string
): Promise<CatalogDeploySource> {
  return pb.send(`/api/catalog/apps/${encodeURIComponent(key)}/deploy-source?locale=${locale}`, {
    method: 'GET',
  })
}

export function useCatalogAppDetail(locale: 'en' | 'zh', key: string | null, enabled = true) {
  return useQuery({
    queryKey: ['catalog', 'app-detail', locale, key],
    queryFn: () => fetchCatalogAppDetail(locale, key as string),
    enabled: enabled && Boolean(key),
    staleTime: 60 * 1000,
  })
}

export function useCatalogDeploySource(locale: 'en' | 'zh', key: string | null, enabled = true) {
  return useQuery({
    queryKey: ['catalog', 'deploy-source', locale, key],
    queryFn: () => fetchCatalogDeploySource(locale, key as string),
    enabled: enabled && Boolean(key),
    staleTime: 60 * 1000,
  })
}

export function useCatalogCategories(locale: 'en' | 'zh') {
  return useQuery({
    queryKey: ['catalog', 'categories', locale],
    queryFn: () => fetchCatalogCategories(locale),
    staleTime: 60 * 1000,
  })
}

export function useCatalogApps(query: CatalogAppsQuery) {
  return useQuery({
    queryKey: ['catalog', 'apps', query],
    queryFn: () => fetchCatalogApps(query),
    staleTime: 60 * 1000,
  })
}
