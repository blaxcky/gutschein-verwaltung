import { readBarcodesFromImageData, readBarcodesFromImageFile, type ZXingReadOutput } from '@sec-ant/zxing-wasm/reader'
import * as pdfjs from 'pdfjs-dist'
import { createWorker, type Worker } from 'tesseract.js'
import workerUrl from 'tesseract.js/dist/worker.min.js?url'
import coreUrl from 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { BarcodeSource, ImportDraft, OcrLine, RecognitionBox, Shop } from '../types'
import { extractCandidates, matchShop, selectVoucherNumber } from './logic'
import { findBarcodeRegions, findPrintedBarcode, resolveBarcode, splitOcrLine } from './recognition'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
let ocrWorker: Worker | null = null

interface CanvasAnalysis {
  text: string
  lines: OcrLine[]
  decoded?: { value: string; format: string; region: RecognitionBox }
  printed?: { value: string; region: RecognitionBox }
}

interface ProcessedFile {
  text: string
  lines: OcrLine[]
  previewUrl: string
  barcodeValue: string
  barcodeFormat: string
  barcodeSource?: BarcodeSource
  barcodeRegion?: RecognitionBox
  sourcePage: number
}

export async function sha256(file: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function getOcrWorker(onProgress?: (progress: number, status: string) => void) {
  if (!ocrWorker) {
    ocrWorker = await createWorker(['deu', 'eng'], 1, {
      workerPath: workerUrl,
      corePath: coreUrl,
      langPath: `${import.meta.env.BASE_URL}ocr`,
      logger: (message) => onProgress?.(message.progress, message.status)
    })
  }
  return ocrWorker
}

async function imageToCanvas(file: Blob) {
  const bitmap = await createImageBitmap(file)
  const maxEdge = 1800
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d', { alpha: false })?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const originalSize = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return { canvas, originalSize }
}

async function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Vorschau konnte nicht erstellt werden.')), 'image/jpeg', 0.9))
}

function resultRegion(code: ZXingReadOutput, offsetX = 0, offsetY = 0, scaleX = 1, scaleY = 1): RecognitionBox {
  const points = Object.values(code.position)
  return {
    x0: Math.min(...points.map((point) => point.x)) * scaleX + offsetX,
    y0: Math.min(...points.map((point) => point.y)) * scaleY + offsetY,
    x1: Math.max(...points.map((point) => point.x)) * scaleX + offsetX,
    y1: Math.max(...points.map((point) => point.y)) * scaleY + offsetY
  }
}

async function scanEncoded(file: Blob) {
  try { return await readBarcodesFromImageFile(file, { tryHarder: true, maxSymbols: 3 }) }
  catch { return [] }
}

async function scanPixels(image: ImageData) {
  try { return await readBarcodesFromImageData(image, { tryHarder: true, maxSymbols: 3 }) }
  catch { return [] }
}

async function analyzeCanvas(canvas: HTMLCanvasElement, onProgress?: (progress: number, status: string) => void, original?: { file: Blob; width: number; height: number }): Promise<CanvasAnalysis> {
  const context = canvas.getContext('2d', { alpha: false })!
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
  const regions = findBarcodeRegions(pixels)
  let decoded: CanvasAnalysis['decoded']

  if (original) {
    const codes = await scanEncoded(original.file)
    const code = codes.find((candidate) => candidate.text)
    if (code) decoded = {
      value: code.text,
      format: code.format,
      region: resultRegion(code, 0, 0, canvas.width / original.width, canvas.height / original.height)
    }
  }

  if (!decoded) {
    const code = (await scanPixels(pixels)).find((candidate) => candidate.text)
    if (code) decoded = { value: code.text, format: code.format, region: resultRegion(code) }
  }

  for (const region of regions) {
    if (decoded) break
    const padding = Math.max(8, Math.round((region.y1 - region.y0) * 0.2))
    const x = Math.max(0, Math.floor(region.x0 - padding))
    const y = Math.max(0, Math.floor(region.y0 - padding))
    const width = Math.min(canvas.width - x, Math.ceil(region.x1 - region.x0 + padding * 2))
    const height = Math.min(canvas.height - y, Math.ceil(region.y1 - region.y0 + padding * 2))
    const code = (await scanPixels(context.getImageData(x, y, width, height))).find((candidate) => candidate.text)
    if (code) decoded = { value: code.text, format: code.format, region: resultRegion(code, x, y) }
  }

  onProgress?.(0.4, 'Text wird lokal erkannt')
  const result = await (await getOcrWorker(onProgress)).recognize(canvas, {}, { text: true, blocks: true })
  const lines = (result.data.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => splitOcrLine(
    line.words.map((word) => ({ text: word.text, confidence: word.confidence, bbox: word.bbox })),
    { text: line.text.trim(), confidence: line.confidence, bbox: line.bbox }
  )))).filter((line) => line.text)
  const printed = decoded ? undefined : findPrintedBarcode(lines, regions)
  return { text: lines.map((line) => line.text).join('\n') || result.data.text, lines, decoded, printed: printed ? { value: printed.value, region: printed.region } : undefined }
}

