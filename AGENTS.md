# AGENTS.md

Guidance for AI coding agents working in this repo.

## What this is
Smile Vault is the front-end for the Dama store — plain HTML/JS, styled with Tailwind via Vite.
- Dev: `npm run dev` → http://localhost:5173 (HMR)
- Prod build: `npm run build` → `dist/` (Firebase Hosting / static upload)
- Legacy static URLs: https://nasooholabi.github.io/smile-vault/ · https://dama-store.wuaze.com/?i=2

## File layout
- `index.html` — storefront shell. `src/app.js` depends on its IDs; don't change markup structure casually.
- `src/main.js` — Vite entry (CSS + Firebase + app).
- `src/input.css` — Tailwind theme + component layer (Kiosk Screen).
- `src/app.js` — cart, filters, lightbox, checkout, views.
- `src/firebase.js` — Analytics init.
- `products.json` + image folders at repo root — served in dev/build via `vite.config.js` catalog plugin.
- `assets/*.png` — brand images (logo, sun, stamp).
- `s.js` — catalog generator (`node s.js`).

## Theming
Kiosk tokens live in `@theme` inside `src/input.css`. JS state variants (`is-open`, `is-active`, …) are declared with `@custom-variant`. Markup uses Tailwind utilities only (plus small pattern utilities `bg-checker`, `bg-checker-dark`, `scrollbar-none`). Vite HMR updates CSS when you edit `src/input.css` or class strings.

## Commands
```bash
npm install
npm run dev       # Vite + Tailwind HMR
npm run build     # output dist/
npm run preview   # preview production build
```

## Conventions
- English only, LTR. UI copy lives in `index.html`; JS-only strings and category display names live in `src/app.js`.
- Category codes (`01`–`05`) in `products.json`; display names in `CAT_NAMES` in `src/app.js`.
- Order destination: `SHEETDB_URL` in `src/app.js`.
- Cart: `localStorage` key `dama_cart_v2` (+ legacy `p_<id>` migration).

## Testing
Golden path in the Vite dev server: browse catalog, lightbox, cart, checkout validation.
