export type VoucherStatus = 'active' | 'verification_pending' | 'archived'
export type TransactionType = 'expense' | 'correction' | 'reversal'

export interface Shop {
  id: string
  name: string
  image?: Blob
  imageUrl?: string
  detectionTerms: string[]
  defaultAmountCents: number
  balanceCheckUrl?: string
  createdAt: string
}

export interface Voucher {
  id: string
  shopId: string
  number: string
  pin: string
  barcodeValue: string
  barcodeFormat: string
  initialAmountCents: number
  remainingAmountCents: number
  sourceFileId?: string
  sourcePage?: number
  barcodeCrop?: Blob
  status: VoucherStatus
  confidence: number
  createdAt: string
  updatedAt: string
}

export interface SourceFile {
  id: string
  name: string
  mimeType: string
  size: number
  hash: string
  content: Blob
  createdAt: string
}

export interface Transaction {
  id: string
  voucherId: string
  type: TransactionType
  amountCents: number
  previousBalanceCents: number
  newBalanceCents: number
  note?: string
  reversedTransactionId?: string
  createdAt: string
}

export interface Settings {
  id: 'app'
  setupComplete: boolean
  offlineReady: boolean
  pinEnabled: boolean
  pinVerifier?: string
  keySalt?: string
  wrappedDataKey?: string
  wrappedDataKeyIv?: string
  lastBackgroundAt?: number
}

export interface DetectionCandidate {
  value: string
  label: 'Nummer' | 'PIN' | 'Barcode'
  confidence: number
  source: string
}

export interface ImportDraft {
  file: File
  hash: string
  duplicate: boolean
  previewUrl: string
  text: string
  barcodeValue: string
  barcodeFormat: string
  shopId: string
  number: string
  pin: string
  amountCents: number
  confidence: number
  sourcePage: number
  candidates: DetectionCandidate[]
}
