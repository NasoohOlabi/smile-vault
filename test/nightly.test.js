import { test, expect } from "bun:test";
import { SQL } from "bun";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { groupTshirts, resolveCatalogLine } from "../src/catalog.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !["127.0.0.1", "localhost"].includes(new URL(databaseUrl).hostname)) {
  throw new Error("Set TEST_DATABASE_URL to a dedicated local Postgres database.");
}
const env = {
  DATABASE_URL: databaseUrl,
  PORT: "3100",
  ADMIN_PASSWORD: "nightly-local-test-admin-passphrase",
  SESSION_SECRET: "nightly-local-test-session-signature",
};
const origin = `http://127.0.0.1:${env.PORT}`;

async function start() {
  const subprocess = Bun.spawn([process.execPath, "server/index.js"], { env, stdout: "ignore", stderr: "inherit" });
  try {
    for (let index = 0; index < 80; index++) {
      if (subprocess.exitCode != null) throw new Error(`Server stopped with exit code ${subprocess.exitCode}`);
      if ((await fetch(origin + "/health", { signal: AbortSignal.timeout(1000) }).catch(() => null))?.ok) {
        return subprocess;
      }
      await Bun.sleep(150);
    }
    throw new Error("Server did not become healthy.");
  } catch (error) {
    subprocess.kill();
    await subprocess.exited;
    throw error;
  }
}

async function request(path, { body, headers, method, status = 200, file } = {}) {
  const response = await fetch(origin + path, {
    method, redirect: "manual",
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : file,
  });
  if (response.status !== status) {
    throw new Error(`${method || "GET"} ${path} expected ${status}, received ${response.status}: ${await response.text()}`);
  }
  return response;
}

const resource = origin + "/mcp";
const authorizePath = "/oauth/authorize";

function postForm(path, fields, status = 200, headers = {}) {
  return request(path, {
    method: "POST", status, file: new URLSearchParams(fields),
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
  });
}

