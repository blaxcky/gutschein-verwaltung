import type { BarcodeSource, OcrLine, RecognitionBox } from '../types'

interface PixelData {
  data: Uint8ClampedArray
  width: number
  height: number
}

interface PositionedWord {
  text: string
  confidence: number
  bbox: RecognitionBox
}

export function splitOcrLine(words: PositionedWord[], fallback: OcrLine): OcrLine[] {
  if (words.length < 2) return [fallback]
  const sorted = [...words].sort((a, b) => a.bbox.x0 - b.bbox.x0)
  const typicalHeight = [...sorted].map((word) => word.bbox.y1 - word.bbox.y0).sort((a, b) => a - b)[Math.floor(sorted.length / 2)]
  const splitGap = Math.max(32, typicalHeight * 2.5)
  const groups: PositionedWord[][] = []
  for (const word of sorted) {
    const group = groups.at(-1)
    if (!group || word.bbox.x0 - group.at(-1)!.bbox.x1 > splitGap) groups.push([word])
    else group.push(word)
  }
  return groups.map((group) => ({
    text: group.map((word) => word.text).join(' ').trim(),
    confidence: group.reduce((sum, word) => sum + word.confidence, 0) / group.length,
    bbox: {
      x0: Math.min(...group.map((word) => word.bbox.x0)),
      y0: Math.min(...group.map((word) => word.bbox.y0)),
      x1: Math.max(...group.map((word) => word.bbox.x1)),
      y1: Math.max(...group.map((word) => word.bbox.y1))
    }
  }))
}

function overlapRatio(a: RecognitionBox, b: RecognitionBox) {
  const overlap = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0))
  return overlap / Math.max(1, Math.min(a.x1 - a.x0, b.x1 - b.x0))
}

export function digitsFromLine(text: string) {
  if (!/^\s*\d(?:[ \t-]*\d){9,29}\s*$/.test(text)) return ''
  return text.replace(/\D/g, '')
}

export function findPrintedBarcode(lines: OcrLine[], regions: RecognitionBox[]) {
  const matches = regions.flatMap((region) => lines.flatMap((line) => {
    const value = digitsFromLine(line.text)
    const lineHeight = Math.max(1, line.bbox.y1 - line.bbox.y0)
    const regionHeight = Math.max(1, region.y1 - region.y0)
    const gap = line.bbox.y0 - region.y1
    const directlyBelow = gap >= -lineHeight * 0.25 && gap <= Math.max(lineHeight * 3, regionHeight * 0.85)
    if (!value || !directlyBelow || overlapRatio(line.bbox, region) < 0.45) return []
    return [{ value, region, line, gap: Math.max(0, gap) }]
  }))
  const values = [...new Set(matches.map((match) => match.value))]
  if (values.length !== 1) return undefined
  return matches.filter((match) => match.value === values[0]).sort((a, b) => a.gap - b.gap)[0]
}

interface DecodedBarcode {
  value: string
  format: string
  region: RecognitionBox
}

interface PrintedBarcode {
  value: string
  region: RecognitionBox
}

export function resolveBarcode(decoded?: DecodedBarcode, printed?: PrintedBarcode): {
  barcodeValue: string
  barcodeFormat: string
  barcodeSource?: BarcodeSource
  barcodeRegion?: RecognitionBox
} {
  if (decoded) return { barcodeValue: decoded.value, barcodeFormat: decoded.format, barcodeSource: 'decoded', barcodeRegion: decoded.region }
  if (printed) return { barcodeValue: printed.value, barcodeFormat: 'Code128', barcodeSource: 'printed-text', barcodeRegion: printed.region }
  return { barcodeValue: '', barcodeFormat: '' }
}

export function findBarcodeRegions(image: PixelData): RecognitionBox[] {
  if (image.width < 40 || image.height < 20) return []
  const luminance = (x: number, y: number) => {
    const index = (y * image.width + x) * 4
    return image.data[index] * 0.299 + image.data[index + 1] * 0.587 + image.data[index + 2] * 0.114
  }
  const sampleStep = Math.max(1, Math.floor(image.width / 900))
  const activeRows: number[] = []
  for (let y = 0; y < image.height; y++) {
    let transitions = 0
    let dark = 0
    let previous = luminance(0, y) < 150
    for (let x = sampleStep; x < image.width; x += sampleStep) {
      const current = luminance(x, y) < 150
      if (current) dark++
      if (current !== previous) transitions++
      previous = current
    }
    const samples = Math.ceil(image.width / sampleStep)
    const darkRatio = dark / samples
    if (transitions >= Math.max(18, samples * 0.055) && darkRatio > 0.04 && darkRatio < 0.82) activeRows.push(y)
  }

  const bands: Array<{ start: number; end: number }> = []
  for (const y of activeRows) {
    const last = bands.at(-1)
    if (!last || y > last.end + 2) bands.push({ start: y, end: y })
    else last.end = y
  }

  return bands.flatMap((band) => {
    if (band.end - band.start + 1 < Math.max(8, image.height * 0.008)) return []
    const columnScores: number[] = []
    for (let x = 0; x < image.width; x++) {
      let dark = 0
      for (let y = band.start; y <= band.end; y++) if (luminance(x, y) < 150) dark++
      columnScores.push(dark / (band.end - band.start + 1))
    }
    // Barcode bars stay dark through most of the band; ordinary letter shapes do not.
    const activeColumns = columnScores.flatMap((score, x) => score > 0.58 ? [x] : [])
    if (!activeColumns.length) return []
    const x0 = Math.max(0, activeColumns[0] - 4)
    const x1 = Math.min(image.width, activeColumns.at(-1)! + 5)
    if (x1 - x0 < image.width * 0.18) return []
    return [{ x0, y0: band.start, x1, y1: band.end + 1 }]
  })
}
