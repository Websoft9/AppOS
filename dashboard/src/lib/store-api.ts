import { QueryClient, useQuery } from '@tanstack/react-query'
import type { Locale, PrimaryCategory, Product, ProductWithCategories, StoreJsonType } from './store-types'

const CDN_BASE = 'https://artifact.websoft9.com/release/websoft9/store'
const LOCAL_BASE = '/store'

// ─── Core fetch function ───────────────────────────────────────────────────────

/**
 * Fetch store JSON from local bundled file first.
 * After returning local data, silently fetches CDN in the background
 * and updates TanStack Query cache on success.
 */
export async function fetchStoreJson<T>(
  locale: Locale,
  type: StoreJsonType,
  queryClient?: QueryClient,
): Promise<T> {
  const filename = `${type}_${locale}.json`
  const localUrl = `${LOCAL_BASE}/${filename}`
  const cdnUrl = `${CDN_BASE}/${filename}`
  const queryKey = ['store', type, locale]

  // Fetch local bundled file
  const localRes = await fetch(localUrl)
  if (!localRes.ok) {
    throw new Error(`Failed to load local store data: ${localUrl}`)
  }
  const localData: T = await localRes.json()

  // Silently fetch CDN in background and update cache if successful
  if (queryClient) {
    Promise.resolve().then(async () => {
      try {
        const cdnRes = await fetch(cdnUrl, { cache: 'no-store' })
        if (cdnRes.ok) {
          const cdnData: T = await cdnRes.json()
          queryClient.setQueryData(queryKey, cdnData)
        }
      } catch {
        // CDN unreachable — silently ignored, local version remains active
      }
    })
  }

  return localData
}

// ─── TanStack Query hooks ─────────────────────────────────────────────────────

export function useCatalog(locale: Locale, queryClient?: QueryClient) {
  return useQuery<PrimaryCategory[]>({
    queryKey: ['store', 'catalog', locale],
    queryFn: () => fetchStoreJson<PrimaryCategory[]>(locale, 'catalog', queryClient),
    staleTime: 60 * 60 * 1000, // 1 hour
  })
}

export function useProducts(locale: Locale, queryClient?: QueryClient) {
  return useQuery<Product[]>({
    queryKey: ['store', 'product', locale],
    queryFn: () => fetchStoreJson<Product[]>(locale, 'product', queryClient),
    staleTime: 60 * 60 * 1000, // 1 hour
  })
}

// ─── Manual CDN sync ──────────────────────────────────────────────────────────

/**
 * Force-fetch both catalog and product JSON from CDN and update the query cache.
 * Returns true on success, false if CDN is unreachable.
 */
export async function syncLatestFromCdn(
  locale: Locale,
  queryClient: QueryClient,
): Promise<boolean> {
  try {
    const [catalog, products] = await Promise.all([
      fetch(`${CDN_BASE}/catalog_${locale}.json`, { cache: 'no-store' }).then((r) => {
        if (!r.ok) throw new Error('catalog fetch failed')
        return r.json() as Promise<PrimaryCategory[]>
      }),
      fetch(`${CDN_BASE}/product_${locale}.json`, { cache: 'no-store' }).then((r) => {
        if (!r.ok) throw new Error('product fetch failed')
        return r.json() as Promise<Product[]>
      }),
    ])
    queryClient.setQueryData(['store', 'catalog', locale], catalog)
    queryClient.setQueryData(['store', 'product', locale], products)
    // Force subscribers (useCatalog / useProducts) to re-render immediately
    await queryClient.invalidateQueries({ queryKey: ['store', 'catalog', locale] })
    await queryClient.invalidateQueries({ queryKey: ['store', 'product', locale] })
    return true
  } catch {
    return false
  }
}

// ─── Data transformation helpers ─────────────────────────────────────────────

/**
 * Enrich products with resolved primary/secondary category keys.
 * Primary match: product.catalogCollection.items[*].catalogCollection.items[0].key
 * Secondary match: product.catalogCollection.items[*].key
 */
