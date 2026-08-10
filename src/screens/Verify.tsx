import { ArrowSquareOut, CheckCircle, Copy, Scan } from '@phosphor-icons/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { db } from '../db'
import { decryptText } from '../lib/crypto'
import { formatMoney } from '../lib/logic'
import { EmptyState } from '../components/ui'

export function VerifyScreen({ notify }: { notify: (message: string) => void }) {
  const vouchers = useLiveQuery(() => db.vouchers.where('status').equals('verification_pending').toArray(), [])
  const shops = useLiveQuery(() => db.shops.toArray(), []) ?? []
  async function copyEncrypted(value: string, label: string) { await navigator.clipboard.writeText(await decryptText(value)); notify(`${label} kopiert.`) }
  async function archive(id: string) { await db.vouchers.update(id, { status: 'archived', updatedAt: new Date().toISOString() }); notify('Gutschein archiviert.') }
  return <main className="page"><header className="page-head"><div><p className="eyebrow">Nachkontrolle</p><h1>Prüfen</h1><span className="subtle">Leere Gutscheine sicher abschließen.</span></div></header>
    {!vouchers ? <p className="subtle">Prüfliste wird geladen …</p> : vouchers.length === 0 ? <EmptyState icon={<CheckCircle size={36} weight="duotone" />} title="Alles geprüft" text="Gutscheine mit 0 € erscheinen automatisch hier, bevor sie archiviert werden." /> : <div className="list">{vouchers.map((voucher) => { const shop = shops.find((item) => item.id === voucher.shopId); return <section className="voucher-card" key={voucher.id}><div className="voucher-top"><div><span className="status"><span className="status-dot" /> Zu prüfen</span><h2>{shop?.name ?? 'Gutschein'}</h2><span className="subtle">{formatMoney(voucher.remainingAmountCents)}</span></div><Link className="icon-button" to={`/voucher/${voucher.id}`} aria-label="Gutschein öffnen"><Scan size={20} /></Link></div><div className="button-row" style={{ marginTop: 16 }}><button className="secondary" onClick={() => copyEncrypted(voucher.number, 'Nummer')}><Copy size={17} /> Nummer</button><button className="secondary" onClick={() => copyEncrypted(voucher.pin, 'PIN')} disabled={!voucher.pin}><Copy size={17} /> PIN</button></div>{shop?.balanceCheckUrl && <a className="secondary wide" style={{ marginTop: 10, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, textDecoration: 'none' }} href={shop.balanceCheckUrl} target="_blank" rel="noreferrer"><ArrowSquareOut size={17} /> Guthaben online prüfen</a>}<button className="primary wide" style={{ marginTop: 10 }} onClick={() => archive(voucher.id)}>Als leer bestätigt & archivieren</button></section> })}</div>}
  </main>
}
