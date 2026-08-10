import JSZip from 'jszip'
import { db } from '../db'
import type { Settings, Shop, SourceFile, Transaction, Voucher } from '../types'
import { base64ToBlob, blobToBase64, decryptBackup, decryptBlob, decryptText, encryptBackup, encryptBlob, encryptText } from './crypto'

type SerializedShop = Omit<Shop, 'image'> & { image?: { data: string; type: string } }
type SerializedSource = Omit<SourceFile, 'content'> & { content: { data: string; type: string } }
type SerializedVoucher = Omit<Voucher, 'barcodeCrop'> & { barcodeCrop?: { data: string; type: string } }

interface BackupPayload {
  version: 1
  createdAt: string
  shops: SerializedShop[]
  vouchers: SerializedVoucher[]
  sourceFiles: SerializedSource[]
  transactions: Transaction[]
  settings: Settings[]
}

export async function createBackup(password: string) {
  const [shops, vouchers, sourceFiles, transactions, settings] = await Promise.all([db.shops.toArray(), db.vouchers.toArray(), db.sourceFiles.toArray(), db.transactions.toArray(), db.settings.toArray()])
  const payload: BackupPayload = {
    version: 1,
    createdAt: new Date().toISOString(),
    shops: await Promise.all(shops.map(async ({ image, ...shop }) => ({ ...shop, image: image ? { data: await blobToBase64(image), type: image.type } : undefined }))),
    vouchers: await Promise.all(vouchers.map(async ({ barcodeCrop, ...voucher }) => ({ ...voucher, number: await decryptText(voucher.number), pin: await decryptText(voucher.pin), barcodeValue: await decryptText(voucher.barcodeValue), barcodeCrop: barcodeCrop ? { data: await blobToBase64(await decryptBlob(barcodeCrop)), type: (await decryptBlob(barcodeCrop)).type } : undefined }))),
    sourceFiles: await Promise.all(sourceFiles.map(async ({ content, ...source }) => { const plain = await decryptBlob(content); return { ...source, content: { data: await blobToBase64(plain), type: plain.type } } })),
    transactions,
    settings
  }
  const zip = new JSZip()
  zip.file('data.json', JSON.stringify(payload))
  const compressed = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  return new Blob([await encryptBackup(compressed, password)], { type: 'application/x-gutscheinbox' })
}

export async function readBackup(file: File, password: string): Promise<BackupPayload> {
  const compressed = await decryptBackup(await file.text(), password)
  const zip = await JSZip.loadAsync(compressed)
  const dataFile = zip.file('data.json')
  if (!dataFile) throw new Error('Backup enthält keine Daten.')
  const payload = JSON.parse(await dataFile.async('text')) as BackupPayload
  if (payload.version !== 1 || !Array.isArray(payload.vouchers)) throw new Error('Backup-Version wird nicht unterstützt.')
  return payload
}

export async function restoreBackup(payload: BackupPayload) {
  const shops: Shop[] = payload.shops.map(({ image, ...shop }) => ({ ...shop, image: image ? base64ToBlob(image.data, image.type) : undefined }))
  const pinEnabled = Boolean((await db.settings.get('app'))?.pinEnabled)
  const vouchers: Voucher[] = await Promise.all(payload.vouchers.map(async ({ barcodeCrop, ...voucher }) => ({ ...voucher, number: pinEnabled ? await encryptText(voucher.number) : voucher.number, pin: pinEnabled ? await encryptText(voucher.pin) : voucher.pin, barcodeValue: pinEnabled ? await encryptText(voucher.barcodeValue) : voucher.barcodeValue, barcodeCrop: barcodeCrop ? (pinEnabled ? await encryptBlob(base64ToBlob(barcodeCrop.data, barcodeCrop.type)) : base64ToBlob(barcodeCrop.data, barcodeCrop.type)) : undefined })))
  const sources: SourceFile[] = await Promise.all(payload.sourceFiles.map(async ({ content, ...source }) => { const blob = base64ToBlob(content.data, content.type); return { ...source, content: pinEnabled ? await encryptBlob(blob) : blob } }))
  await db.transaction('rw', [db.shops, db.vouchers, db.sourceFiles, db.transactions], async () => {
    await Promise.all([db.shops.bulkPut(shops), db.vouchers.bulkPut(vouchers), db.sourceFiles.bulkPut(sources), db.transactions.bulkPut(payload.transactions)])
  })
}

export type { BackupPayload }
