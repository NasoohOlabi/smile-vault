# Dama obsrv

deplyed prod at
https://dama-store.wuaze.com/

deployed dev at 
https://nasooholabi.github.io/smile-vault/

## Overview
Smile Vault is the web front-end for the Dama store project. This repository hosts the static site for development (GitHub Pages) and production (Wuaze hosting).

## Features
- Static front-end, no build step, no framework — plain HTML/CSS/JS
- **Ten interchangeable visual designs** (`/design-1` … `/design-10`) sharing one cart,
  one checkout flow, and one product catalog — see [Designs](#designs) below
- Mobile-first: bottom sheet cart with drag-to-dismiss, swipeable lightbox, collapsing
  search bar, safe-area padding, haptic feedback, 44px touch targets throughout
- Bilingual Arabic (RTL) / English (LTR), remembered per visitor
- Catalog driven by `products.json`: search, category chips, lazy-loaded images
- Full-screen artwork lightbox with keyboard (←/→, Esc) and swipe navigation
- Cart drawer with per-item quantity editing and removal, persisted in `localStorage`
- Checkout form with validation, submitting to SheetDB

## Designs
`index.html` at the repo root is a picker page linking to all ten. Each design is its own
folder with its own look, but all of them run the exact same cart/checkout/search/lightbox:

| # | Folder | Direction |
|---|--------|-----------|
| 1 | `design-1` | Warm Paper & Craft — the original DAMA OBSRV look (ink neutrals, teal accent) |
| 2 | `design-2` | Minimalist Mono — near-black/white, restrained, sharp corners |
| 3 | `design-3` | Dark Luxury — near-black, brass/gold accent, serif display |
| 4 | `design-4` | Brutalist Zine — raw borders, hard offset shadows, monospace |
| 5 | `design-5` | Magazine Editorial — cream newsprint, large serif headlines |
| 6 | `design-6` | Playful Pop — bright, rounded, sticker-shop energy |
| 7 | `design-7` | Damascene Tile — jewel tones, geometric tile motifs |
| 8 | `design-8` | Retro Print Poster — aged paper, halftone texture, vintage type |
| 9 | `design-9` | Glassmorphism — frosted translucent panels over a soft gradient |
| 10 | `design-10` | Terminal Mono-Tech — phosphor green on black, CRT scanlines |

### How this works (theming architecture)
Every design's `index.html` is byte-identical markup (same IDs/classes) except its `<title>`
and its own `design.css` link — the HTML skeleton is a fixed contract that `assets/app.js`
depends on. What actually changes per design is styling, and it's built like CSS Zen Garden:

- **`assets/base.css`** owns 100% of layout, positioning, and interaction mechanics (the
  bottom-sheet cart, swipeable lightbox, sticky header, RTL logical properties, touch
  targets…) shared by every design. Every visual property in it is a `var(--token, fallback)`.
- **`design-N/design.css`** sets just those tokens (`--bg`, `--fg`, `--accent`, `--font-display`,
  radii, shadows, etc. — the full list is documented at the top of `base.css`) plus, optionally,
  a handful of decorative flourishes. That's the entire surface area for a new look.

To add an 11th design: copy `design-1/index.html` into `design-11/`, change its `<title>`, then
write `design-11/design.css` defining the same token list with new values.

## File layout
- `index.html` — the design picker/gallery (root URL)
- `design-N/index.html` — shared markup for design N
- `design-N/design.css` — design N's look (CSS custom properties + optional flourishes)
- `assets/base.css` — shared layout/interaction mechanics; consumes the design tokens
- `assets/i18n.js` — all UI copy and category display names, one `I18N` map per language
- `assets/app.js` — application logic (cart, filters, lightbox, checkout) — shared by every design

## Customizing
- **Products**: edit `products.json` (or regenerate it with `node s.js`, which scans the image folders).
- **Category names**: the JSON stores codes (`01`–`05`). Their display names live in the
  `I18N.ar.cats` / `I18N.en.cats` maps in `assets/i18n.js` — edit them in one place, and every
  design picks it up.
- **UI copy**: everything else in those same `I18N` maps; markup uses `data-i18n` attributes.
- **Order destination**: the `SHEETDB_URL` constant near the top of `assets/app.js`.
- **A design's look**: edit its `design-N/design.css` tokens — no need to touch markup or JS.

Carts saved by the pre-redesign version (one `p_<id>` key per product) are migrated
automatically to the current `dama_cart_v2` key on first load, in every design.

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