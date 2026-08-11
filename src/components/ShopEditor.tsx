import { useEffect, useState, type FormEvent } from 'react'
import { Trash } from '@phosphor-icons/react'
import { db } from '../db'
import type { Shop } from '../types'
import { parseMoney, uid } from '../lib/logic'
import { Field, Modal } from './ui'

export function ShopEditor({ shop, onClose, onDeleted }: { shop?: Shop; onClose: () => void; onDeleted?: () => void }) {
  const [name, setName] = useState(shop?.name ?? '')
  const [terms, setTerms] = useState(shop?.detectionTerms.join(', ') ?? '')
  const [amount, setAmount] = useState(((shop?.defaultAmountCents ?? 10000) / 100).toFixed(2).replace('.', ','))
  const [url, setUrl] = useState(shop?.balanceCheckUrl ?? '')
  const [image, setImage] = useState<Blob | undefined>(shop?.image)
  const [imageUrl, setImageUrl] = useState<string>()
  const [error, setError] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!image) return
    const objectUrl = URL.createObjectURL(image)
    setImageUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [image])

  async function save(event: FormEvent) {
    event.preventDefault()
    const cents = parseMoney(amount)
    if (!name.trim()) return setError('Bitte einen Shopnamen eingeben.')
    if (cents === null || cents <= 0) return setError('Bitte einen gültigen Standardbetrag eingeben.')
    if (url && !/^https?:\/\//i.test(url)) return setError('Der Prüf-Link muss mit http:// oder https:// beginnen.')
    const value: Shop = { id: shop?.id ?? uid('shop'), name: name.trim(), image, detectionTerms: terms.split(',').map((term) => term.trim()).filter(Boolean), defaultAmountCents: cents, balanceCheckUrl: url.trim() || undefined, createdAt: shop?.createdAt ?? new Date().toISOString() }
    await db.shops.put(value)
    onClose()
  }

  async function requestDelete() {
    if (!shop) return
    setError('')
    try {
      const voucher = await db.vouchers.where('shopId').equals(shop.id).first()
      if (voucher) return setError('Dieser Shop hat noch einen zugeordneten Gutschein und kann nicht gelöscht werden.')
      setConfirmingDelete(true)
    } catch {
      setError('Die Gutscheine konnten nicht geprüft werden. Der Shop wurde nicht verändert.')
    }
  }

  async function confirmDelete() {
    if (!shop || deleting) return
    setDeleting(true)
    setError('')
    try {
      const deleted = await db.deleteShopIfUnused(shop.id)
      if (!deleted) {
        setError('Dieser Shop hat noch einen zugeordneten Gutschein und kann nicht gelöscht werden.')
        return
      }
      if (onDeleted) onDeleted()
      else onClose()
    } catch {
      setError('Der Shop konnte nicht gelöscht werden. Es wurden keine Daten verändert.')
    } finally {
      setDeleting(false)
    }
  }

  if (shop && confirmingDelete) return <Modal title="Shop löschen" onClose={onClose}>
    <div className="delete-confirmation">
      <div className="delete-confirmation-icon"><Trash size={28} weight="duotone" /></div>
      <h3>„{shop.name}“ wirklich löschen?</h3>
      <p className="subtle">Der Shop wird dauerhaft von diesem Gerät entfernt. Gutscheine werden dabei niemals gelöscht.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="button-row">
        <button className="secondary" type="button" disabled={deleting} onClick={() => { setConfirmingDelete(false); setError('') }}>Abbrechen</button>
        <button className="danger-button" type="button" disabled={deleting} onClick={confirmDelete}>{deleting ? 'Wird gelöscht …' : 'Shop löschen'}</button>
      </div>
    </div>
  </Modal>

  return <Modal title={shop ? 'Shop bearbeiten' : 'Shop anlegen'} onClose={onClose}>
    <form onSubmit={save}>
      <Field label="Shopbild" helper="Das Bild bleibt ausschließlich auf diesem Gerät.">
        <label className="dropzone" style={{ minHeight: 120, backgroundImage: imageUrl ? `url(${imageUrl})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }}>
          {!imageUrl && 'Bild auswählen'}<input type="file" accept="image/*" onChange={(event) => setImage(event.target.files?.[0])} />
        </label>
      </Field>
      <Field label="Name"><input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="z. B. Buchhandlung Moser" /></Field>
      <Field label="Erkennungsbegriffe" helper="Mehrere Begriffe mit Komma trennen."><input className="input" value={terms} onChange={(event) => setTerms(event.target.value)} placeholder="Moser, Buchgutschein" /></Field>
      <Field label="Standardbetrag"><input className="input numeric" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
      <Field label="Link zur Guthabenprüfung" helper="Optional. Wird erst auf ausdrücklichen Klick geöffnet."><input className="input" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" /></Field>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="button-row"><button className="secondary" type="button" onClick={onClose}>Abbrechen</button><button className="primary" type="submit">Speichern</button></div>
      {shop && <button className="danger-button wide" style={{ marginTop: 10 }} type="button" onClick={requestDelete}><Trash size={18} /> Shop löschen</button>}
    </form>
  </Modal>
}
