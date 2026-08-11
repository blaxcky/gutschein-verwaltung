import { afterEach, describe, expect, it } from 'vitest'
import { GutscheinboxDB } from './db'
import type { VoucherStatus } from './types'

let database: GutscheinboxDB | undefined
afterEach(async () => { await database?.delete(); database = undefined })

describe('IndexedDB schema', () => {
  it('stores stable relations and finds duplicate hashes', async () => {
    database = new GutscheinboxDB(`test-${crypto.randomUUID()}`)
    await database.shops.add({ id: 'shop-stable', name: 'Papier & Wort', detectionTerms: ['Papier'], defaultAmountCents: 2500, createdAt: '2026-01-01' })
    await database.sourceFiles.add({ id: 'source-stable', name: 'gutschein.pdf', mimeType: 'application/pdf', size: 3, hash: 'same-hash', content: new Blob(['pdf']), createdAt: '2026-01-01' })
    expect(await database.shops.get('shop-stable')).toMatchObject({ defaultAmountCents: 2500 })
    expect((await database.sourceFiles.where('hash').equals('same-hash').first())?.id).toBe('source-stable')
  })

  it('deletes a shop without assigned vouchers', async () => {
    database = new GutscheinboxDB(`test-${crypto.randomUUID()}`)
    await database.shops.add({ id: 'unused', name: 'Freie Auswahl', detectionTerms: [], defaultAmountCents: 5000, createdAt: '2026-01-01' })

    await expect(database.deleteShopIfUnused('unused')).resolves.toBe(true)
    await expect(database.shops.get('unused')).resolves.toBeUndefined()
  })

  it.each<VoucherStatus>(['active', 'verification_pending', 'archived'])('keeps a shop assigned to a %s voucher', async (status) => {
    database = new GutscheinboxDB(`test-${crypto.randomUUID()}`)
    await database.shops.add({ id: 'used', name: 'Gebundene Auswahl', detectionTerms: [], defaultAmountCents: 5000, createdAt: '2026-01-01' })
    await database.vouchers.add({
      id: `voucher-${status}`,
      shopId: 'used',
      number: '',
      pin: '',
      barcodeValue: '',
      barcodeFormat: '',
      initialAmountCents: 5000,
      remainingAmountCents: 5000,
      status,
      confidence: 1,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01'
    })

    await expect(database.deleteShopIfUnused('used')).resolves.toBe(false)
    await expect(database.shops.get('used')).resolves.toBeDefined()
    await expect(database.vouchers.get(`voucher-${status}`)).resolves.toBeDefined()
  })
})
