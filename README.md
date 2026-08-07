# Dama obsrv

Production: https://dama-store.wuaze.com/  
Development: https://nasooholabi.github.io/smile-vault/

## Overview
Smile Vault is the web storefront for Dama. Local development uses **Vite** (HMR for JS + Tailwind). Production is a static `dist/` build.

## Commands
```bash
npm install
npm run dev       # http://localhost:5173 — Vite + Tailwind HMR
npm run build     # write dist/
npm run preview   # serve dist locally
```

## Features
- Vite + Tailwind CSS v4 (`@tailwindcss/vite`)
- Kiosk Screen look (charcoal, lime rail, magenta/cyan/yellow)
- Mobile-first cart sheet, swipeable lightbox, safe areas
- Catalog from `products.json`
- Checkout → SheetDB
- Firebase Analytics

## File layout
- `index.html` — page shell
- `src/main.js` — entry
- `src/input.css` — Tailwind theme + components
- `src/app.js` — app logic
- `vite.config.js` — Vite + catalog static plugin (product images / `products.json`)
- `products.json` + image folders at repo root

## Customizing
- **Products**: `products.json` or `node s.js`
- **Copy / category names**: `index.html` + `src/app.js`
- **Orders**: `SHEETDB_URL` in `src/app.js`
- **Look**: `src/input.css` (live via HMR in `npm run dev`)

## Deploy
1. `npm run build`
2. Deploy `dist/` (Firebase Hosting `public` is set to `dist`, or upload to Wuaze / GitHub Pages)

## License
No license specified.
