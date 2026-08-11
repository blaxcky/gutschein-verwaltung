import { useRef, useState } from 'react'
import { ArrowClockwise, CloudArrowDown, CloudArrowUp, LockKey, ShieldCheck } from '@phosphor-icons/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { createBackup, readBackup, restoreBackup, type BackupPayload } from '../lib/backup'
import { configurePin, encryptBlob, encryptText, lockVault } from '../lib/crypto'
import { usePwaUpdate } from '../pwa/update'
import { Field, Modal } from '../components/ui'

type Dialog = 'pin' | 'backup' | 'restore' | null

export function SettingsScreen({ notify, onLock }: { notify: (message: string) => void; onLock: () => void }) {
  const settings = useLiveQuery(() => db.settings.get('app'), [])
  const counts = useLiveQuery(async () => ({ shops: await db.shops.count(), vouchers: await db.vouchers.count() }), [])
  const [dialog, setDialog] = useState<Dialog>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<BackupPayload | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const { updateAvailable, updating, error: updateError, installUpdate } = usePwaUpdate()

  function resetDialog() { setDialog(null); setPassword(''); setConfirm(''); setError(''); setRestoreFile(null); setPreview(null) }
  async function enablePin() {
    if (password !== confirm) return setError('Die beiden PINs stimmen nicht überein.')
    try {
      const config = await configurePin(password)
      await db.transaction('rw', db.settings, db.vouchers, db.sourceFiles, async () => {
        for (const voucher of await db.vouchers.toArray()) await db.vouchers.update(voucher.id, { number: await encryptText(voucher.number), pin: await encryptText(voucher.pin), barcodeValue: await encryptText(voucher.barcodeValue), barcodeCrop: voucher.barcodeCrop ? await encryptBlob(voucher.barcodeCrop) : undefined })
        for (const source of await db.sourceFiles.toArray()) await db.sourceFiles.update(source.id, { content: await encryptBlob(source.content) })
        await db.settings.update('app', { pinEnabled: true, ...config })
      })
      notify('App-PIN aktiviert und vorhandene Daten verschlüsselt.'); resetDialog()
    } catch (error) { setError(error instanceof Error ? error.message : 'PIN konnte nicht gesetzt werden.') }
  }
  async function exportBackup() {
    try { const blob = await createBackup(password); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `gutscheinbox-${new Date().toISOString().slice(0,10)}.gutscheinbox`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); notify('Verschlüsseltes Backup erstellt.'); resetDialog() } catch (error) { setError(error instanceof Error ? error.message : 'Backup fehlgeschlagen.') }
  }
  async function inspectBackup() {
    if (!restoreFile) return setError('Bitte eine Backup-Datei auswählen.')
    try { setPreview(await readBackup(restoreFile, password)); setError('') } catch (error) { setError(error instanceof Error ? error.message : 'Backup konnte nicht gelesen werden.') }
  }
  async function restore() { if (!preview) return; await restoreBackup(preview); notify('Backup zusammengeführt.'); resetDialog() }
  function lock() { lockVault(); onLock() }

  return <main className="page"><header className="page-head"><div><p className="eyebrow">Gerät & Daten</p><h1>Einstellungen</h1><span className="offline-pill"><ShieldCheck size={16} weight="fill" /> Offline bereit</span></div></header>
    {updateAvailable && <section className="settings-group update-group" aria-labelledby="update-heading"><div className="settings-row update-available"><div><strong id="update-heading">Neue Version verfügbar</strong><p>Die neue Version ist vollständig geladen. Deine Shops, Gutscheine und Einstellungen bleiben erhalten.</p>{updateError && <p className="error" role="alert">{updateError}</p>}</div><button className="primary update-button" disabled={updating} onClick={installUpdate}><ArrowClockwise size={18} className={updating ? 'updating-icon' : undefined} />{updating ? 'Wird aktualisiert …' : 'Jetzt aktualisieren'}</button></div></section>}
    <section className="settings-group"><h2>Sicherheit</h2><div className="settings-row"><div><strong>App-PIN</strong><p>Schützt Codes und neue Originaldateien mit AES-GCM. Es gibt keine PIN-Wiederherstellung.</p></div>{settings?.pinEnabled ? <button className="secondary" onClick={lock}><LockKey size={18} /> Sperren</button> : <button className="secondary" onClick={() => setDialog('pin')}>Aktivieren</button>}</div></section>
    <section className="settings-group"><h2>Backup</h2><div className="settings-row"><div><strong>Komplett-Backup</strong><p>{counts?.shops ?? 0} Shops, {counts?.vouchers ?? 0} Gutscheine und alle Originaldateien.</p></div><button className="icon-button" onClick={() => setDialog('backup')} aria-label="Backup erstellen"><CloudArrowDown size={21} /></button></div><div className="settings-row"><div><strong>Backup wiederherstellen</strong><p>Vorhandene Einträge werden über ihre IDs sicher zusammengeführt.</p></div><button className="icon-button" onClick={() => { setDialog('restore'); setTimeout(() => fileRef.current?.click(), 100) }} aria-label="Backup wiederherstellen"><CloudArrowUp size={21} /></button></div></section>
    <section className="settings-group"><h2>Über Gutscheinbox</h2><div className="settings-row"><div><strong>Vollständig lokal</strong><p>Version 1.0 · Keine Cloud, kein Konto, kein Tracking.</p></div></div></section>
    {dialog === 'pin' && <Modal title="App-PIN aktivieren" onClose={resetDialog}><p className="subtle">Wichtig: Ein vergessener PIN kann nicht wiederhergestellt werden. Bestehende Daten bleiben lesbar; neue sensible Daten werden verschlüsselt gespeichert.</p><Field label="Neuer PIN"><input className="input" type="password" inputMode="numeric" value={password} onChange={(event) => setPassword(event.target.value)} /></Field><Field label="PIN wiederholen" error={error}><input className="input" type="password" inputMode="numeric" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></Field><div className="button-row"><button className="secondary" onClick={resetDialog}>Abbrechen</button><button className="primary" onClick={enablePin}>PIN aktivieren</button></div></Modal>}
    {dialog === 'backup' && <Modal title="Backup verschlüsseln" onClose={resetDialog}><p className="subtle">Das Passwort schützt das gesamte Backup inklusive Bilder und Originaldateien.</p><Field label="Backup-Passwort" helper="Mindestens acht Zeichen." error={error}><input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field><button className="primary wide" onClick={exportBackup}>Backup herunterladen</button></Modal>}
    {dialog === 'restore' && <Modal title="Backup wiederherstellen" onClose={resetDialog}><input ref={fileRef} type="file" accept=".gutscheinbox,application/x-gutscheinbox" onChange={(event) => { setRestoreFile(event.target.files?.[0] ?? null); setPreview(null) }} style={{ display: 'none' }} />{!restoreFile ? <button className="secondary wide" onClick={() => fileRef.current?.click()}>Backup-Datei auswählen</button> : <p><strong>{restoreFile.name}</strong></p>}<Field label="Backup-Passwort" error={error}><input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field>{preview ? <><div className="summary" style={{ marginBottom: 18 }}><div className="summary-main"><span className="label">Gutscheine</span><strong>{preview.vouchers.length}</strong></div><div className="summary-side"><span className="label">Shops</span><strong>{preview.shops.length}</strong></div></div><p className="subtle">Erstellt am {new Date(preview.createdAt).toLocaleString('de-AT')}. Lokale Daten werden erst nach Bestätigung verändert.</p><button className="primary wide" onClick={restore}>Jetzt zusammenführen</button></> : <button className="primary wide" onClick={inspectBackup}>Inhalt zuerst prüfen</button>}</Modal>}
  </main>
}
