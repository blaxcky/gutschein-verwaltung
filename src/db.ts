import Dexie, { type EntityTable } from 'dexie'
import type { Settings, Shop, SourceFile, Transaction, Voucher } from './types'

export class GutscheinboxDB extends Dexie {
  shops!: EntityTable<Shop, 'id'>
  vouchers!: EntityTable<Voucher, 'id'>
  sourceFiles!: EntityTable<SourceFile, 'id'>
  transactions!: EntityTable<Transaction, 'id'>
  settings!: EntityTable<Settings, 'id'>

  constructor(name = 'gutscheinbox') {
    super(name)
    this.version(1).stores({
      shops: 'id, name, createdAt',
      vouchers: 'id, shopId, status, remainingAmountCents, createdAt',
      sourceFiles: 'id, hash, createdAt',
      transactions: 'id, voucherId, createdAt',
      settings: 'id'
    })
  }
}

export const db = new GutscheinboxDB()

export async function ensureSettings() {
  const current = await db.settings.get('app')
  if (!current) await db.settings.add({ id: 'app', setupComplete: true, offlineReady: false, pinEnabled: false })
}
