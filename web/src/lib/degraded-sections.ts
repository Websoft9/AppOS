export type SectionResult = {
  section: string
  result: PromiseSettledResult<unknown>
}

export type RejectedSection = {
  section: string
  message: string
}

function formatRejectedReason(reason: unknown): string {
  if (reason instanceof Error && reason.message.trim()) {
    return reason.message
  }
  if (typeof reason === 'string' && reason.trim()) {
    return reason
  }
  return 'Unknown error'
}

export function getRejectedSections(entries: SectionResult[]): RejectedSection[] {
  return entries.flatMap(entry =>
    entry.result.status === 'rejected'
      ? [{ section: entry.section, message: formatRejectedReason(entry.result.reason) }]
      : []
  )
}

export function warnDegradedSections(scope: string, sections: RejectedSection[]) {
  if (sections.length === 0) return
  console.warn(`${scope} degraded data sources`, sections)
}
