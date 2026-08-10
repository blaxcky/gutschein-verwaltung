import { Archive as ArchiveBox, ArrowCounterClockwise, Ticket } from '@phosphor-icons/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { db } from '../db'
import { formatMoney } from '../lib/logic'
import { EmptyState } from '../components/ui'

export function ArchiveScreen({ notify }: { notify: (message: string) => void }) {
  const vouchers = useLiveQuery(() => db.vouchers.where('status').equals('archived').reverse().sortBy('updatedAt'), [])
  const shops = useLiveQuery(() => db.shops.toArray(), []) ?? []
  async function restore(id: string, remaining: number) { await db.vouchers.update(id, { status: remaining === 0 ? 'verification_pending' : 'active', updatedAt: new Date().toISOString() }); notify('Gutschein wiederhergestellt.') }
  return <main className="page"><header className="page-head"><div><p className="eyebrow">Aufbewahrt</p><h1>Archiv</h1><span className="subtle">Abgeschlossene Gutscheine bleiben nachvollziehbar.</span></div></header>
    {!vouchers ? <p className="subtle">Archiv wird geladen …</p> : vouchers.length === 0 ? <EmptyState icon={<ArchiveBox size={36} weight="duotone" />} title="Archiv ist leer" text="Bestätigte Gutscheine landen hier und können jederzeit wiederhergestellt werden." /> : <div className="list">{vouchers.map((voucher) => <div className="list-row" key={voucher.id}><Link className="shop-image" to={`/voucher/${voucher.id}`} aria-label="Gutschein öffnen"><Ticket size={24} /></Link><Link to={`/voucher/${voucher.id}`} style={{ textDecoration: 'none' }}><span className="row-title">{shops.find((shop) => shop.id === voucher.shopId)?.name ?? 'Gutschein'}</span><span className="row-meta">Archiviert am {new Date(voucher.updatedAt).toLocaleDateString('de-AT')}</span></Link><div style={{ textAlign: 'right' }}><span className="row-value">{formatMoney(voucher.remainingAmountCents)}</span><button className="text-button" style={{ display: 'block', marginLeft: 'auto' }} onClick={() => restore(voucher.id, voucher.remainingAmountCents)}><ArrowCounterClockwise size={15} /> Wiederherstellen</button></div></div>)}</div>}
  </main>
}
