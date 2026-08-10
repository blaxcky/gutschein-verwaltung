import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './styles.css'

const applyUpdate = registerSW({
  immediate: true,
  onNeedRefresh: () => window.dispatchEvent(new CustomEvent('gutscheinbox-update', { detail: applyUpdate }))
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter><App /></HashRouter>
  </StrictMode>
)
