import type { DetectionCandidate, OcrLine, RecognitionBox, Shop, Transaction, Voucher } from '../types'

export const formatMoney = (cents: number) =>
  new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(cents / 100)

export function parseMoney(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.')
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return null
  const cents = Math.round(Number(normalized) * 100)
  return Number.isSafeInteger(cents) ? cents : null
}

export function applyExpense(voucher: Voucher, cents: number): Voucher {
  if (!Number.isInteger(cents) || cents <= 0) throw new Error('Bitte einen positiven Betrag eingeben.')
  if (cents > voucher.remainingAmountCents) throw new Error('Der Betrag ist höher als das Restguthaben.')
  const remainingAmountCents = voucher.remainingAmountCents - cents
  return { ...voucher, remainingAmountCents, status: remainingAmountCents === 0 ? 'verification_pending' : voucher.status, updatedAt: new Date().toISOString() }
}

export function sortVouchers(a: Voucher, b: Voucher): number {
  if ((a.remainingAmountCents === 0) !== (b.remainingAmountCents === 0)) return a.remainingAmountCents === 0 ? 1 : -1
  return a.remainingAmountCents - b.remainingAmountCents || a.createdAt.localeCompare(b.createdAt)
}

export function matchShop(text: string, shops: Shop[]): Shop | undefined {
  const haystack = text.toLocaleLowerCase('de')
  const best = shops
    .map((shop) => ({ shop, score: [shop.name, ...shop.detectionTerms].filter((term) => term && haystack.includes(term.toLocaleLowerCase('de'))).length }))
    .sort((a, b) => b.score - a.score)[0]
  return best?.score ? best.shop : undefined
}

export function normalizeVoucherNumber(value: string) {
  return value.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '').toLocaleUpperCase('de')
}

function plausibleVoucherNumber(value: string) {
  const normalized = normalizeVoucherNumber(value)
  return normalized.length >= 6 && normalized.length <= 30 && /\d/.test(normalized)
}

export function extractCandidates(text: string): DetectionCandidate[] {
  const compact = text.replace(/[–—]/g, '-')
  const candidates: DetectionCandidate[] = []
  const labelled = [
    { label: 'PIN' as const, regex: /(?:\bpin(?:\s*-?\s*code)?|\bcode)\s*[:#-]?\s*([A-Z0-9-]{4,16})/gi },
    { label: 'Nummer' as const, regex: /(?:\bgutscheinnummer\b|\bgutschein\s*-\s*nr\.?(?=\s|[:#-]|$)|\bkartennummer\b|\bkarten\s*-\s*nr\.?(?=\s|[:#-]|$)|\bcard\s*(?:no\.?|number)\b|\bnummer\b)\s*[:#-]?\s*([A-Z0-9](?:[A-Z0-9 \t-]{4,28}[A-Z0-9])?)/gi }
  ]
  for (const item of labelled) {
    for (const match of compact.matchAll(item.regex)) {
      const value = item.label === 'Nummer' ? normalizeVoucherNumber(match[1]) : match[1].trim().replace(/\s{2,}/g, ' ')
      if (item.label === 'PIN' || plausibleVoucherNumber(value)) candidates.push({ value, label: item.label, confidence: 0.88, source: 'Beschrifteter Text' })
    }
  }
  if (!candidates.some((candidate) => candidate.label === 'PIN')) {
    const longNumberRanges = [...compact.matchAll(/(?<!\d)\d(?:[ \t-]*\d){4,}(?!\d)/g)]
      .map((match) => ({ start: match.index, end: match.index + match[0].length }))
    const unlabelledPins = [...compact.matchAll(/(?<!\d)\d{4}(?!\d)/g)]
      .filter((match) => {
        const start = match.index
        const end = start + match[0].length
        if (longNumberRanges.some((range) => start >= range.start && end <= range.end)) return false

        const before = compact.slice(Math.max(0, start - 24), start)
        const after = compact.slice(end, end + 16)
        const moneyBefore = /(?:€|\b(?:eur|euro)|\b(?:betrag|wert|guthaben)\s*:?)[ \t]*$/i.test(before)
        const moneyAfter = /^(?:[.,]\d{2})?[ \t]*(?:€|(?:eur|euro)\b)/i.test(after)
        const referenceBefore = /\b(?:filiale|beleg|kasse|artikel|transaktion|telefon|hotline|plz|schritt|datum|uhr)\s*(?:nr\.?|nummer)?\s*[:#-]?\s*$/i.test(before)
        return !moneyBefore && !moneyAfter && !referenceBefore
      })
      .map((match) => match[0])
    const distinctPins = [...new Set(unlabelledPins)]
    if (distinctPins.length === 1) candidates.push({ value: distinctPins[0], label: 'PIN', confidence: 0.42, source: 'Unbeschrifteter Viersteller' })
  }
  for (const match of compact.matchAll(/(?<!\d)\d(?:[ \t-]*\d){9,29}(?!\d)/g)) {
    const value = normalizeVoucherNumber(match[0])
    if (plausibleVoucherNumber(value) && !candidates.some((candidate) => candidate.label === 'Nummer' && candidate.value === value)) {
      candidates.push({ value, label: 'Nummer', confidence: 0.54, source: 'Zahlenmuster' })
    }
  }
  return candidates
}

interface VoucherNumberLayout {
  lines: OcrLine[]
  barcodeRegion?: RecognitionBox
}

export function selectVoucherNumber(text: string, barcodeValue = '', layout?: VoucherNumberLayout) {
  const barcode = normalizeVoucherNumber(barcodeValue)
  const numbers = extractCandidates(text).filter((candidate) => candidate.label === 'Nummer' && normalizeVoucherNumber(candidate.value) !== barcode)
  const above = layout?.barcodeRegion ? layout.lines.flatMap((line) => {
    const region = layout.barcodeRegion!
    const value = normalizeVoucherNumber(line.text)
    const lineHeight = line.bbox.y1 - line.bbox.y0
    const gap = region.y0 - line.bbox.y1
    const horizontalOverlap = Math.max(0, Math.min(line.bbox.x1, region.x1) - Math.max(line.bbox.x0, region.x0))
    const overlaps = horizontalOverlap / Math.max(1, Math.min(line.bbox.x1 - line.bbox.x0, region.x1 - region.x0))
    return plausibleVoucherNumber(value) && value !== barcode && gap >= -lineHeight * 0.25 && gap <= Math.max(160, lineHeight * 5) && overlaps >= 0.35
      ? [{ value, gap: Math.max(0, gap) }]
      : []
  }).sort((a, b) => a.gap - b.gap)[0]?.value : undefined
  const matching = barcode ? numbers.find((candidate) => barcode.includes(normalizeVoucherNumber(candidate.value)) || normalizeVoucherNumber(candidate.value).includes(barcode)) : undefined
  return above
    ?? matching?.value
    ?? numbers.find((candidate) => candidate.source === 'Beschrifteter Text')?.value
    ?? numbers.find((candidate) => candidate.source === 'Zahlenmuster')?.value
    ?? ''
}

export function isImportValid(shopId: string, number: string, barcodeValue: string, amountCents: number | null) {
  return Boolean(shopId && (number.trim() || barcodeValue.trim()) && amountCents !== null && amountCents > 0)
}

export function barcodeStorageFields(barcodeValue: string, barcodeFormat: string) {
  const value = barcodeValue.trim()
  return { barcodeValue: value, barcodeFormat: value ? barcodeFormat : '' }
}

export function canUndo(transaction: Transaction, all: Transaction[]) {
  return !all.some((entry) => entry.reversedTransactionId === transaction.id)
}

export function uid(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`
}
