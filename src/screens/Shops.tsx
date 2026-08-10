import { useState } from 'react'
import { CaretLeft, PencilSimple, Plus, Storefront, Ticket } from '@phosphor-icons/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { db } from '../db'
import { formatMoney, sortVouchers } from '../lib/logic'
import type { Shop } from '../types'
import { ShopEditor } from '../components/ShopEditor'
import { EmptyState } from '../components/ui'

export function ShopsScreen() {
  const [editorOpen, setEditorOpen] = useState(false)
  const shops = useLiveQuery(() => db.shops.orderBy('createdAt').toArray(), [])
  const vouchers = useLiveQuery(() => db.vouchers.where('status').equals('active').toArray(), [])
  const total = vouchers?.reduce((sum, voucher) => sum + voucher.remainingAmountCents, 0) ?? 0

  return <main className="page">
    <header className="page-head"><div><p className="eyebrow">Lokal auf diesem Gerät</p><h1>Gutscheinbox</h1><span className="subtle">Bereit, wenn du sie brauchst.</span></div></header>
    <section className="summary"><div className="summary-main"><span className="label">Aktives Guthaben</span><strong className="numeric">{formatMoney(total)}</strong></div><div className="summary-side"><span className="label">Gutscheine</span><strong>{vouchers?.length ?? '–'}</strong></div></section>
    <div className="section-title"><h2>Deine Shops</h2><button className="text-button" onClick={() => setEditorOpen(true)}>Shop anlegen</button></div>
    {!shops ? <ShopSkeleton /> : shops.length === 0 ? <EmptyState icon={<Storefront size={34} weight="duotone" />} title="Noch kein Shop" text="Lege zuerst einen Shop an. Danach erkennt der Import passende Gutscheine automatisch." action={<button className="primary" onClick={() => setEditorOpen(true)}><Plus size={18} /> Shop anlegen</button>} /> : <div className="list">{shops.map((shop, index) => {
      const shopVouchers = vouchers?.filter((voucher) => voucher.shopId === shop.id) ?? []
      const balance = shopVouchers.reduce((sum, voucher) => sum + voucher.remainingAmountCents, 0)
      return <Link className="list-row tap" style={{ '--i': index } as React.CSSProperties} key={shop.id} to={`/shops/${shop.id}`}><ShopAvatar shop={shop} /><div><span className="row-title">{shop.name}</span><span className="row-meta">{shopVouchers.length} {shopVouchers.length === 1 ? 'Gutschein' : 'Gutscheine'}</span></div><span className="row-value numeric">{formatMoney(balance)}</span></Link>
    })}</div>}
    {editorOpen && <ShopEditor onClose={() => setEditorOpen(false)} />}
  </main>
}

export function ShopDetailScreen() {
  const { shopId = '' } = useParams()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const shop = useLiveQuery(() => db.shops.get(shopId), [shopId])
  const vouchers = useLiveQuery(() => db.vouchers.where('shopId').equals(shopId).filter((voucher) => voucher.status !== 'archived').toArray(), [shopId])
  const sorted = [...(vouchers ?? [])].sort(sortVouchers)
  const balance = sorted.filter((voucher) => voucher.status === 'active').reduce((sum, voucher) => sum + voucher.remainingAmountCents, 0)
  if (shop === undefined) return <main className="page"><ShopSkeleton /></main>
  if (!shop) return <main className="page"><EmptyState icon={<Storefront size={34} />} title="Shop nicht gefunden" text="Dieser Shop ist nicht mehr vorhanden." /></main>

  return <main className="page">
    <header className="page-head"><button className="back-button" onClick={() => navigate(-1)} aria-label="Zurück"><CaretLeft size={22} /></button><button className="icon-button" onClick={() => setEditing(true)} aria-label="Shop bearbeiten"><PencilSimple size={21} /></button></header>
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}><ShopAvatar shop={shop} /><div><p className="eyebrow">Shop</p><h1 style={{ fontSize: '2.35rem' }}>{shop.name}</h1></div></div>
    <section className="summary"><div className="summary-main"><span className="label">Verfügbar</span><strong>{formatMoney(balance)}</strong></div><div className="summary-side"><span className="label">Aktiv</span><strong>{sorted.filter((voucher) => voucher.status === 'active').length}</strong></div></section>
    <div className="section-title"><h2>Gutscheine</h2></div>
    {sorted.length === 0 ? <EmptyState icon={<Ticket size={34} weight="duotone" />} title="Keine Gutscheine" text="Importiere ein Bild oder PDF. Vor dem Speichern kannst du jeden Treffer prüfen." /> : <div className="list">{sorted.map((voucher, index) => <Link className={`list-row tap ${voucher.remainingAmountCents === 0 ? 'muted' : ''}`} style={{ '--i': index } as React.CSSProperties} key={voucher.id} to={`/voucher/${voucher.id}`}><div className="shop-image"><Ticket size={25} /></div><div><span className="row-title">{voucher.number ? `•••• ${voucher.number.slice(-4)}` : voucher.barcodeFormat || 'Gutschein'}</span><span className="row-meta">{voucher.status === 'verification_pending' ? 'Guthaben prüfen' : new Date(voucher.createdAt).toLocaleDateString('de-AT')}</span></div><span className="row-value">{formatMoney(voucher.remainingAmountCents)}</span></Link>)}</div>}
    {editing && <ShopEditor shop={shop} onClose={() => setEditing(false)} />}
  </main>
}

export function ShopAvatar({ shop }: { shop: Shop }) {
  const url = shop.image ? URL.createObjectURL(shop.image) : shop.imageUrl
  return <div className="shop-image">{url ? <img src={url} alt="" onLoad={() => shop.image && URL.revokeObjectURL(url)} /> : shop.name.slice(0, 1).toUpperCase()}</div>
}

function ShopSkeleton() { return <div className="list" aria-label="Wird geladen">{[0,1,2].map((key) => <div className="list-row" key={key} style={{ opacity: .35 }}><div className="shop-image" /><div><span className="row-title" style={{ width: '50%', height: 12, background: 'var(--line)', borderRadius: 6 }} /><span className="row-meta">Wird geladen</span></div></div>)}</div> }
