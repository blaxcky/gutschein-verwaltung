import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/gutschein-verwaltung/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'maskable-512.png'],
      manifest: {
        name: 'Gutscheinbox',
        short_name: 'Gutscheinbox',
        description: 'Gutscheine lokal und offline verwalten',
        theme_color: '#f4f1e8',
        background_color: '#f4f1e8',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/gutschein-verwaltung/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,svg,woff2,wasm,gz}'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: 'index.html'
      }
    })
  ],
  test: { environment: 'node', setupFiles: ['./src/test/setup.ts'] }
})
