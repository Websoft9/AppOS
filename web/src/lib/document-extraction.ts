import type { TextItem } from 'pdfjs-dist/types/src/display/api'

const DOCUMENT_BYTES_LIMIT = 10 * 1024 * 1024 // 10 MB

type PdfJsModule = typeof import('pdfjs-dist')
type SpreadsheetSheet = import('read-excel-file/browser').Sheet<number>

let pdfJsAssetsPromise: Promise<{
  pdfjsLib: PdfJsModule
  standardFontDataUrl: string
}> | null = null

function isTextItem(item: TextItem | { type: string }): item is TextItem {
  return 'str' in item && typeof (item as TextItem).str === 'string'
}

export function isPdfFile(file: File): boolean {
  if (file.type === 'application/pdf') return true
  return file.name.toLowerCase().endsWith('.pdf')
}

export function isDocxFile(file: File): boolean {
  if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    return true
  return file.name.toLowerCase().endsWith('.docx')
}

export function isSpreadsheetFile(file: File): boolean {
  if (
    file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    file.type === 'application/vnd.ms-excel.sheet.macroEnabled.12' ||
    file.type === 'text/csv' ||
    file.type === 'application/csv'
  ) {
    return true
  }

  const name = file.name.toLowerCase()
  return name.endsWith('.xlsx') || name.endsWith('.xlsm') || name.endsWith('.csv')
}

function spreadsheetCellText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.text === 'string') return record.text
    if (record.result != null) return spreadsheetCellText(record.result)
    if (typeof record.hyperlink === 'string') return record.hyperlink
    if (Array.isArray(record.richText)) {
      return record.richText
        .map(item =>
          item && typeof item === 'object' && 'text' in item ? String(item.text ?? '') : ''
        )
        .join('')
    }
  }
  return JSON.stringify(value)
}

function csvCell(text: string): string {
  if (!/[",\n]/.test(text)) return text
  return `"${text.replaceAll('"', '""')}"`
}

function spreadsheetRowsToText(
  rows: unknown[][],
  options: { includeSheetHeading: boolean; sheetName: string }
): string {
  const lines = rows
    .map(row =>
      row
        .map(value => csvCell(spreadsheetCellText(value)))
        .join(',')
        .trimEnd()
    )
    .filter(line => line.trim())
  if (lines.length === 0) return ''
  const csv = lines.join('\n')
  return options.includeSheetHeading ? `# ${options.sheetName}\n${csv}` : csv
}

async function loadPdfJs() {
  if (!pdfJsAssetsPromise) {
    pdfJsAssetsPromise = Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.min.mjs'),
      import('pdfjs-dist/standard_fonts/FoxitFixed.pfb?url'),
    ]).then(([pdfjsLib, workerModule, fontAsset]) => {
      ;(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = workerModule
      const fontURL = new URL(fontAsset.default, window.location.origin)
      fontURL.pathname = fontURL.pathname.slice(0, fontURL.pathname.lastIndexOf('/') + 1)
      return {
        pdfjsLib: pdfjsLib as PdfJsModule,
        standardFontDataUrl: fontURL.toString(),
      }
    })
  }
  return pdfJsAssetsPromise
}

export async function extractPdfText(file: File): Promise<string> {
  if (file.size > DOCUMENT_BYTES_LIMIT) {
    throw new Error('PDF file too large')
  }

  const { pdfjsLib, standardFontDataUrl } = await loadPdfJs()

  const arrayBuffer = await file.arrayBuffer()
  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    standardFontDataUrl,
  } as unknown as Parameters<typeof pdfjsLib.getDocument>[0]).promise

  const parts: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items
      .filter(isTextItem)
      .map(item => item.str)
      .join(' ')
    if (pageText.trim()) parts.push(pageText)
  }

  return parts.join('\n\n').trim()
}

export async function extractDocxText(file: File): Promise<string> {
  if (file.size > DOCUMENT_BYTES_LIMIT) {
    throw new Error('DOCX file too large')
  }

  const mammoth = await import('mammoth')
  const arrayBuffer = await file.arrayBuffer()
  const result = await mammoth.extractRawText({ arrayBuffer })
  return result.value.trim()
}

export async function extractSpreadsheetText(file: File): Promise<string> {
  if (file.size > DOCUMENT_BYTES_LIMIT) {
    throw new Error('Spreadsheet file too large')
  }

  if (
    file.name.toLowerCase().endsWith('.csv') ||
    file.type === 'text/csv' ||
    file.type === 'application/csv'
  ) {
    return (await file.text()).trim()
  }

  const { default: readXlsxFile } = await import('read-excel-file/browser')
  const arrayBuffer = await file.arrayBuffer()
  const blob = new Blob([arrayBuffer], { type: file.type || 'application/octet-stream' })
  const sheets = (await readXlsxFile(blob)) as SpreadsheetSheet[]
  const parts = sheets
    .map(sheet =>
      spreadsheetRowsToText(sheet.data, {
        includeSheetHeading: sheets.length > 1,
        sheetName: sheet.sheet,
      })
    )
    .filter(Boolean)

  return parts.join('\n\n').trim()
}