async function authorizeMcp() {
  const unauthenticated = await request("/mcp", { status: 401 });
  expect(unauthenticated.headers.get("www-authenticate")).toContain(
    `resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
  );
  await request("/mcp", { status: 401, headers: { Authorization: "Bearer nightly-local-test-mcp-access-token" } });
  const resourceMetadata = await (await request("/.well-known/oauth-protected-resource/mcp")).json();
  expect(resourceMetadata.resource).toBe(resource);
  expect(resourceMetadata.authorization_servers).toEqual([origin]);
  const issuer = await (await request("/.well-known/oauth-authorization-server")).json();
  expect(issuer.issuer).toBe(origin);
  expect(issuer.code_challenge_methods_supported).toEqual(["S256"]);
  const redirect = "http://127.0.0.1:54000/callback";
  const clientRegistration = (redirectUri, status) => request(new URL(issuer.registration_endpoint).pathname, {
    method: "POST", status, body: {
      client_name: "Nightly CI & OAuth",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
  });
  await clientRegistration("http://unrelated.example/callback", 400);
  const client = await (await clientRegistration(redirect, 201)).json();
  const verifier = randomBytes(32).toString("base64url");
  const query = {
    client_id: client.client_id,
    redirect_uri: redirect,
    response_type: "code",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    resource,
    state: crypto.randomUUID(),
    scope: "mcp:admin",
  };
  const authorizationUrl = (overrides) => authorizePath + "?" + new URLSearchParams({ ...query, ...overrides });
  await request(authorizationUrl({ redirect_uri: "https://unrelated.example/callback" }), { status: 400 });
  await request(authorizationUrl({ code_challenge_method: "plain" }), { status: 400 });
  const consent = await (await request(authorizationUrl())).text();
  expect(consent).toContain("Nightly CI &amp; OAuth");
  expect(consent).toContain("Admin password");
  const ticket = /name="ticket" value="([^"]+)"/.exec(consent)[1];
  const approve = { ticket, decision: "allow", password: env.ADMIN_PASSWORD };
  await postForm(authorizePath, approve, 403, { Origin: "https://unrelated.example" });
  const wrongPassword = await postForm(authorizePath, { ...approve, password: "incorrect" }, 401, { Origin: origin });
  expect(wrongPassword.headers.has("location")).toBe(false);
  const denied = await postForm(authorizePath, { ticket, decision: "deny" }, 303, { Origin: origin });
  expect(new URL(denied.headers.get("location")).searchParams.get("error")).toBe("access_denied");
  const approved = await postForm(authorizePath, approve, 303, { Origin: origin });
  const callback = new URL(approved.headers.get("location"));
  expect(callback.origin + callback.pathname).toBe(redirect);
  expect(callback.searchParams.get("state")).toBe(query.state);
  expect(callback.searchParams.get("iss")).toBe(origin);
  const exchange = (fields, status = 200) => postForm("/oauth/token", { client_id: client.client_id, resource, ...fields }, status);
  const grant = {
    grant_type: "authorization_code", code: callback.searchParams.get("code"), code_verifier: verifier, redirect_uri: redirect,
  };
  await exchange({ ...grant, resource: origin + "/admin" }, 400);
  await exchange({ ...grant, code_verifier: randomBytes(32).toString("base64url") }, 400);
  const tokens = await (await exchange(grant)).json();
  expect(tokens.scope).toBe("mcp:admin");
  expect(tokens.expires_in).toBeGreaterThan(890);
  await exchange(grant, 400);
  return { tokens, exchange };
}

test("nightly checkout, admin, CMS and MCP share durable Postgres data", async () => {
  let app = await start();
  const sql = new SQL(databaseUrl);
  try {
    const site = await (await request("/api/storefront")).json();
    expect(site.products.length).toBeGreaterThan(100);
    expect(await (await request("/")).text()).toContain("DAMA OBSRV");
    const compressed = await request("/", { headers: { "Accept-Encoding": "gzip" } });
    expect(compressed.headers.get("content-encoding")).toBe("gzip");
    expect(compressed.headers.get("vary")).toBe("Accept-Encoding");
    expect(await compressed.text()).toContain("DAMA OBSRV");
    const thumbnail = await request("/thumbnails/384/Tshirts/Circus_B_F.jpg.webp");
    expect(thumbnail.headers.get("content-type")).toBe("image/webp");
    expect(Buffer.from(await thumbnail.arrayBuffer()).subarray(8, 12).toString()).toBe("WEBP");
    expect((await request("/Tshirts/Circus_B_F.jpg")).headers.get("content-type")).toBe("image/jpeg");
    expect(await (await request("/admin")).text()).toContain("Dama Studio");
    expect((await request("/orders.html", { status: 302 })).headers.get("location")).toBe("/admin");
    await request("/api/admin/orders", { status: 401 });
    await request("/api/admin/login", { method: "POST", status: 403, body: { password: env.ADMIN_PASSWORD }, headers: { Origin: "https://unrelated.example" } });
    const signedIn = await request("/api/admin/login", { method: "POST", body: { password: env.ADMIN_PASSWORD }, headers: { Origin: origin } });
    const cookie = signedIn.headers.get("set-cookie");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    const admin = { Cookie: cookie.split(";")[0], Origin: origin };

    const catalog = groupTshirts(site.products.map((product) => ({ ...product, id: String(product.id) })));
    const shirt = catalog.find((product) => product.type === "Collabs" && product.section === "dama-x-elat");
    const shirtLine = resolveCatalogLine(catalog, `${shirt.skuIds?.[0] ?? shirt.id}::M`);
    const poster = site.products.find((product) => product.type === "Posters");
    const orderId = crypto.randomUUID();
    const customer = {
      name: `CI ${orderId}`, instagram: "nightly_test", whatsapp: "0912345678", phone: "",
      pickup: "Shalaan", notes: "Synthetic test order",
    };
    const order = {
      customer,
      items: [{ id: String(poster.id), quantity: 2, price: poster.price }, { id: shirtLine.id, quantity: 1, price: shirtLine.price }],
    };
    const total = 2 * poster.price + shirtLine.price;
    const submit = (body, id = orderId, status = 201) => request("/api/orders", {
      method: "POST", body, status, headers: { "Idempotency-Key": id, Origin: origin },
    });
    const bad = { ...order, items: [{ ...order.items[0], price: 1 }] };
    await submit(bad, crypto.randomUUID(), 409);
    const duplicate = await Promise.all([submit(order), submit(order)]);
    expect(await duplicate[0].json()).toEqual({ id: orderId, total });
    expect(await duplicate[1].json()).toEqual({ id: orderId, total });
    await submit({ ...order, customer: { ...customer, name: "Changed" } }, orderId, 409);
    const data = await (await request(`/api/admin/orders?search=${orderId}`, { headers: admin })).json();
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].items.map((item) => item.type)).toEqual(["Posters", "Collabs"]);
    await request("/api/admin/orders", { method: "PATCH", headers: admin, body: { id: orderId, revision: data.rows[0].revision, status: "confirmed" } });
    await request("/api/admin/orders", { method: "PATCH", headers: admin, status: 409, body: { id: orderId, revision: data.rows[0].revision, status: "cancelled" } });

    const image = Bun.file("assets/logo-dama.png");
    const upload = await request("/api/admin/assets?name=Test%20image.png", { method: "POST", status: 201, file: image, headers: admin });
    const asset = await upload.json();
    expect(Buffer.from(await (await request(asset.url)).arrayBuffer())).toEqual(Buffer.from(await image.arrayBuffer()));
    await request("/api/admin/assets?name=no.png", { method: "POST", status: 400, file: "not an image", headers: admin });
    const draft = { name: "Nightly test draft", type: "Posters", price: 25, image: asset.url, published: false };
    const product = await (await request("/api/admin/products", { method: "POST", status: 201, body: draft, headers: admin })).json();
    const publicCatalog = async () => (await (await request("/api/storefront")).json()).products;
    expect((await publicCatalog()).some(({ id }) => id === product.id)).toBe(false);
    await request("/api/admin/products", { method: "PATCH", body: { ...draft, id: product.id, revision: product.revision, published: true }, headers: admin });
    expect((await publicCatalog()).find(({ id }) => id === product.id)?.image).toBe(asset.url);
    await request(`/api/admin/assets/${asset.id}`, { method: "DELETE", headers: admin, status: 409 });
    const featureAsset = await (await request("/api/admin/assets?name=Feature.png", { method: "POST", status: 201, file: image, headers: admin })).json();
    const cms = await (await request("/api/admin/collections", { method: "PATCH", headers: admin, body: {
      type: "Collabs", section: "stunning-studio", label: "Studio collaboration", title: "New feature",
      image: featureAsset.url, alt: "Dama logo", revision: site.revision,
    } })).json();
    await request(`/api/admin/assets/${featureAsset.id}`, { method: "DELETE", headers: admin, status: 409 });

    const oauth = await authorizeMcp();
    const rpcHeaders = { Authorization: `Bearer ${oauth.tokens.access_token}`, Accept: "application/json, text/event-stream" };
    async function rpc(method, params = {}, version) {
      const response = await request("/mcp", {
        method: "POST",
        body: { jsonrpc: "2.0", id: 1, method, params },
        headers: {
          ...rpcHeaders, "Mcp-Method": method, ...(params.name ? { "Mcp-Name": params.name } : {}),
          ...(version ? { "MCP-Protocol-Version": version } : {}),
        },
      });
      const text = await response.text();
      const payload = JSON.parse(response.headers.get("content-type").includes("text/event-stream")
        ? text.split("\n").find((line) => line.startsWith("data: ")).slice(6) : text);
      if (payload.error || payload.result?.isError) throw new Error(JSON.stringify(payload));
      return payload.result;
    }
    const initialized = await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "nightly-ci", version: "1.0.0" } });
    const version = initialized.protocolVersion;
    const tools = await rpc("tools/list", {}, version);
    expect(tools.tools.map(({ name }) => name)).toContain("publish_storefront_copy");
    await rpc("tools/call", { name: "publish_storefront_copy", arguments: {
      revision: cms.revision, announcement: "Nightly publication check", about: "", observatory: "",
    } }, version);
    const throughMcp = await rpc("tools/call", { name: "get_storefront", arguments: {} }, version);
    expect(JSON.parse(throughMcp.content[0].text).copy.announcement).toBe("Nightly publication check");
    await rpc("tools/call", { name: "update_order_status", arguments: { id: orderId, revision: 2, status: "fulfilled" } }, version);
    const [stored] = await sql`SELECT status, total FROM orders WHERE id = ${orderId}`;
    expect(stored).toEqual({ status: "fulfilled", total });

    app.kill();
    await app.exited;
    app = await start();
    expect((await (await request("/api/storefront")).json()).copy.announcement).toBe("Nightly publication check");
    expect((await publicCatalog()).some(({ id }) => id === product.id)).toBe(true);
    await request("/api/admin/logout", { method: "POST", headers: admin });
    await rpc("tools/list", {}, version);
    const refresh = { grant_type: "refresh_token", refresh_token: oauth.tokens.refresh_token };
    const rotated = await (await oauth.exchange(refresh)).json();
    expect(rotated.refresh_token).not.toBe(refresh.refresh_token);
    await request("/mcp", { status: 401, headers: rpcHeaders });
    rpcHeaders.Authorization = `Bearer ${rotated.access_token}`;
    await rpc("tools/list", {}, version);
    await oauth.exchange(refresh, 400);
    await request("/mcp", { status: 401, headers: rpcHeaders });

    const directory = await mkdtemp(join(tmpdir(), "dama-import-test-"));
    try {
      const exportPath = join(directory, "orders.json");
      const source = `test-${crypto.randomUUID()}`;
      await Bun.write(exportPath, JSON.stringify([{
        Timestamp: "2026-01-01T12:00:00Z", Name: "Synthetic legacy order",
        Delivered: "true", Total: "400", Items: '[{"name":"Poster","quantity":2,"price":200}]',
      }]));
      for (const inserted of [1, 0]) {
        const imported = Bun.spawnSync([process.execPath, "scripts/import-orders.js", source, exportPath], { env });
        expect(imported.exitCode).toBe(0);
        expect(imported.stdout.toString()).toContain(`Imported ${inserted} orders.`);
      }
      const historical = await sql`SELECT status, total FROM orders WHERE customer->>'source' = ${source}`;
      expect([...historical]).toEqual([{ status: "fulfilled", total: 400 }]);
    } finally {
      await rm(directory, { recursive: true });
    }
  } finally {
    app.kill();
    await app.exited;
    await sql.close();
  }
}, 35_000);
