import { afterEach, describe, expect, it, vi } from 'vitest'
import { GutscheinboxDB } from '../db'
import { PwaUpdateController, type PwaUpdateRuntime, type RegisterUpdateOptions, type UpdateRegistration } from './updateController'

class FakeRuntime implements PwaUpdateRuntime {
  online = true
  visible = true
  reloaded = false
  visibilityListener?: () => void
  focusListener?: () => void
  onlineListener?: () => void
  controllerListener?: () => void
  intervalListener?: () => void
  timeoutListener?: () => void

  isOnline = () => this.online
  isVisible = () => this.visible
  onVisibilityChange = (listener: () => void) => { this.visibilityListener = listener; return () => { this.visibilityListener = undefined } }
  onFocus = (listener: () => void) => { this.focusListener = listener; return () => { this.focusListener = undefined } }
  onOnline = (listener: () => void) => { this.onlineListener = listener; return () => { this.onlineListener = undefined } }
  onControllerChange = (listener: () => void) => { this.controllerListener = listener; return () => { this.controllerListener = undefined } }
  setInterval = (listener: () => void) => { this.intervalListener = listener; return 1 }
  clearInterval = () => { this.intervalListener = undefined }
  setTimeout = (listener: () => void) => { this.timeoutListener = listener; return 2 }
  clearTimeout = () => { this.timeoutListener = undefined }
  reload = () => { this.reloaded = true }
}

function prepareController(runtime = new FakeRuntime()) {
  const controller = new PwaUpdateController(runtime)
  const updateWorker = vi.fn(async () => {})
  let options: RegisterUpdateOptions | undefined
  const register = vi.fn((nextOptions: RegisterUpdateOptions) => {
    options = nextOptions
    return updateWorker
  })
  controller.start(register)
  return { controller, runtime, updateWorker, get options() { return options! } }
}

let database: GutscheinboxDB | undefined
afterEach(async () => { await database?.delete(); database = undefined })

describe('PWA update controller', () => {
  it('shows an update only after the new worker is waiting', () => {
    const setup = prepareController()
    expect(setup.controller.getSnapshot().updateAvailable).toBe(false)

    setup.options.onNeedRefresh()

    expect(setup.controller.getSnapshot()).toEqual({ updateAvailable: true, updating: false, error: undefined })
  })

  it('checks on startup, return to the app, focus and the hourly interval', async () => {
    const setup = prepareController()
    const registration: UpdateRegistration = { update: vi.fn(async () => {}) }

    setup.options.onRegisteredSW('/sw.js', registration)
    await Promise.resolve()
    expect(registration.update).toHaveBeenCalledTimes(1)

    setup.runtime.visibilityListener?.()
    await Promise.resolve()
    setup.runtime.focusListener?.()
    await Promise.resolve()
    setup.runtime.intervalListener?.()
    await Promise.resolve()
    expect(registration.update).toHaveBeenCalledTimes(4)

    setup.runtime.online = false
    setup.runtime.intervalListener?.()
    setup.runtime.onlineListener?.()
    await Promise.resolve()
    expect(registration.update).toHaveBeenCalledTimes(4)
  })

  it('activates once and reloads only after the new worker takes control', async () => {
    const setup = prepareController()
    setup.options.onNeedRefresh()

    const installing = setup.controller.installUpdate()
    void setup.controller.installUpdate()
    await Promise.resolve()

    expect(setup.updateWorker).toHaveBeenCalledTimes(1)
    expect(setup.updateWorker).toHaveBeenCalledWith(false)
    expect(setup.controller.getSnapshot().updating).toBe(true)
    expect(setup.runtime.reloaded).toBe(false)

    setup.runtime.controllerListener?.()
    await installing
    expect(setup.runtime.reloaded).toBe(true)
  })

  it('keeps the current version available when activation fails', async () => {
    const setup = prepareController()
    setup.options.onNeedRefresh()
    setup.updateWorker.mockRejectedValueOnce(new Error('Service Worker konnte nicht aktiviert werden.'))

    await setup.controller.installUpdate()

    expect(setup.runtime.reloaded).toBe(false)
    expect(setup.controller.getSnapshot()).toEqual({
      updateAvailable: true,
      updating: false,
      error: 'Das Update konnte nicht aktiviert werden. Die aktuelle Version läuft weiter. Bitte versuche es erneut.'
    })
  })

  it('does not change any IndexedDB table during activation and reload', async () => {
    const databaseName = `update-preserves-data-${crypto.randomUUID()}`
    database = new GutscheinboxDB(databaseName)
    await database.shops.add({ id: 'shop', name: 'Papier & Wort', detectionTerms: ['Papier'], defaultAmountCents: 5000, createdAt: '2026-08-11' })
    await database.sourceFiles.add({ id: 'source', name: 'gutschein.pdf', mimeType: 'application/pdf', size: 3, hash: 'hash', content: new Blob(['pdf']), createdAt: '2026-08-11' })
    await database.vouchers.add({ id: 'voucher', shopId: 'shop', number: '4711', pin: '1234', barcodeValue: '4711', barcodeFormat: 'CODE_128', initialAmountCents: 5000, remainingAmountCents: 4200, sourceFileId: 'source', status: 'active', confidence: .93, createdAt: '2026-08-11', updatedAt: '2026-08-11' })
    await database.transactions.add({ id: 'transaction', voucherId: 'voucher', type: 'expense', amountCents: 800, previousBalanceCents: 5000, newBalanceCents: 4200, note: 'Test', createdAt: '2026-08-11' })
    await database.settings.add({ id: 'app', setupComplete: true, offlineReady: true, pinEnabled: true, pinVerifier: 'verifier', keySalt: 'salt', wrappedDataKey: 'key', wrappedDataKeyIv: 'iv' })

    const before = await Promise.all([database.shops.toArray(), database.vouchers.toArray(), database.sourceFiles.toArray(), database.transactions.toArray(), database.settings.toArray()])
    const setup = prepareController()
    setup.options.onNeedRefresh()
    const installing = setup.controller.installUpdate()
    setup.options.onNeedReload()
    await installing

    database.close()
    database = new GutscheinboxDB(databaseName)
    const after = await Promise.all([database.shops.toArray(), database.vouchers.toArray(), database.sourceFiles.toArray(), database.transactions.toArray(), database.settings.toArray()])
    expect(after).toEqual(before)
  })
})
