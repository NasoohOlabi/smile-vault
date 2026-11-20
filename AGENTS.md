# Repository guidance

Nightly runs independently of `main` in the Dama Store Nightly Railway project. See [README.md](README.md) for runtime variables, local verification, and historical order import.

- Storefront changes go through `index.html` and `src/app.js`. Preserve existing element IDs and cart keys for active shops and saved carts.
- SKU grouping and order pricing share `src/catalog.js`. Storefront totals and Postgres order snapshots must resolve the same SKU, size, and price.
- Live catalog, copy, uploaded images, and order history are stored in Postgres. Manage them in Dama Studio or MCP. Use `catalog/shop/` and `bun run catalog` only to change fresh-database seeds.
- Store operation changes belong in `server/store.js`. Use the same validation and storage from the HTTP dashboard and MCP tools.
- Keep order records and admin credentials behind authenticated routes. Use synthetic data for verification.
- Verify a change with `bun run build` and `bun run check:nightly` against disposable local Postgres.
