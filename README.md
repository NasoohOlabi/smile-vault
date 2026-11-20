# Dama Store Nightly

Nightly runs in its own Railway project and Postgres database. GitHub Actions verifies pushes and pull requests targeting `nightly`. The Railway service follows that branch and waits for CI.

- [Nightly store](https://dama-store-nightly.up.railway.app/)
- [Dama Studio](https://dama-store-nightly.up.railway.app/admin)
- [Nightly Railway project](https://railway.com/project/4e74061b-a972-4557-885c-ece15f4eaccf)
- [Nightly CI](https://github.com/NasoohOlabi/smile-vault/actions/workflows/nightly.yml?query=branch%3Anightly)

## Developer access

| Work | Access to grant |
| --- | --- |
| Develop and test locally | A GitHub account for a fork and pull requests. The repository is public. Grant collaborator access only if they need to push to the shared repository. [GitHub collaborator permissions](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/permission-levels-for-a-personal-account-repository) |
| Inspect Railway deployments | Invite them as a **Viewer** in the `dama-store-nightly` project's **Settings → Members**. [Railway project roles](https://docs.railway.com/projects/project-members) |
| Deploy or manage Railway settings | Invite them as an **Editor** in the same project and have them connect their own GitHub account in Railway. [Railway deployment approvals](https://docs.railway.com/services#approving-a-deployment) |
| Manage live store data or authorize the admin MCP | Share the Dama Studio password through your password manager. Studio uses one shared admin password that grants access to orders, catalog, content, and uploads. |

Local development and CI use disposable databases with sample data. The live database connection and session signing secret are configured in Railway.

## Start locally

Install Git, Node.js 22.12 or later, Bun 1.3.14, and Docker. Clone `nightly` and create a feature branch.

```sh
git clone --branch nightly https://github.com/NasoohOlabi/smile-vault.git
cd smile-vault
git switch -c nightly-my-change
```

Start a local Postgres 18 container listening on port 5433. Wait until `pg_isready` reports that it is accepting connections, then create the integration test database.

```sh
docker run --detach --rm --name dama-nightly-postgres -p 127.0.0.1:5433:5432 -e POSTGRES_PASSWORD=dama-local -e POSTGRES_DB=dama_nightly postgres:18-alpine
docker exec dama-nightly-postgres pg_isready -h 127.0.0.1 -U postgres
docker exec dama-nightly-postgres psql -U postgres -d postgres -c "CREATE DATABASE dama_nightly_test;"
```

Create an ignored `.env` file in the repository with these local-only values.

```dotenv
DATABASE_URL=postgres://postgres:dama-local@127.0.0.1:5433/dama_nightly
TEST_DATABASE_URL=postgres://postgres:dama-local@127.0.0.1:5433/dama_nightly_test
ADMIN_PASSWORD=nightly-local-admin
SESSION_SECRET=nightly-local-only-session-secret
```

```sh
bun install --frozen-lockfile
bun run build
bun run check:nightly
bun run start
```

The backend seeds the catalog on first run. Open [local storefront](http://127.0.0.1:3000/) or [local Studio](http://127.0.0.1:3000/admin). For hot reload, keep the backend running and run `bun run dev` in a second terminal. The Vite admin entry is [local Vite Studio](http://127.0.0.1:5173/admin.html). Use `http://127.0.0.1:3000/mcp` for local OAuth discovery. Stopping the Docker container removes its local databases.

## Ship to nightly

1. Run `bun run build` and `bun run check:nightly` locally. Push your feature branch to your fork or the shared repository, then open a pull request with `nightly` as its base.
2. Once the change lands on `nightly`, GitHub Actions runs **Nightly CI**. The Railway app waits for CI before deploying. An Editor can approve a queued deployment on the service's **Deployments** tab if Railway asks for approval.
3. Confirm the app service's deployment shows **Success** and the `commit` at [nightly health](https://dama-store-nightly.up.railway.app/health) matches the merged commit. Open the storefront or Studio to check the change. For a failure, start with the GitHub Actions run and the Railway deployment logs.

In Railway, select the `dama-store-nightly` project. Its environment is labeled `production` and contains the `dama-store-nightly` app service and its own `Postgres` service. The app's Variables tab configures `DATABASE_URL` as a reference to Postgres, plus `ADMIN_PASSWORD`, `SESSION_SECRET`, and `APP_ORIGIN` for the nightly domain. Apply staged variable updates from the project dashboard to deploy them. Use a separate `SESSION_SECRET` of at least 24 characters.

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

## Storefront development notes

See [repository guidance](AGENTS.md) for the source files that own storefront, catalog, and store operations.

To regenerate fresh-database seed files, edit `catalog/shop/` and run `bun run catalog`. Apply live changes in Dama Studio or via MCP.

The production build creates responsive WebP thumbnails for bundled product images. Product details and the lightbox still use the original files.
The storefront renders the first rows immediately, fills in the remaining cards during idle time, and starts thumbnail requests near the viewport.
Analytics stay disabled unless the build sets `VITE_ENABLE_ANALYTICS=true`.
