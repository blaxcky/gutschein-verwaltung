import { useEffect, useState, type FormEvent } from 'react'
import { db } from '../db'
import type { Shop } from '../types'
import { parseMoney, uid } from '../lib/logic'
import { Field, Modal } from './ui'

export function ShopEditor({ shop, onClose }: { shop?: Shop; onClose: () => void }) {
  const [name, setName] = useState(shop?.name ?? '')
  const [terms, setTerms] = useState(shop?.detectionTerms.join(', ') ?? '')
  const [amount, setAmount] = useState(((shop?.defaultAmountCents ?? 10000) / 100).toFixed(2).replace('.', ','))
  const [url, setUrl] = useState(shop?.balanceCheckUrl ?? '')
  const [image, setImage] = useState<Blob | undefined>(shop?.image)
  const [imageUrl, setImageUrl] = useState<string>()
  const [error, setError] = useState('')

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

  async function deleteShop() {
    if (!shop) return
    const voucherCount = await db.vouchers.where('shopId').equals(shop.id).count()
    if (voucherCount) return setError('Dieser Shop wird noch von Gutscheinen verwendet und kann nicht gelöscht werden.')
    await db.shops.delete(shop.id)
    onClose()
  }

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
      {error && <p className="error">{error}</p>}
      <div className="button-row"><button className="secondary" type="button" onClick={onClose}>Abbrechen</button><button className="primary" type="submit">Speichern</button></div>
      {shop && <button className="danger-button wide" style={{ marginTop: 10 }} type="button" onClick={deleteShop}>Unbenutzten Shop löschen</button>}
    </form>
  </Modal>
}
