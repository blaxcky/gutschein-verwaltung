import { describe, expect, it } from 'vitest'
import type { Shop, Transaction, Voucher } from '../types'
import { applyExpense, barcodeStorageFields, canUndo, extractCandidates, isImportValid, matchShop, parseMoney, selectVoucherNumber, sortVouchers } from './logic'

const voucher = (overrides: Partial<Voucher> = {}): Voucher => ({ id: 'v', shopId: 's', number: '123', pin: '', barcodeValue: '', barcodeFormat: '', initialAmountCents: 10000, remainingAmountCents: 10000, status: 'active', confidence: 90, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...overrides })

describe('money and voucher rules', () => {
  it('parses German comma amounts exactly in cents', () => {
    expect(parseMoney('12,34')).toBe(1234)
    expect(parseMoney('1.234,50')).toBe(123450)
    expect(parseMoney('-1,00')).toBeNull()
    expect(parseMoney('12,345')).toBeNull()
  })
  it('moves an empty voucher into verification, never below zero', () => {
    expect(applyExpense(voucher(), 10000)).toMatchObject({ remainingAmountCents: 0, status: 'verification_pending' })
    expect(() => applyExpense(voucher(), 10001)).toThrow('höher')
  })
  it('sorts by lowest remaining balance and puts zero last', () => {
    const values = [voucher({ id: 'a', remainingAmountCents: 0 }), voucher({ id: 'b', remainingAmountCents: 500 }), voucher({ id: 'c', remainingAmountCents: 200 })].sort(sortVouchers)
    expect(values.map((item) => item.id)).toEqual(['c', 'b', 'a'])
  })
})