async function processPdf(file: File, onProgress?: (progress: number, status: string) => void): Promise<ProcessedFile> {
  const pdfDocument = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  let text = ''
  let firstPageBlob: Blob | null = null
  const analyses: Array<CanvasAnalysis & { page: number }> = []
  const pages = Math.min(pdfDocument.numPages, 5)
  for (let index = 1; index <= pages; index++) {
    onProgress?.((index - 1) / pages, `PDF-Seite ${index} von ${pages}`)
    const page = await pdfDocument.getPage(index)
    const content = await page.getTextContent()
    text += `\n${content.items.map((item) => 'str' in item ? item.str : '').join(' ')}`
    const viewport = page.getViewport({ scale: 1.7 })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    await page.render({ canvas, canvasContext: canvas.getContext('2d', { alpha: false })!, viewport }).promise
    const blob = await canvasToBlob(canvas)
    if (!firstPageBlob) firstPageBlob = blob
    const analysis = await analyzeCanvas(canvas, onProgress)
    text += `\n${analysis.text}`
    analyses.push({ ...analysis, page: index })
  }
  if (!firstPageBlob) throw new Error('Das PDF enthält keine lesbare Seite.')
  const selected = analyses.find((analysis) => analysis.decoded) ?? analyses.find((analysis) => analysis.printed) ?? analyses[0]
  return {
    text,
    lines: selected?.lines ?? [],
    previewUrl: URL.createObjectURL(firstPageBlob),
    ...resolveBarcode(selected?.decoded, selected?.printed),
    sourcePage: selected.page
  }
}

async function processImage(file: File, onProgress?: (progress: number, status: string) => void): Promise<ProcessedFile> {
  const { canvas, originalSize } = await imageToCanvas(file)
  onProgress?.(0.2, 'Barcode wird gesucht')
  const analysis = await analyzeCanvas(canvas, onProgress, { file, ...originalSize })
  const preview = await canvasToBlob(canvas)
  return { text: analysis.text, lines: analysis.lines, previewUrl: URL.createObjectURL(preview), ...resolveBarcode(analysis.decoded, analysis.printed), sourcePage: 1 }
}

export async function inspectFile(file: File, shops: Shop[], duplicate: boolean, onProgress?: (progress: number, status: string) => void): Promise<ImportDraft> {
  const hash = await sha256(file)
  const result = file.type === 'application/pdf' ? await processPdf(file, onProgress) : await processImage(file, onProgress)
  const shop = matchShop(`${result.text} ${result.barcodeValue}`, shops)
  const candidates = extractCandidates(result.text)
  if (result.barcodeValue) candidates.unshift({
    value: result.barcodeValue,
    label: 'Barcode',
    confidence: result.barcodeSource === 'decoded' ? 0.96 : 0.58,
    source: result.barcodeSource === 'decoded' ? `Seite ${result.sourcePage}` : 'Aus Drucktext abgeleitet'
  })
  const number = selectVoucherNumber(result.text, result.barcodeValue, { lines: result.lines, barcodeRegion: result.barcodeRegion })
  const pinCandidate = candidates.find((candidate) => candidate.label === 'PIN')
  const pin = pinCandidate?.value ?? ''
  const pinContribution = pinCandidate ? 0.16 * (pinCandidate.confidence / 0.88) : 0
  const confidenceLimit = result.barcodeSource === 'decoded' ? 0.96 : result.barcodeSource === 'printed-text' ? 0.68 : pinCandidate?.source === 'Unbeschrifteter Viersteller' ? 0.62 : 0.7
  const confidence = Math.round(100 * Math.min(confidenceLimit, (shop ? 0.18 : 0) + (number || result.barcodeValue ? 0.58 : 0) + pinContribution))
  const draftResult = {
    text: result.text,
    previewUrl: result.previewUrl,
    barcodeValue: result.barcodeValue,
    barcodeFormat: result.barcodeFormat,
    barcodeSource: result.barcodeSource,
    sourcePage: result.sourcePage
  }
  return { file, hash, duplicate, ...draftResult, shopId: shop?.id ?? '', number, pin, amountCents: shop?.defaultAmountCents ?? 10000, confidence, candidates }
}

export async function terminateImporter() {
  await ocrWorker?.terminate()
  ocrWorker = null
}
