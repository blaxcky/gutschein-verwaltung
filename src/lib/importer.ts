import { readBarcodesFromImageFile } from '@sec-ant/zxing-wasm/reader'
import * as pdfjs from 'pdfjs-dist'
import { createWorker, type Worker } from 'tesseract.js'
import workerUrl from 'tesseract.js/dist/worker.min.js?url'
import coreUrl from 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { ImportDraft, Shop } from '../types'
import { extractCandidates, matchShop, selectVoucherNumber } from './logic'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
let ocrWorker: Worker | null = null

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
  bitmap.close()
  return canvas
}

async function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Vorschau konnte nicht erstellt werden.')), 'image/jpeg', 0.9))
}

async function processPdf(file: File, onProgress?: (progress: number, status: string) => void) {
  const pdfDocument = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  let text = ''
  let firstPageBlob: Blob | null = null
  let barcodeValue = ''
  let barcodeFormat = ''
  let sourcePage = 1
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
    if (!barcodeValue) {
      const codes = await readBarcodesFromImageFile(blob, { tryHarder: true, maxSymbols: 3 })
      if (codes[0]?.text) { barcodeValue = codes[0].text; barcodeFormat = codes[0].format; sourcePage = index }
    }
    if (text.trim().length < 40) {
      const result = await (await getOcrWorker(onProgress)).recognize(canvas)
      text += `\n${result.data.text}`
    }
  }
  if (!firstPageBlob) throw new Error('Das PDF enthält keine lesbare Seite.')
  return { text, previewUrl: URL.createObjectURL(firstPageBlob), barcodeValue, barcodeFormat, sourcePage }
}

async function processImage(file: File, onProgress?: (progress: number, status: string) => void) {
  const canvas = await imageToCanvas(file)
  const normalized = await canvasToBlob(canvas)
  onProgress?.(0.2, 'Barcode wird gesucht')
  const codes = await readBarcodesFromImageFile(normalized, { tryHarder: true, maxSymbols: 3 })
  onProgress?.(0.4, 'Text wird lokal erkannt')
  const result = await (await getOcrWorker(onProgress)).recognize(canvas)
  return { text: result.data.text, previewUrl: URL.createObjectURL(normalized), barcodeValue: codes[0]?.text ?? '', barcodeFormat: codes[0]?.format ?? '', sourcePage: 1 }
}

export async function inspectFile(file: File, shops: Shop[], duplicate: boolean, onProgress?: (progress: number, status: string) => void): Promise<ImportDraft> {
  const hash = await sha256(file)
  const result = file.type === 'application/pdf' ? await processPdf(file, onProgress) : await processImage(file, onProgress)
  const shop = matchShop(`${result.text} ${result.barcodeValue}`, shops)
  const candidates = extractCandidates(result.text)
  if (result.barcodeValue) candidates.unshift({ value: result.barcodeValue, label: 'Barcode', confidence: 0.96, source: `Seite ${result.sourcePage}` })
  const number = selectVoucherNumber(result.text, result.barcodeValue)
  const pinCandidate = candidates.find((candidate) => candidate.label === 'PIN')
  const pin = pinCandidate?.value ?? ''
  const pinContribution = pinCandidate ? 0.16 * (pinCandidate.confidence / 0.88) : 0
  const confidenceLimit = result.barcodeValue ? 0.96 : pinCandidate?.source === 'Unbeschrifteter Viersteller' ? 0.62 : 0.7
  const confidence = Math.round(100 * Math.min(confidenceLimit, (shop ? 0.18 : 0) + (number || result.barcodeValue ? 0.58 : 0) + pinContribution))
  return { file, hash, duplicate, ...result, shopId: shop?.id ?? '', number, pin, amountCents: shop?.defaultAmountCents ?? 10000, confidence, candidates }
}

export async function terminateImporter() {
  await ocrWorker?.terminate()
  ocrWorker = null
}
