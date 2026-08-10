import { useEffect, useRef, useState } from 'react'
import { CheckCircle, FileArrowUp, WarningCircle, XCircle } from '@phosphor-icons/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import type { ImportDraft, SourceFile, Voucher } from '../types'
import { encryptBlob, encryptText } from '../lib/crypto'
import { inspectFile, sha256, terminateImporter } from '../lib/importer'
import { parseMoney, uid } from '../lib/logic'
import { Field, Modal } from './ui'

interface FileStatus { file: File; status: 'waiting' | 'processing' | 'review' | 'saved' | 'error'; message?: string }

export function ImportWizard({ onClose, onSaved }: { onClose: () => void; onSaved: (shopId: string) => void }) {
  const shops = useLiveQuery(() => db.shops.toArray(), []) ?? []
  const settings = useLiveQuery(() => db.settings.get('app'), [])
  const [files, setFiles] = useState<FileStatus[]>([])
  const [draft, setDraft] = useState<ImportDraft | null>(null)
  const [progress, setProgress] = useState(0)
  const [progressText, setProgressText] = useState('Vorbereitung')
  const [cancelled, setCancelled] = useState(false)
  const [form, setForm] = useState({ shopId: '', number: '', pin: '', amount: '100,00' })
  const running = useRef(false)

  useEffect(() => () => { terminateImporter(); if (draft?.previewUrl) URL.revokeObjectURL(draft.previewUrl) }, [draft?.previewUrl])
  useEffect(() => {
    if (!draft) return
    setForm({ shopId: draft.shopId, number: draft.number, pin: draft.pin, amount: (draft.amountCents / 100).toFixed(2).replace('.', ',') })
  }, [draft])

  async function select(selected: FileList | null) {
    if (!selected?.length || running.current) return
    const accepted = Array.from(selected).filter((file) => file.type.startsWith('image/') || file.type === 'application/pdf')
    const statuses: FileStatus[] = accepted.map((file) => ({ file, status: 'waiting' }))
    setFiles(statuses); setCancelled(false); running.current = true
    await processNext(statuses, 0)
  }

  async function processNext(current: FileStatus[], index: number) {
    if (cancelled || index >= current.length) { running.current = false; return }
    const entry = current[index]
    entry.status = 'processing'; setFiles([...current]); setProgress(0)
    try {
      const hash = await sha256(entry.file)
      const duplicate = Boolean(await db.sourceFiles.where('hash').equals(hash).first())
      const inspected = await inspectFile(entry.file, shops, duplicate, (value, status) => { setProgress(Math.max(0, Math.min(1, value))); setProgressText(translateStatus(status)) })
      entry.status = 'review'; setFiles([...current]); setDraft(inspected); running.current = false
    } catch (error) {
      entry.status = 'error'; entry.message = error instanceof Error ? error.message : 'Datei konnte nicht verarbeitet werden.'; setFiles([...current]); await processNext(current, index + 1)
    }
  }

  async function saveDraft() {
    if (!draft) return
    const cents = parseMoney(form.amount)
    if (!form.shopId || !form.number.trim() || cents === null || cents <= 0) return
    const sourceId = uid('source')
    const voucherId = uid('voucher')
    const secure = Boolean(settings?.pinEnabled)
    const source: SourceFile = { id: sourceId, name: draft.file.name, mimeType: draft.file.type, size: draft.file.size, hash: draft.hash, content: secure ? await encryptBlob(draft.file) : draft.file, createdAt: new Date().toISOString() }
    const now = new Date().toISOString()
    const voucher: Voucher = {
      id: voucherId, shopId: form.shopId,
      number: secure ? await encryptText(form.number.trim()) : form.number.trim(),
      pin: secure ? await encryptText(form.pin.trim()) : form.pin.trim(),
      barcodeValue: secure ? await encryptText(draft.barcodeValue || form.number.trim()) : draft.barcodeValue || form.number.trim(),
      barcodeFormat: draft.barcodeFormat || 'QRCode', initialAmountCents: cents, remainingAmountCents: cents,
      sourceFileId: sourceId, sourcePage: draft.sourcePage, status: 'active', confidence: draft.confidence, createdAt: now, updatedAt: now
    }
    await db.transaction('rw', db.sourceFiles, db.vouchers, async () => { await db.sourceFiles.add(source); await db.vouchers.add(voucher) })
    const updated = files.map((entry) => entry.file === draft.file ? { ...entry, status: 'saved' as const } : entry)
    URL.revokeObjectURL(draft.previewUrl); setDraft(null); setFiles(updated)
    const nextIndex = updated.findIndex((entry) => entry.status === 'waiting')
    if (nextIndex >= 0) { running.current = true; await processNext(updated, nextIndex) } else { await terminateImporter(); onSaved(form.shopId) }
  }

  function cancel() { setCancelled(true); terminateImporter(); onClose() }
  const valid = Boolean(form.shopId && form.number.trim() && parseMoney(form.amount))

  return <Modal title={draft ? 'Fundstelle prüfen' : files.length ? 'Gutscheine erkennen' : 'Gutscheine importieren'} onClose={cancel}>
    {shops.length === 0 ? <div className="empty"><WarningCircle size={34} /><h2>Zuerst einen Shop anlegen</h2><p className="subtle">Schließe den Import und lege in der Shopübersicht einen Shop an.</p><button className="primary" onClick={onClose}>Zurück zu Shops</button></div> : draft ? <>
      <div className="review-preview"><img src={draft.previewUrl} alt={`Vorschau von ${draft.file.name}`} /></div>
      <div className="confidence"><CheckCircle size={16} weight="fill" /> Erkennungssicherheit: {draft.confidence}%</div>
      {draft.duplicate && <div className="warning"><strong>Möglicher doppelter Import.</strong><br />Diese Originaldatei ist bereits gespeichert. Du kannst den Gutschein trotzdem anlegen.</div>}
      {draft.confidence < 70 && <div className="warning"><strong>Bitte besonders sorgfältig prüfen.</strong><br />Ein unsicherer Treffer wird nie automatisch gespeichert.</div>}
      <Field label="Shop"><select className="input" value={form.shopId} onChange={(event) => setForm({ ...form, shopId: event.target.value })}><option value="">Shop wählen</option>{shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.name}</option>)}</select></Field>
      <Field label="Gutscheinnummer"><input className="input" value={form.number} onChange={(event) => setForm({ ...form, number: event.target.value })} autoComplete="off" /></Field>
      <Field label="PIN"><input className="input" value={form.pin} onChange={(event) => setForm({ ...form, pin: event.target.value })} autoComplete="off" /></Field>
      <Field label="Startguthaben"><input className="input" inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></Field>
      <p className="subtle" style={{ fontSize: '.8rem' }}>{draft.barcodeValue ? `${draft.barcodeFormat} auf Seite ${draft.sourcePage} erkannt.` : 'Kein Barcode erkannt; die Nummer wird als QR-Code dargestellt.'}</p>
      <div className="button-row"><button className="secondary" onClick={cancel}>Abbrechen</button><button className="primary" disabled={!valid} onClick={saveDraft}>Geprüft & speichern</button></div>
    </> : files.length ? <>
      <div className="progress-track"><div className="progress-bar" style={{ transform: `scaleX(${progress})` }} /></div><p className="subtle" style={{ marginTop: 8 }}>{progressText}</p>
      <div className="list">{files.map((entry) => <div className="list-row" key={`${entry.file.name}-${entry.file.lastModified}`} style={{ gridTemplateColumns: '40px 1fr' }}>{entry.status === 'error' ? <XCircle size={24} color="var(--danger)" /> : entry.status === 'saved' ? <CheckCircle size={24} color="var(--accent)" /> : <FileArrowUp size={24} />}<div><span className="row-title">{entry.file.name}</span><span className="row-meta">{statusText(entry)} · {(entry.file.size / 1024 / 1024).toFixed(1)} MB</span></div></div>)}</div>
      <button className="secondary wide" onClick={cancel}>Verarbeitung abbrechen</button>
    </> : <label className="dropzone"><FileArrowUp size={36} weight="duotone" /><strong style={{ marginTop: 10 }}>Bilder oder PDFs auswählen</strong><span className="subtle">Mehrfachauswahl möglich. Die Verarbeitung erfolgt nacheinander und nur auf diesem Gerät.</span><input type="file" multiple accept="image/*,application/pdf" onChange={(event) => select(event.target.files)} /></label>}
  </Modal>
}

function statusText(entry: FileStatus) { return entry.status === 'waiting' ? 'Wartet' : entry.status === 'processing' ? 'Wird lokal erkannt' : entry.status === 'review' ? 'Prüfung erforderlich' : entry.status === 'saved' ? 'Gespeichert' : entry.message || 'Fehler' }
function translateStatus(value: string) { if (value.includes('recognizing')) return 'Text wird lokal erkannt'; if (value.includes('loading')) return 'Offline-OCR wird geladen'; return value || 'Datei wird analysiert' }