describe('recognition suggestions', () => {
  const shops: Shop[] = [{ id: 's1', name: 'Buchhandlung Moser', detectionTerms: ['Buchgutschein'], defaultAmountCents: 5000, createdAt: '' }, { id: 's2', name: 'Kino Lichtspiel', detectionTerms: ['Kinogutschein'], defaultAmountCents: 3000, createdAt: '' }]
  it('matches editable shop terms', () => expect(matchShop('Ihr BUCHGUTSCHEIN von Moser', shops)?.id).toBe('s1'))
  it('extracts labelled number and PIN candidates', () => {
    const values = extractCandidates('Gutscheinnummer: 9988 7766 5544\nPIN: AX72')
    expect(values.find((item) => item.label === 'Nummer')?.confidence).toBeGreaterThan(.8)
    expect(values.find((item) => item.label === 'PIN')?.value).toBe('AX72')
  })
  it('does not mistake prose beginning with Gutscheine for a voucher number', () => {
    expect(selectVoucherNumber('Die PDF-Gutscheine sind ab sofort verfügbar.')).toBe('')
  })
  it.each([
    'Karten-Nr. 0126924863847602',
    'Karten-Nr.: 0126924863847602',
    'Kartennummer: 0126924863847602',
    'Gutscheinnummer: 0126924863847602',
    'Gutschein-Nr.: 0126924863847602'
  ])('recognizes supported number labels: %s', (text) => {
    expect(selectVoucherNumber(text)).toBe('0126924863847602')
  })
  it('prefers an OCR number contained in the full barcode without shortening the barcode', () => {
    const barcode = '0109100000963389210126924863847602'
    expect(selectVoucherNumber('Gutscheinnummer: 9999999999\n0126924863847602', barcode)).toBe('0126924863847602')
    expect(barcode).toBe('0109100000963389210126924863847602')
  })
  it('keeps a plausible labelled number even when the barcode is independent', () => {
    expect(selectVoucherNumber('Gutscheinnummer: AB-123456', 'QR:independent-payload')).toBe('AB123456')
  })
  it('keeps Lidl voucher number, printed barcode and PIN separate by position', () => {
    const text = 'LIDL Geschenkkarte\n2000123456789012\n0917123456789012\n4826'
    const lines = [
      { text: '2000123456789012', confidence: 92, bbox: { x0: 30, y0: 20, x1: 170, y1: 35 } },
      { text: '0917123456789012', confidence: 91, bbox: { x0: 30, y0: 85, x1: 170, y1: 100 } },
      { text: '4826', confidence: 90, bbox: { x0: 70, y0: 110, x1: 115, y1: 125 } }
    ]
    expect(selectVoucherNumber(text, '0917123456789012', { lines, barcodeRegion: { x0: 20, y0: 42, x1: 180, y1: 78 } })).toBe('2000123456789012')
    expect(extractCandidates(text).find((item) => item.label === 'PIN')?.value).toBe('4826')
  })
  it('excludes the OCR value used as the barcode from voucher-number selection', () => {
    expect(selectVoucherNumber('0917123456789012', '0917123456789012')).toBe('')
  })
  it.each([
    ['PIN Code: 2414', '2414'],
    ['PIN-Code: 5729', '5729'],
    ['PIN: AX72', 'AX72'],
    ['Code: 8642', '8642']
  ])('extracts the PIN from %s', (text, expected) => {
    expect(extractCandidates(text).find((item) => item.label === 'PIN')?.value).toBe(expected)
  })
  it('suggests the sole unlabelled four-digit value with low confidence', () => {
    const pin = extractCandidates('LIDL Geschenkkarte\nKartennummer 1234 5678 9012 3456\n0515').find((item) => item.label === 'PIN')
    expect(pin).toMatchObject({ value: '0515', source: 'Unbeschrifteter Viersteller' })
    expect(pin?.confidence).toBeLessThan(.5)
  })
  it('keeps leading zeroes and accepts repetitions of the same value', () => {
    expect(extractCandidates('0515\nKontrollfeld 0515').find((item) => item.label === 'PIN')?.value).toBe('0515')
  })
  it('prefers a labelled PIN over other four-digit values', () => {
    const pins = extractCandidates('Filiale 1234\nPIN Code: 2414').filter((item) => item.label === 'PIN')
    expect(pins).toHaveLength(1)
    expect(pins[0]).toMatchObject({ value: '2414', source: 'Beschrifteter Text' })
  })
  it('does not suggest ambiguous unlabelled four-digit values', () => {
    expect(extractCandidates('Filiale 1234\nBeleg 5678').some((item) => item.label === 'PIN')).toBe(false)
  })
  it('does not use an instruction reference as an unlabelled PIN', () => {
    expect(extractCandidates('Hotline 1234\nLIDL Geschenkkarte').some((item) => item.label === 'PIN')).toBe(false)
  })
  it.each([
    'Barcode 1234567890123',
    'Gutscheinnummer 1234 5678 9012 3456',
    'Wert: 1000 EUR',
    '€ 2500',
    'Betrag: 1500',
    'Guthaben 1200,00 €'
  ])('does not use long numbers or money as an unlabelled PIN: %s', (text) => {
    expect(extractCandidates(text).some((item) => item.label === 'PIN')).toBe(false)
  })
})

describe('import identifiers', () => {
  it('accepts barcode-only imports but rejects imports without any identifier', () => {
    expect(isImportValid('shop', '', 'barcode-payload', 1000)).toBe(true)
    expect(isImportValid('shop', '', '', 1000)).toBe(false)
  })
  it('does not synthesize barcode data from a voucher number', () => {
    expect(barcodeStorageFields('', '')).toEqual({ barcodeValue: '', barcodeFormat: '' })
    expect(barcodeStorageFields(' 0123456789 ', 'Code128')).toEqual({ barcodeValue: '0123456789', barcodeFormat: 'Code128' })
  })
  it('stores corrected fallback values and clears the format when deleted', () => {
    expect(barcodeStorageFields('0917000000009999', 'Code128')).toEqual({ barcodeValue: '0917000000009999', barcodeFormat: 'Code128' })
    expect(barcodeStorageFields('   ', 'Code128')).toEqual({ barcodeValue: '', barcodeFormat: '' })
  })
})

describe('undo bookkeeping', () => {
  const expense: Transaction = { id: 't1', voucherId: 'v', type: 'expense', amountCents: 500, previousBalanceCents: 1000, newBalanceCents: 500, createdAt: '' }
  it('allows an unreversed transaction once', () => {
    expect(canUndo(expense, [expense])).toBe(true)
    expect(canUndo(expense, [expense, { ...expense, id: 't2', type: 'reversal', reversedTransactionId: 't1' }])).toBe(false)
  })
})
