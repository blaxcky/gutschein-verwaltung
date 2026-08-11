import { useEffect, useState } from 'react'
import { Archive as ArchiveBox, Gear, Plus, Scan, Storefront } from '@phosphor-icons/react'
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, ensureSettings } from './db'
import { isUnlocked, lockVault, unlockWithPin } from './lib/crypto'
import { ImportWizard } from './components/ImportWizard'
import { ShopsScreen, ShopDetailScreen } from './screens/Shops'
import { VerifyScreen } from './screens/Verify'
import { ArchiveScreen } from './screens/Archive'
import { SettingsScreen } from './screens/Settings'
import { VoucherScreen } from './screens/Voucher'

function AppShell() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [importOpen, setImportOpen] = useState(false)
  const [initialImportShopId, setInitialImportShopId] = useState<string>()
  const [toast, setToast] = useState('')
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState('')
  const settings = useLiveQuery(() => db.settings.get('app'))
  const [locked, setLocked] = useState(false)

  useEffect(() => {
    ensureSettings().then(async () => {
      if (!import.meta.env.PROD) { await db.settings.update('app', { offlineReady: true }); return }
      if ('serviceWorker' in navigator) { await navigator.serviceWorker.ready; await db.settings.update('app', { offlineReady: true }) }
    })
  }, [])
  useEffect(() => { if (settings?.pinEnabled && !isUnlocked()) setLocked(true) }, [settings])
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) sessionStorage.setItem('gutscheinbox-background', String(Date.now()))
      else if (settings?.pinEnabled && Date.now() - Number(sessionStorage.getItem('gutscheinbox-background') || Date.now()) > 300_000) { lockVault(); setLocked(true) }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [settings?.pinEnabled])
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 2800); return () => clearTimeout(timer) }, [toast])

  async function unlock() {
    if (!settings) return
    try { await unlockWithPin(pin, settings); setLocked(false); setPin(''); setPinError('') } catch (error) { setPinError(error instanceof Error ? error.message : 'Entsperren fehlgeschlagen.') }
  }

  function openImport(shopId?: string) {
    setInitialImportShopId(shopId)
    setImportOpen(true)
  }

  function closeImport() {
    setImportOpen(false)
    setInitialImportShopId(undefined)
  }

  function finishImport(shopId: string) {
    closeImport()
    setToast('Gutschein sicher gespeichert.')
    navigate(`/shops/${shopId}`)
  }

  if (locked) return <main className="lock-screen"><div className="lock-box"><div className="lock-mark"><ArchiveBox size={32} weight="duotone" /></div><p className="eyebrow" style={{ color: '#b7d2c8' }}>Lokal geschützt</p><h1>Gutscheinbox entsperren</h1><p style={{ color: '#b7c3be', marginBottom: 28 }}>Deine Gutscheincodes sind auf diesem Gerät verschlüsselt.</p><input className="input" type="password" inputMode="numeric" autoFocus value={pin} onChange={(event) => setPin(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && unlock()} placeholder="App-PIN" aria-label="App-PIN" />{pinError && <p className="error" style={{ marginTop: 10 }}>{pinError}</p>}<button className="primary wide" style={{ marginTop: 14 }} onClick={unlock}>Entsperren</button></div></main>

  return <div className="app">
    <Routes>
      <Route path="/" element={<ShopsScreen />} />
      <Route path="/shops/:shopId" element={<ShopDetailScreen onImport={openImport} />} />
      <Route path="/voucher/:voucherId" element={<VoucherScreen notify={setToast} />} />
      <Route path="/verify" element={<VerifyScreen notify={setToast} />} />
      <Route path="/archive" element={<ArchiveScreen notify={setToast} />} />
      <Route path="/settings" element={<SettingsScreen notify={setToast} onLock={() => setLocked(true)} />} />
    </Routes>
    {pathname === '/' && <button className="fab" onClick={() => openImport()}><Plus size={21} weight="bold" /> Import</button>}
    <nav className="bottom-nav" aria-label="Hauptnavigation">
      <NavLink to="/" end className="nav-item"><Storefront size={22} />Shops</NavLink>
      <NavLink to="/verify" className="nav-item"><Scan size={22} />Prüfen</NavLink>
      <NavLink to="/archive" className="nav-item"><ArchiveBox size={22} />Archiv</NavLink>
      <NavLink to="/settings" className="nav-item"><Gear size={22} />Einstellungen</NavLink>
    </nav>
    {importOpen && <ImportWizard initialShopId={initialImportShopId} onClose={closeImport} onSaved={finishImport} />}
    {settings && !settings.offlineReady && <div className="modal-backdrop"><section className="modal" role="status"><div className="modal-handle" /><p className="eyebrow">Ersteinrichtung</p><h2>Offline-Komponenten werden geladen</h2><p className="subtle">App, Schriften, Barcode-Modul, PDF-Worker und OCR-Sprachdaten werden auf diesem Gerät vorbereitet.</p><div className="progress-track"><div className="progress-bar" style={{ transform: 'scaleX(.72)' }} /></div></section></div>}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>
}

export default function App() { return <AppShell /> }
