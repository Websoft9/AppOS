/**
 * Shared extension-token normalization utilities.
 *
 * Used by both the Space page (upload validation) and the Settings page
 * (allow/deny list editing).  Keeping a single source avoids divergence.
 */

/** Normalize a single extension value: trim, lowercase, strip leading dot, apply aliases. */
export function normalizeExtToken(v: string): string {
  const raw = v.trim().toLowerCase().replace(/^\./, '')
  if (!raw) return ''
  if (raw === 'python') return 'py'
  return raw
}

/** Parse a comma-separated extension input string into a deduplicated token array. */
export function parseExtListInput(v: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of v.split(',')) {
    const token = normalizeExtToken(part)
    if (!token || seen.has(token)) continue
    seen.add(token)
    out.push(token)
  }
  return out
}

/** Format an extension array into a human-readable hint (max 8 shown). */
export function formatExtListHint(exts: string[]): string {
  if (exts.length === 0) return ''
  const shown = exts.slice(0, 8).map(v => `.${v}`).join(', ')
  if (exts.length <= 8) return shown
  return `${shown}, +${exts.length - 8} more`
}