export function enrichProducts(products: Product[]): ProductWithCategories[] {
  return products.map((p) => {
    const catalogItems = p.catalogCollection?.items ?? []
    const secondaryCategoryKeys = catalogItems.map((item) => item.key)
    const primaryCategoryKey =
      catalogItems[0]?.catalogCollection?.items?.[0]?.key ?? null

    return {
      ...p,
      primaryCategoryKey,
      secondaryCategoryKeys,
    }
  })
}

/**
 * Count apps per primary category.
 */
export function countByPrimaryCategory(
  products: ProductWithCategories[],
  primaryCategories: PrimaryCategory[],
): Record<string, number> {
  const counts: Record<string, number> = {}

  for (const cat of primaryCategories) {
    counts[cat.key] = 0
  }

  for (const p of products) {
    if (p.primaryCategoryKey && counts[p.primaryCategoryKey] !== undefined) {
      counts[p.primaryCategoryKey]++
    }
  }

  return counts
}

/**
 * Count apps per secondary category.
 */
export function countBySecondaryCategory(
  products: ProductWithCategories[],
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const p of products) {
    for (const key of p.secondaryCategoryKeys) {
      counts[key] = (counts[key] ?? 0) + 1
    }
  }
  return counts
}

/**
 * Filter products by primary category, secondary category, and search query.
 */
export function filterProducts(
  products: ProductWithCategories[],
  primaryCategory: string | null,
  secondaryCategory: string | null,
  search: string,
): ProductWithCategories[] {
  let result = products

  if (primaryCategory) {
    result = result.filter((p) => p.primaryCategoryKey === primaryCategory)
  }

  if (secondaryCategory) {
    result = result.filter((p) => p.secondaryCategoryKeys.includes(secondaryCategory))
  }

  if (search.trim()) {
    const q = search.trim().toLowerCase()
    result = result.filter(
      (p) =>
        p.trademark.toLowerCase().includes(q) ||
        p.overview.toLowerCase().includes(q),
    )
  }

  return result
}

// ─── Icon helpers ─────────────────────────────────────────────────────────────

export function getIconUrl(appKey: string): string {
  return `https://libs.websoft9.com/Websoft9/logo/product/${appKey}.png`
}

export function getDocUrl(appKey: string, locale: Locale): string {
  if (locale === 'zh') {
    return `https://support.websoft9.com/docs/${appKey}`
  }
  return `https://support.websoft9.com/en/docs/${appKey}`
}

export function getGithubUrl(appKey: string): string {
  return `https://github.com/Websoft9/docker-library/tree/main/apps/${appKey}`
}

/**
 * Derive a background color from app key (for text icon fallback).
 * Uses a simple hash to pick from a palette of accessible colors.
 */
export function getKeyColor(key: string): string {
  const palette = [
    '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
    '#06B6D4', '#84CC16', '#F97316', '#EC4899', '#6366F1',
    '#14B8A6', '#A855F7', '#0EA5E9', '#22C55E', '#EAB308',
  ]
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash)
  }
  return palette[Math.abs(hash) % palette.length]
}

// ─── Search helpers ───────────────────────────────────────────────────────────

const SEARCH_HISTORY_KEY = 'ws9-store-search-history'
const MAX_HISTORY = 10

export function getSearchHistory(): string[] {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

export function addSearchHistory(term: string): void {
  if (!term.trim()) return
  const history = getSearchHistory().filter((h) => h !== term)
  history.unshift(term)
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)))
}

export function clearSearchHistory(): void {
  localStorage.removeItem(SEARCH_HISTORY_KEY)
}

export function getSearchSuggestions(
  products: Product[],
  query: string,
): Product[] {
  if (!query.trim()) return []
  const q = query.trim().toLowerCase()

  const prefix: Product[] = []
  const contains: Product[] = []

  for (const p of products) {
    const name = p.trademark.toLowerCase()
    if (name.startsWith(q)) {
      prefix.push(p)
    } else if (name.includes(q) || p.overview.toLowerCase().includes(q)) {
      contains.push(p)
    }
    if (prefix.length + contains.length >= 10) break
  }

  return [...prefix, ...contains].slice(0, 10)
}
