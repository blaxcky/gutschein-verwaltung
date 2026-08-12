import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowCounterClockwise, CaretLeft, Copy, Image, Minus, Receipt } from '@phosphor-icons/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useParams } from 'react-router-dom'
import { writeBarcodeToImageFile } from '@sec-ant/zxing-wasm/writer'
import { db } from '../db'
import type { Transaction, Voucher } from '../types'
import { decryptBlob, decryptText } from '../lib/crypto'
import { applyExpense, canUndo, formatMoney, parseMoney, uid } from '../lib/logic'
import { Field, Modal } from '../components/ui'

export function VoucherScreen({ notify }: { notify: (message: string) => void }) {
  const { voucherId = '' } = useParams()
  const navigate = useNavigate()
  const voucher = useLiveQuery(() => db.vouchers.get(voucherId), [voucherId])
  const shop = useLiveQuery(() => voucher ? db.shops.get(voucher.shopId) : undefined, [voucher?.shopId])
  const transactions = useLiveQuery(() => db.transactions.where('voucherId').equals(voucherId).reverse().sortBy('createdAt'), [voucherId])
  const source = useLiveQuery(() => voucher?.sourceFileId ? db.sourceFiles.get(voucher.sourceFileId) : undefined, [voucher?.sourceFileId])
  const [revealed, setRevealed] = useState({ number: '', pin: '', barcode: '' })
  const [barcodeUrl, setBarcodeUrl] = useState('')
  const [expenseOpen, setExpenseOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [sourceUrl, setSourceUrl] = useState('')
  const [barcodeExpanded, setBarcodeExpanded] = useState(false)
  const barcodeTriggerRef = useRef<HTMLButtonElement>(null)
  const barcodeOverlayRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!voucher) return
    Promise.all([decryptText(voucher.number), decryptText(voucher.pin), decryptText(voucher.barcodeValue)]).then(([number, pin, barcode]) => setRevealed({ number, pin, barcode })).catch(() => undefined)
  }, [voucher])
  useEffect(() => {
    if (!revealed.barcode) return
    let currentUrl = ''
    const format = normalizeFormat(voucher?.barcodeFormat)
    writeBarcodeToImageFile(revealed.barcode, { format, width: 760, height: format === 'QRCode' ? 760 : 230, quietZone: 18 }).then((result) => {
      if (result.image) { currentUrl = URL.createObjectURL(result.image); setBarcodeUrl(currentUrl) }
    }).catch(() => setBarcodeUrl(''))
    return () => { if (currentUrl) URL.revokeObjectURL(currentUrl) }
  }, [revealed.barcode, voucher?.barcodeFormat])
  useEffect(() => () => { if (sourceUrl) URL.revokeObjectURL(sourceUrl) }, [sourceUrl])
  useEffect(() => {
    if (!barcodeExpanded) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    barcodeOverlayRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') closeBarcodeOverlay() }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [barcodeExpanded])

  if (!voucher) return <main className="page"><p className="subtle">Gutschein wird geladen …</p></main>
  const latest = transactions?.find((entry) => entry.type !== 'reversal' && canUndo(entry, transactions))

  async function copy(value: string, label: string) { await navigator.clipboard.writeText(value); notify(`${label} kopiert.`) }
  function closeBarcodeOverlay() {
    setBarcodeExpanded(false)
    window.requestAnimationFrame(() => barcodeTriggerRef.current?.focus())
  }
  async function showSource() {
    if (!source) return
    try { const content = await decryptBlob(source.content); setSourceUrl(URL.createObjectURL(content)) } catch (error) { notify(error instanceof Error ? error.message : 'Datei konnte nicht geöffnet werden.') }
  }
  async function undo() {
    if (!latest) return
    const voucherId = voucher?.id
    if (!voucherId) return
    const current = await db.vouchers.get(voucherId)
    if (!current) return
    const reverted: Voucher = { ...current, remainingAmountCents: latest.previousBalanceCents, status: latest.previousBalanceCents === 0 ? 'verification_pending' : 'active', updatedAt: new Date().toISOString() }
    const reversal: Transaction = { id: uid('tx'), voucherId, type: 'reversal', amountCents: latest.amountCents, previousBalanceCents: current.remainingAmountCents, newBalanceCents: latest.previousBalanceCents, reversedTransactionId: latest.id, createdAt: new Date().toISOString() }
    await db.transaction('rw', db.vouchers, db.transactions, async () => { await db.vouchers.put(reverted); await db.transactions.add(reversal) })
    notify('Letzte Änderung zurückgenommen.')
  }

  return <><main className="page">
    <header className="page-head"><button className="back-button" onClick={() => navigate(-1)} aria-label="Zurück"><CaretLeft size={22} /></button><button className="icon-button" onClick={() => setHistoryOpen(true)} aria-label="Verlauf"><Receipt size={21} /></button></header>
    <p className="eyebrow voucher-shop-name">{shop?.name ?? 'Gutschein'}</p>
    {barcodeUrl ? <button ref={barcodeTriggerRef} type="button" className="barcode-zone barcode-trigger" onClick={() => setBarcodeExpanded(true)} aria-haspopup="dialog"><img src={barcodeUrl} alt={`${voucher.barcodeFormat || 'Barcode'} zum Scannen`} /><span className="barcode-action-hint">Zum Vergrößern antippen</span></button> : <section className="barcode-zone" aria-label="Scanbereich"><div className="barcode-fallback"><strong>{revealed.number || 'Keine Nummer hinterlegt'}</strong>{!revealed.barcode && <span>Kein scanbarer Code erkannt</span>}</div></section>}
    <section className="balance-hero"><span>Restguthaben</span><strong className="numeric">{formatMoney(voucher.remainingAmountCents)}</strong></section>
    <SecretRow label="Nummer" value={revealed.number} onCopy={() => copy(revealed.number, 'Nummer')} />
    <SecretRow label="PIN" value={revealed.pin} onCopy={() => copy(revealed.pin, 'PIN')} />
    <div className="button-row" style={{ marginTop: 22 }}><button className="primary" disabled={voucher.remainingAmountCents === 0} onClick={() => setExpenseOpen(true)}><Minus size={18} /> Ausgabe</button><button className="secondary" disabled={!latest} onClick={undo}><ArrowCounterClockwise size={18} /> Rückgängig</button></div>
    {source && <button className="secondary wide" style={{ marginTop: 10 }} onClick={showSource}><Image size={18} /> Original anzeigen</button>}
    {expenseOpen && <ExpenseModal voucher={voucher} onClose={() => setExpenseOpen(false)} onSaved={() => { setExpenseOpen(false); notify('Ausgabe verbucht.') }} />}
    {historyOpen && <HistoryModal transactions={transactions ?? []} onClose={() => setHistoryOpen(false)} />}
    {sourceUrl && <Modal title="Originaldatei" onClose={() => { URL.revokeObjectURL(sourceUrl); setSourceUrl('') }}>{source?.mimeType === 'application/pdf' ? <iframe title="Original-PDF" src={sourceUrl} style={{ width: '100%', height: '65dvh', border: 0, borderRadius: 16 }} /> : <img src={sourceUrl} alt="Originalgutschein" style={{ width: '100%', borderRadius: 18 }} />}</Modal>}
  </main>{barcodeExpanded && createPortal(<div className="barcode-overlay" role="dialog" aria-modal="true" aria-label="Vergrößerter Scan-Code"><button ref={barcodeOverlayRef} type="button" className={`barcode-overlay-close ${normalizeFormat(voucher.barcodeFormat) === 'QRCode' ? 'is-qr' : 'is-linear'}`} onClick={closeBarcodeOverlay} aria-label="Vergrößerten Scan-Code schließen"><span className="barcode-overlay-code"><img src={barcodeUrl} alt={`${voucher.barcodeFormat || 'Barcode'} vergrößert zum Scannen`} /></span><span className="barcode-overlay-hint">Zum Schließen erneut tippen</span></button></div>, document.body)}</>
}

function SecretRow({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) { return <div className="secret-row"><div><span>{label}</span><strong>{value || 'Nicht hinterlegt'}</strong></div><button className="icon-button" disabled={!value} onClick={onCopy} aria-label={`${label} kopieren`}><Copy size={19} /></button></div> }

function ExpenseModal({ voucher, onClose, onSaved }: { voucher: Voucher; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  async function save() {
    const cents = parseMoney(amount)
    if (cents === null) return setError('Bitte einen gültigen Komma-Betrag eingeben.')
    try {
      const updated = applyExpense(voucher, cents)
      const transaction: Transaction = { id: uid('tx'), voucherId: voucher.id, type: 'expense', amountCents: cents, previousBalanceCents: voucher.remainingAmountCents, newBalanceCents: updated.remainingAmountCents, note: note.trim() || undefined, createdAt: new Date().toISOString() }
      await db.transaction('rw', db.vouchers, db.transactions, async () => { await db.vouchers.put(updated); await db.transactions.add(transaction) })
      onSaved()
    } catch (error) { setError(error instanceof Error ? error.message : 'Buchung fehlgeschlagen.') }
  }
  return <Modal title="Ausgabe verbuchen" onClose={onClose}><p className="subtle">Verfügbar: <strong>{formatMoney(voucher.remainingAmountCents)}</strong></p><Field label="Ausgabebetrag" error={error}><input className="input" inputMode="decimal" autoFocus value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0,00" /></Field><Field label="Notiz" helper="Optional, z. B. Filiale oder Einkauf."><input className="input" value={note} onChange={(event) => setNote(event.target.value)} /></Field><div className="button-row"><button className="secondary" onClick={onClose}>Abbrechen</button><button className="primary" onClick={save}>Verbuchen</button></div></Modal>
}

function HistoryModal({ transactions, onClose }: { transactions: Transaction[]; onClose: () => void }) { return <Modal title="Verlauf" onClose={onClose}>{transactions.length === 0 ? <p className="subtle">Noch keine Buchungen.</p> : <div className="list">{transactions.map((entry) => <div className="list-row" key={entry.id} style={{ gridTemplateColumns: '1fr auto' }}><div><span className="row-title">{entry.type === 'expense' ? 'Ausgabe' : entry.type === 'reversal' ? 'Rücknahme' : 'Korrektur'}</span><span className="row-meta">{new Date(entry.createdAt).toLocaleString('de-AT')}{entry.note ? ` · ${entry.note}` : ''}</span></div><span className="row-value">{entry.type === 'expense' ? '−' : '+'}{formatMoney(entry.amountCents)}</span></div>)}</div>}</Modal> }

function normalizeFormat(format?: string) {
  const supported = ['QRCode','DataMatrix','Aztec','PDF417','Code128','Code39','Code93','EAN-13','EAN-8','UPC-A','UPC-E','ITF','Codabar'] as const
  const compact = (format || '').replace(/[ _-]/g, '').toLowerCase()
  return supported.find((item) => item.replace(/[ _-]/g, '').toLowerCase() === compact) ?? 'QRCode'
}
