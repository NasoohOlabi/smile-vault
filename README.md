# Dama obsrv

deplyed prod at
https://dama-store.wuaze.com/

deployed dev at 
https://nasooholabi.github.io/smile-vault/

## Overview
Smile Vault is the web front-end for the Dama store project. This repository hosts the static site for development (GitHub Pages) and production (Wuaze hosting).

## Features
- Static front-end, no build step, no framework — plain HTML/CSS/JS
- Single storefront at the repo root, themed by one swappable `design.css`
  — see [Design](#design) below
- Mobile-first: bottom sheet cart with drag-to-dismiss, swipeable lightbox, collapsing
  search bar, safe-area padding, haptic feedback, 44px touch targets throughout
- Catalog driven by `products.json`: search, category chips, lazy-loaded images
- Full-screen artwork lightbox with keyboard (←/→, Esc) and swipe navigation
- Cart drawer with per-item quantity editing and removal, persisted in `localStorage`
- Checkout form with validation, submitting to SheetDB

## Design
The live look is **Kiosk Screen** — flat charcoal, mono type, olive category rail, and
magenta/cyan/yellow kiosk accents, after the in-store touchscreens.

### How this works (theming architecture)
`index.html` is a fixed contract: `assets/app.js` depends on its IDs and classes, so the
markup doesn't change when the look does. Styling is split CSS Zen Garden style:

- **`assets/base.css`** owns 100% of layout, positioning, and interaction mechanics (the
  bottom-sheet cart, swipeable lightbox, sticky header, touch targets…). Every visual
  property in it is a `var(--token, fallback)`.
- **`design.css`** sets just those tokens (`--bg`, `--fg`, `--accent`, `--font-display`,
  radii, shadows, etc. — the full list is documented at the top of `base.css`) plus a
  handful of decorative flourishes. That's the entire surface area for a new look.

To reskin the store, rewrite `design.css` against that token list — no markup or JS changes.
Ten earlier designs (Warm Paper, Brutalist Zine, Damascene Tile, Terminal Mono-Tech and
others) lived in `design-1/`…`design-10/`; they were removed once Kiosk Screen was picked,
and are recoverable from git history if a look needs revisiting.

## File layout
- `index.html` — the storefront (root URL)
- `design.css` — the look (CSS custom properties + optional flourishes)
- `assets/base.css` — shared layout/interaction mechanics; consumes the design tokens
- `assets/i18n.js` — all UI copy and category display names
- `assets/app.js` — application logic (cart, filters, lightbox, checkout)

## Customizing
- **Products**: edit `products.json` (or regenerate it with `node s.js`, which scans the image folders).
- **Category names**: the JSON stores codes (`01`–`05`). Their display names live in the
  `I18N.cats` map in `assets/i18n.js` — edit them in one place.
- **UI copy**: everything else in that same `I18N` map; markup uses `data-i18n` attributes.
- **Order destination**: the `SHEETDB_URL` constant near the top of `assets/app.js`.
- **The look**: edit the `design.css` tokens — no need to touch markup or JS.

Carts saved by the pre-redesign version (one `p_<id>` key per product) are migrated
automatically to the current `dama_cart_v2` key on first load.

## Environments
- Production: https://dama-store.wuaze.com/?i=2
- Development: https://nasooholabi.github.io/smile-vault/

## Getting Started
1. Clone or download the repository.
2. Open index.html directly in your browser, or use a simple static server.
3. Edit assets and pages as needed, then push changes for your deployment workflow.

## Local Development Tips
- Use VS Code Live Server or any static HTTP server for preview.
- Optimize images and assets for faster page loads.

## Deployment
- Development: GitHub Pages serves the site when you push to the configured branch (commonly main or gh-pages).
- Production: Upload the static files to your Wuaze hosting.

## Contributing
Pull requests are welcome. Please describe changes clearly and include screenshots when applicable.

## License
No license specified. Add one if needed.