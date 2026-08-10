import { describe, expect, it } from 'vitest'
import type { Shop, Transaction, Voucher } from '../types'
import { applyExpense, canUndo, extractCandidates, matchShop, parseMoney, sortVouchers } from './logic'

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
})

describe('undo bookkeeping', () => {
  const expense: Transaction = { id: 't1', voucherId: 'v', type: 'expense', amountCents: 500, previousBalanceCents: 1000, newBalanceCents: 500, createdAt: '' }
  it('allows an unreversed transaction once', () => {
    expect(canUndo(expense, [expense])).toBe(true)
    expect(canUndo(expense, [expense, { ...expense, id: 't2', type: 'reversal', reversedTransactionId: 't1' }])).toBe(false)
  })
})
