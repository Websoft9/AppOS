import type { Locale, Product } from './store-types'

const SEARCH_HISTORY_KEY = 'ws9-store-search-history'
const MAX_HISTORY = 10

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

export function getKeyColor(key: string): string {
  const palette = [
    '#3B82F6',
    '#10B981',
    '#F59E0B',
    '#EF4444',
    '#8B5CF6',
    '#06B6D4',
    '#84CC16',
    '#F97316',
    '#EC4899',
    '#6366F1',
    '#14B8A6',
    '#A855F7',
    '#0EA5E9',
    '#22C55E',
    '#EAB308',
  ]
  let hash = 0
  for (let index = 0; index < key.length; index++) {
    hash = key.charCodeAt(index) + ((hash << 5) - hash)
  }
  return palette[Math.abs(hash) % palette.length]
}

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
  const history = getSearchHistory().filter(item => item !== term)
  history.unshift(term)
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)))
}

export function clearSearchHistory(): void {
  localStorage.removeItem(SEARCH_HISTORY_KEY)
}

export function getSearchSuggestions(products: Product[], query: string): Product[] {
  if (!query.trim()) return []
  const normalizedQuery = query.trim().toLowerCase()

  const prefix: Product[] = []
  const contains: Product[] = []

  for (const product of products) {
    const name = product.trademark.toLowerCase()
    if (name.startsWith(normalizedQuery)) {
      prefix.push(product)
    } else if (
      name.includes(normalizedQuery) ||
      product.overview.toLowerCase().includes(normalizedQuery)
    ) {
      contains.push(product)
    }
    if (prefix.length + contains.length >= 10) break
  }

  return [...prefix, ...contains].slice(0, 10)
}
