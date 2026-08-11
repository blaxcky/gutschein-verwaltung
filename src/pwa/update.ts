import { useSyncExternalStore } from 'react'
import { registerSW } from 'virtual:pwa-register'
import { PwaUpdateController, type PwaUpdateRuntime } from './updateController'

function on(target: EventTarget, eventName: string, listener: () => void) {
  target.addEventListener(eventName, listener)
  return () => target.removeEventListener(eventName, listener)
}

const browserRuntime: PwaUpdateRuntime = {
  isOnline: () => navigator.onLine,
  isVisible: () => document.visibilityState === 'visible',
  onVisibilityChange: (listener) => on(document, 'visibilitychange', listener),
  onFocus: (listener) => on(window, 'focus', listener),
  onOnline: (listener) => on(window, 'online', listener),
  onControllerChange: (listener) => on(navigator.serviceWorker, 'controllerchange', listener),
  setInterval: (listener, delay) => window.setInterval(listener, delay),
  clearInterval: (id) => window.clearInterval(id),
  setTimeout: (listener, delay) => window.setTimeout(listener, delay),
  clearTimeout: (id) => window.clearTimeout(id),
  reload: () => window.location.reload()
}

export const pwaUpdateController = new PwaUpdateController(browserRuntime)

export function initializePwaUpdates(): void {
  if ('serviceWorker' in navigator) pwaUpdateController.start(registerSW)
}

export function usePwaUpdate() {
  const state = useSyncExternalStore(pwaUpdateController.subscribe, pwaUpdateController.getSnapshot, pwaUpdateController.getSnapshot)
  return { ...state, installUpdate: pwaUpdateController.installUpdate }
}
