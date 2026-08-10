import type { DetectionCandidate, Shop, Transaction, Voucher } from '../types'

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

export function extractCandidates(text: string): DetectionCandidate[] {
  const compact = text.replace(/[–—]/g, '-')
  const candidates: DetectionCandidate[] = []
  const labelled = [
    { label: 'PIN' as const, regex: /(?:pin|code)\s*[:#-]?\s*([A-Z0-9-]{4,16})/gi },
    { label: 'Nummer' as const, regex: /(?:gutschein(?:nummer)?|kartennummer|card\s*(?:no|number)|nummer)\s*[:#-]?\s*([A-Z0-9 -]{6,30})/gi }
  ]
  for (const item of labelled) {
    for (const match of compact.matchAll(item.regex)) candidates.push({ value: match[1].trim().replace(/\s{2,}/g, ' '), label: item.label, confidence: 0.88, source: 'Beschrifteter Text' })
  }
  if (!candidates.some((candidate) => candidate.label === 'Nummer')) {
    const fallback = compact.match(/\b(?:\d[ -]?){10,22}\b/)
    if (fallback) candidates.push({ value: fallback[0].replace(/[ -]/g, ''), label: 'Nummer', confidence: 0.54, source: 'Zahlenmuster' })
  }
  return candidates
}

export function canUndo(transaction: Transaction, all: Transaction[]) {
  return !all.some((entry) => entry.reversedTransactionId === transaction.id)
}

export function uid(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`
}
