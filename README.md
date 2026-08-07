# Dama obsrv

Production: https://dama-store.wuaze.com/  
Development: https://nasooholabi.github.io/smile-vault/

## Overview
Smile Vault is the web storefront for Dama. Local development uses **Vite** (HMR for JS + Tailwind). Production is a static `dist/` build.

## Commands
```bash
bun install
bun run catalog   # rebuild products.json + catalog-nav.json from catalog/shop/
bun run dev       # http://localhost:5173 — Vite + Tailwind HMR
bun run build     # write dist/
bun run preview   # serve dist locally
```

## Features
- Vite + Tailwind CSS v4 (`@tailwindcss/vite`)
- Kiosk Screen look (charcoal, lime rail, magenta/cyan/yellow)
- Mobile-first cart sheet, swipeable lightbox, safe areas
- Catalog from `catalog/shop/` YAML → `products.json` + `catalog-nav.json`
- Checkout → SheetDB
- Firebase Analytics (GA4 ecommerce funnel, SYP). Mark `purchase` as a key event in GA4; use `?debug_mode=1` for DebugView.

## File layout
- `index.html` — page shell
- `src/main.js` — entry
- `src/input.css` — Tailwind theme + components
- `src/app.js` — app logic
- `src/firebase.js` — Firebase app + Analytics
- `src/analytics.js` — GA4 event helpers
- `vite.config.js` — Vite + catalog static plugin (product images / generated JSON)
- `catalog/shop/` — shop tabs + leaf `items.yaml` product lists
- `products.json` + `catalog-nav.json` — generated; image folders at repo root

## Customizing
- **Products / tabs**: edit `catalog/shop/` then `bun run catalog`
- **Copy**: `index.html` (+ `_meta.yaml` for section labels / feature blocks)
- **Orders**: `SHEETDB_URL` in `src/app.js`
- **Look**: `src/input.css` (live via HMR in `bun run dev`)

## Deploy
1. `bun run build`
2. Deploy `dist/` (Firebase Hosting `public` is set to `dist`, or upload to Wuaze / GitHub Pages)

## License
No license specified.
