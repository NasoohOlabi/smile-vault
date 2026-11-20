# Dama Store Nightly

Nightly runs in its own Railway project and Postgres database. GitHub Actions verifies pushes and pull requests targeting `nightly`. The Railway service follows that branch and waits for CI.

- [Nightly store](https://dama-store-nightly.up.railway.app/)
- [Dama Studio](https://dama-store-nightly.up.railway.app/admin)
- [Nightly Railway project](https://railway.com/project/4e74061b-a972-4557-885c-ece15f4eaccf)

## Manage the store

Sign in to Dama Studio using the password set in `ADMIN_PASSWORD` on the nightly app service's Variables tab in Railway. Choose a password between 15 and 256 characters. Review orders and change their fulfillment status. Search products, edit prices and variants, and hide or publish designs. Upload an image from the library or directly in an editor. Images used by products or collection features must be replaced before removal.

The Storefront page publishes announcements, page introductions, collection labels, and section features immediately. Products, copy, images, and orders live in Postgres. A fresh database seeds its catalog from `products.json` and `catalog-nav.json`. Future deployments preserve published changes.

## Admin MCP

Open **MCP setup** in Dama Studio and select **Copy prompt** for instructions you can paste into an MCP-compatible assistant. Use **Copy URL** to add `https://dama-store-nightly.up.railway.app/mcp` manually to a client that supports Streamable HTTP and OAuth dynamic client registration. Connect to open Dama Studio in your browser. Sign in with the nightly admin password if prompted, review the client's name and callback, and select **Approve access**. The client handles the OAuth credentials and refreshes access automatically. [Dama Studio MCP setup](https://dama-store-nightly.up.railway.app/admin#mcp)

The MCP tools manage the same orders, products, copy, collections, and images as Dama Studio. Edit tools take the current revision from the corresponding read tool. Clients can revoke a connection through the advertised OAuth revocation endpoint.

## Import historical orders

Legacy records can be uploaded from a JSON export containing an array of SheetDB rows. Use the original timestamps, column names, and `Items` JSON. Keep exports private. Run the importer from a trusted environment that can reach the nightly database with `DATABASE_URL` set.

```sh
bun run import-orders dama-store ./private-main-export.json
bun run import-orders dama-x-elat ./private-elat-export.json
```

Use the same source name and row order when retrying an export. A second run skips imported records and preserves their current status. Nightly checkout stores new orders directly in Postgres, including orders that contain both Dama and Dama × Elat items.

## Develop and verify

Set `DATABASE_URL`, `ADMIN_PASSWORD`, and `SESSION_SECRET` in a local ignored `.env` file. Use a separate `SESSION_SECRET` of at least 24 characters. Set `APP_ORIGIN` to the HTTPS origin when hosting the app behind a proxy. For local MCP, use `http://127.0.0.1:3000/mcp`. Analytics stay disabled unless the build sets `VITE_ENABLE_ANALYTICS=true`.

```sh
bun install --frozen-lockfile
bun run build
bun run start
```

Open http://localhost:3000 and http://localhost:3000/admin. For Vite hot reload, keep the backend running on port 3000 and use `bun run dev`; the admin entry is `/admin.html` on Vite. Set `TEST_DATABASE_URL` to a disposable local Postgres database before running `bun run check:nightly`.

To regenerate fresh-database seed files, edit `catalog/shop/` and run `bun run catalog`. Apply live changes in Dama Studio or via MCP.

The production build creates responsive WebP thumbnails for bundled product images. Product details and the lightbox still use the original files.
The storefront renders the first rows immediately, fills in the remaining cards during idle time, and starts thumbnail requests near the viewport.
