import { afterEach, describe, expect, it } from 'vitest'
import { GutscheinboxDB } from './db'

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
})
