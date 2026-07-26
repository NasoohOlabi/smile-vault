# AGENTS.md

Guidance for AI coding agents working in this repo.

## What this is
Smile Vault is the static front-end for the Dama store — plain HTML/CSS/JS, no build step, no framework.
- Dev: https://nasooholabi.github.io/smile-vault/
- Prod: https://dama-store.wuaze.com/?i=2

## File layout
- `index.html` — the storefront (root URL). Fixed contract: `assets/app.js` depends on its IDs and classes, so don't change markup structure casually.
- `design.css` — the current look (CSS custom properties + a few flourishes). Currently "Kiosk Screen".
- `assets/base.css` — all layout/interaction mechanics (bottom-sheet cart, swipeable lightbox, sticky header, RTL logical properties, touch targets). Every visual property here is a `var(--token, fallback)`.
- `assets/app.js` — application logic: cart, filters, lightbox, checkout.
- `assets/i18n.js` — all UI copy and category display names, one `I18N` map (English only).
- `products.json` — the catalog. Regenerate with `node s.js` (scans image folders).
- `s.js` — catalog generator.

## Theming
To change the look: edit only `design.css` tokens (`--bg`, `--fg`, `--accent`, `--font-display`, radii, shadows — full list documented at the top of `base.css`). Don't touch markup or JS for a reskin. Earlier designs (design-1…design-10) were removed from the tree once Kiosk Screen was picked; they're recoverable from git history if needed.

## Conventions
- No build tooling — open `index.html` directly or serve statically. No npm/webpack/bundler to run.
- English only, LTR. Any new UI copy goes into `I18N` in `assets/i18n.js`, using `data-i18n` attributes in markup, not hardcoded strings.
- Category codes (`01`–`05`) live in `products.json`; display names are edited only in `I18N.cats`.
- Order destination is the `SHEETDB_URL` constant near the top of `assets/app.js`.
- Cart persists in `localStorage` under `dama_cart_v2`; legacy per-item `p_<id>` keys are auto-migrated on load — don't remove that migration without checking for real users still on the old key.

## Testing changes
There's no test suite or CI. Verify changes by opening `index.html` in a browser (or a static server) and exercising the golden path: browse catalog, open lightbox, add to cart, edit quantities, checkout form validation.
