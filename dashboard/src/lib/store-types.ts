// Store module type definitions
// Matching data structures from public/store/catalog_{locale}.json and product_{locale}.json

export type Locale = 'en' | 'zh'
export type StoreJsonType = 'catalog' | 'product'

// ─── Catalog Types ────────────────────────────────────────────────────────────

export interface SecondaryCategory {
  key: string
  title: string
  position: number | null
}

export interface PrimaryCategory {
  key: string
  title: string
  position: number | null
  linkedFrom: {
    catalogCollection: {
      items: SecondaryCategory[]
    }
  }
}

// ─── Product Types ────────────────────────────────────────────────────────────

export interface Screenshot {
  id: string
  key: string
  value: string
}

export interface Distribution {
  key: string
  value: string[]
}

export interface ProductCatalogItem {
  key: string
  title: string
  catalogCollection?: {
    items: Array<{ key: string }>
  }
}

export interface Product {
  sys: { id: string }
  key: string
  hot?: number
  trademark: string
  summary?: string
  overview: string
  description?: string
  websiteurl?: string
  screenshots?: Screenshot[]
  distribution?: Distribution[]
  vcpu?: number
  memory?: number
  storage?: number
  logo?: { imageurl: string }
  catalogCollection: {
    items: ProductCatalogItem[]
  }
}

// ─── Computed/View Types ──────────────────────────────────────────────────────

export interface ProductWithCategories extends Product {
  primaryCategoryKey: string | null
  secondaryCategoryKeys: string[]
}

export interface StoreFilters {
  primaryCategory: string | null
  secondaryCategory: string | null
  search: string
  page: number
  pageSize: number
}

export const PAGE_SIZES = [30, 60, 120] as const
export type PageSize = (typeof PAGE_SIZES)[number]
