import type { TextItem } from 'pdfjs-dist/types/src/display/api'

const DOCUMENT_BYTES_LIMIT = 10 * 1024 * 1024 // 10 MB

type PdfJsModule = typeof import('pdfjs-dist')

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
  if (
    file.type ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
    return true
  return file.name.toLowerCase().endsWith('.docx')
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
