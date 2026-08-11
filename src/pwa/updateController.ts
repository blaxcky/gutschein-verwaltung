export interface PwaUpdateState {
  updateAvailable: boolean
  updating: boolean
  error?: string
}

export interface UpdateRegistration {
  update: () => Promise<void>
}

export interface RegisterUpdateOptions {
  immediate: boolean
  onNeedRefresh: () => void
  onNeedReload: () => void
  onRegisteredSW: (swUrl: string, registration: UpdateRegistration | undefined) => void
  onRegisterError: (error: unknown) => void
}

export type RegisterUpdateWorker = (options: RegisterUpdateOptions) => (reloadPage?: boolean) => Promise<void>

export interface PwaUpdateRuntime {
  isOnline: () => boolean
  isVisible: () => boolean
  onVisibilityChange: (listener: () => void) => () => void
  onFocus: (listener: () => void) => () => void
  onOnline: (listener: () => void) => () => void
  onControllerChange: (listener: () => void) => () => void
  setInterval: (listener: () => void, delay: number) => number
  clearInterval: (id: number) => void
  setTimeout: (listener: () => void, delay: number) => number
  clearTimeout: (id: number) => void
  reload: () => void
}

const INITIAL_STATE: PwaUpdateState = { updateAvailable: false, updating: false }

export class PwaUpdateController {
  private state: PwaUpdateState = INITIAL_STATE
  private listeners = new Set<() => void>()
  private registration?: UpdateRegistration
  private updateWorker?: (reloadPage?: boolean) => Promise<void>
  private resolveTakeover?: () => void
  private cleanups: Array<() => void> = []
  private intervalId?: number
  private started = false
  private checking = false

  constructor(
    private readonly runtime: PwaUpdateRuntime,
    private readonly checkIntervalMs = 60 * 60 * 1000,
    private readonly activationTimeoutMs = 30 * 1000
  ) {}

  getSnapshot = (): PwaUpdateState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start(registerWorker: RegisterUpdateWorker): void {
    if (this.started) return
    this.started = true

    const checkWhenActive = () => {
      if (this.runtime.isVisible() && this.runtime.isOnline()) void this.checkForUpdate()
    }
    this.cleanups.push(
      this.runtime.onVisibilityChange(checkWhenActive),
      this.runtime.onFocus(checkWhenActive),
      this.runtime.onOnline(checkWhenActive)
    )
    this.intervalId = this.runtime.setInterval(() => {
      if (this.runtime.isOnline()) void this.checkForUpdate()
    }, this.checkIntervalMs)

    this.updateWorker = registerWorker({
      immediate: true,
      onNeedRefresh: () => this.setState({ updateAvailable: true, updating: false, error: undefined }),
      onNeedReload: () => this.resolveTakeover?.(),
      onRegisteredSW: (_swUrl, registration) => {
        this.registration = registration
        if (this.runtime.isOnline()) void this.checkForUpdate()
      },
      onRegisterError: () => {
        // A failed background registration must not interrupt the currently running app.
      }
    })
  }

  stop(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup()
    if (this.intervalId !== undefined) this.runtime.clearInterval(this.intervalId)
    this.intervalId = undefined
    this.started = false
  }

  checkForUpdate = async (): Promise<void> => {
    if (!this.registration || this.checking || !this.runtime.isOnline()) return
    this.checking = true
    try {
      await this.registration.update()
    } catch {
      // Being offline or behind a captive portal is harmless; retry on the next trigger.
    } finally {
      this.checking = false
    }
  }

  installUpdate = async (): Promise<void> => {
    if (!this.state.updateAvailable || this.state.updating) return
    if (!this.updateWorker) {
      this.setState({ ...this.state, error: 'Das Update konnte nicht gestartet werden. Bitte versuche es erneut.' })
      return
    }

    this.setState({ ...this.state, updating: true, error: undefined })
    let removeControllerListener = () => {}
    let timeoutId: number | undefined

    try {
      const takeover = new Promise<void>((resolve, reject) => {
        let settled = false
        const complete = () => {
          if (settled) return
          settled = true
          if (timeoutId !== undefined) this.runtime.clearTimeout(timeoutId)
          removeControllerListener()
          resolve()
        }
        this.resolveTakeover = complete
        removeControllerListener = this.runtime.onControllerChange(complete)
        timeoutId = this.runtime.setTimeout(() => {
          if (settled) return
          settled = true
          removeControllerListener()
          reject(new Error('Die neue Version konnte nicht aktiviert werden. Bitte versuche es erneut.'))
        }, this.activationTimeoutMs)
      })

      await this.updateWorker(false)
      await takeover
      this.runtime.reload()
    } catch {
      this.resolveTakeover?.()
      if (timeoutId !== undefined) this.runtime.clearTimeout(timeoutId)
      removeControllerListener()
      this.setState({
        updateAvailable: true,
        updating: false,
        error: 'Das Update konnte nicht aktiviert werden. Die aktuelle Version läuft weiter. Bitte versuche es erneut.'
      })
    } finally {
      this.resolveTakeover = undefined
    }
  }

  private setState(nextState: PwaUpdateState): void {
    this.state = nextState
    for (const listener of this.listeners) listener()
  }
}
