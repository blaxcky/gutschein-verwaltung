# Gutscheinbox

Eine mobile-first Offline-PWA zur lokalen Verwaltung von Gutscheinen. Bilder, PDFs, OCR-Ergebnisse, Barcodes und Backups verlassen das Gerät nicht.

## Entwicklung

```bash
npm install
npm run dev
```

Die Anwendung nutzt Hash-Routing und wird mit der Vite-Basis `/gutschein-verwaltung/` gebaut.

## Prüfungen

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Datenschutz und Sicherheit

- IndexedDB speichert Shops, Gutscheine, Originaldateien und Transaktionen lokal.
- OCR-Sprachdaten, PDF-Worker und Barcode-WASM werden mit der App ausgeliefert und vom Service Worker gecacht.
- Ein optionaler App-PIN verschlüsselt sensible Daten neuer Importe per AES-GCM. Es gibt keine PIN-Wiederherstellung.
- Komplett-Backups sind komprimiert, versioniert und mit AES-256-GCM sowie PBKDF2-SHA-256 verschlüsselt.

## Veröffentlichung

Der Workflow `.github/workflows/ci.yml` prüft Typen, Lint, Tests und Produktions-Build. Nach erfolgreichem Lauf auf `main` wird `dist` auf GitHub Pages veröffentlicht.
