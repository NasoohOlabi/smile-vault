import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { mcp } from "./mcp.js";
import { createOAuth } from "./oauth.js";
import {
  addAsset, assetId, assets, checkoutInput, collectionInput, copyInput, getAsset, initialize,
  listOrders, orderSummary, orderUpdateInput, placeOrder, productInput, products, removeAsset,
  renameAsset, saveCollection, saveCopy, saveProduct, settings, staticFile, statuses,
  StoreError, updateOrder, updateProductInput, validate,
} from "./store.js";

const { DATABASE_URL, ADMIN_PASSWORD, SESSION_SECRET, RAILWAY_PUBLIC_DOMAIN } = process.env;
if (!DATABASE_URL || [ADMIN_PASSWORD, SESSION_SECRET].some((value) => !value || value.length < 24)) {
  throw new Error("Set DATABASE_URL and at least 24 characters each for ADMIN_PASSWORD and SESSION_SECRET.");
}
const port = Number(process.env.PORT || 3000);
const publicOrigin = process.env.APP_ORIGIN || (RAILWAY_PUBLIC_DOMAIN ? `https://${RAILWAY_PUBLIC_DOMAIN}` : "");
const cookieName = publicOrigin.startsWith("https:") ? "__Host-dama_admin" : "dama_admin";
const sessionSeconds = 8 * 60 * 60;
const attempts = new Map();
const safe = (value, expected) => typeof value === "string" && timingSafeEqual(
  createHash("sha256").update(value).digest(),
  createHash("sha256").update(expected).digest(),
);
const sign = (value) => createHmac("sha256", SESSION_SECRET).update(`${value}:${ADMIN_PASSWORD}`).digest("base64url");
const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
const cookie = (value, ttl) => `${cookieName}=${value}; Path=/; Max-Age=${ttl}; HttpOnly; SameSite=Strict${publicOrigin.startsWith("https:") ? "; Secure" : ""}`;

function acceptsGzip(request) {
  return (request.headers.get("accept-encoding") ?? "").split(",").some((entry) => {
    const [coding, quality = "q=1"] = entry.trim().toLowerCase().split(/\s*;\s*/);
    return coding === "gzip" && Number(quality.split("=")[1]) > 0;
  });
}

function hasSession(request) {
  const value = request.headers.get("cookie")?.split(/;\s*/).find((part) => part.startsWith(`${cookieName}=`));
  const [timestamp, signature] = value?.slice(cookieName.length + 1).split(".") ?? [];
  return /^\d+$/.test(timestamp ?? "") && Number(timestamp) > Date.now() && safe(signature, sign(timestamp));
}

function checkOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const local = [`http://localhost:${port}`, `http://127.0.0.1:${port}`, "http://localhost:5173", "http://127.0.0.1:5173"];
  if (publicOrigin ? origin !== publicOrigin : !local.includes(origin)) throw new StoreError(403, "This request came from a different site.");
}

function throttle(server, request, operation, max, windowMs) {
  const now = Date.now();
  const ip = RAILWAY_PUBLIC_DOMAIN ? request.headers.get("x-real-ip") : server.requestIP(request)?.address;
  const key = `${operation}:${ip || "unknown"}`;
  if (attempts.size >= 10_000) {
    for (const [name, record] of attempts) if (record.until <= now) attempts.delete(name);
    if (attempts.size >= 10_000) throw new StoreError(429, "Too many requests. Try again shortly.");
  }
  let record = attempts.get(key);
  if (!record || record.until <= now) {
    record = { until: now + windowMs, count: 0 };
    attempts.set(key, record);
  }
  if (++record.count > max) throw new StoreError(429, "Too many requests. Try again shortly.");
  return key;
}

function signIn(password, key) {
  const value = validate(z.string().min(1).max(256), password);
  if (!safe(value, ADMIN_PASSWORD)) throw new StoreError(401, "That password doesn’t match. Try again.");
  attempts.delete(key);
  const expiry = Date.now() + sessionSeconds * 1000;
  return cookie(`${expiry}.${sign(expiry)}`, sessionSeconds);
}

const oauth = createOAuth({
  origin: publicOrigin || `http://127.0.0.1:${port}`,
  secret: SESSION_SECRET,
  hasSession,
  signIn: (request, server, password) => signIn(password, throttle(server, request, "login", 10, 10 * 60_000)),
});

async function readJson(request) {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") {
    throw new StoreError(415, "Send this request as JSON.");
  }
  try {
    return await request.json();
  } catch {
    throw new StoreError(400, "Send valid JSON.");
  }
}

async function handle(request, server) {
  const url = new URL(request.url);
  const { pathname, searchParams } = url;
  const { method } = request;
  if (pathname === "/health") {
    await settings();
    return json({ ok: true, commit: process.env.RAILWAY_GIT_COMMIT_SHA || null });
  }
  if (pathname === "/mcp") {
    checkOrigin(request);
    const authInfo = await oauth.authenticate(request);
    return authInfo instanceof Response ? authInfo : mcp.fetch(request, { authInfo });
  }
  if (pathname.startsWith("/.well-known/") || pathname.startsWith("/oauth/")) {
    if (method === "POST" && pathname === "/oauth/register") throttle(server, request, "oauth-register", 30, 10 * 60_000);
    if (method === "POST" && pathname === "/oauth/token") throttle(server, request, "oauth-token", 120, 60_000);
    const response = await oauth.handle(request, url, server);
    if (response) return response;
  }
  if (pathname === "/api/storefront" && method === "GET") {
    const [site, catalog] = await Promise.all([settings(), products()]);
    return json({ ...site, products: catalog });
  }
  if (pathname === "/api/orders" && method === "POST") {
    checkOrigin(request);
    throttle(server, request, "checkout", 30, 60_000);
    const id = validate(assetId, request.headers.get("idempotency-key"));
    return json(await placeOrder(id, validate(checkoutInput, await readJson(request))), 201);
  }
  if (pathname === "/api/admin/login" && method === "POST") {
    checkOrigin(request);
    const key = throttle(server, request, "login", 10, 10 * 60_000);
    const { password } = (await readJson(request)) ?? {};
    return json({ signedIn: true }, 200, { "Set-Cookie": signIn(password, key) });
  }
  if (pathname.startsWith("/api/admin/")) {
    if (method !== "GET") checkOrigin(request);
    if (!hasSession(request)) throw new StoreError(401, "Sign in to open the admin dashboard.");
    const route = pathname.slice("/api/admin/".length);
    if (route === "session" && method === "GET") return json({ signedIn: true });
    if (route === "logout" && method === "POST") return json({}, 200, { "Set-Cookie": cookie("", 0) });
    if (route === "orders" && method === "GET") {
      const filter = validate(z.object({
        status: statuses.optional(),
        search: z.string().max(100).optional(),
        page: z.coerce.number().int().min(1).max(1000).optional(),
      }), Object.fromEntries(searchParams));
      const [rows, summary] = await Promise.all([listOrders(filter), orderSummary()]);
      return json({ rows: rows.slice(0, 50), more: rows.length > 50, summary });
    }
    if (route === "orders" && method === "PATCH") return json(await updateOrder(validate(orderUpdateInput, await readJson(request))));
    if (route === "products" && method === "GET") return json(await products(true));
    if (route === "products" && method === "POST") return json(await saveProduct(validate(productInput, await readJson(request))), 201);
    if (route === "products" && method === "PATCH") return json(await saveProduct(validate(updateProductInput, await readJson(request))));
    if (route === "storefront" && method === "GET") return json(await settings());
    if (route === "storefront" && method === "PATCH") return json(await saveCopy(validate(copyInput, await readJson(request))));
    if (route === "collections" && method === "PATCH") return json(await saveCollection(validate(collectionInput, await readJson(request))));
    if (route === "assets" && method === "GET") return json(await assets());
    if (route === "assets" && method === "POST") {
      return json(await addAsset(searchParams.get("name"), Buffer.from(await request.arrayBuffer())), 201);
    }
    if (route.startsWith("assets/") && (method === "DELETE" || method === "PATCH")) {
      const id = validate(assetId, route.slice("assets/".length));
      if (method === "DELETE") return json(await removeAsset(id));
      const { name } = validate(z.object({ name: z.string().min(1).max(160) }), await readJson(request));
      return json(await renameAsset(id, name));
    }
  }
  if (method === "GET" || method === "HEAD") {
    if (pathname === "/orders.html") return new Response(null, { status: 302, headers: { Location: "/admin" } });
    if (pathname.startsWith("/media/")) {
      const id = validate(assetId, pathname.slice("/media/".length));
      const image = await getAsset(id);
      if (image) return new Response(method === "HEAD" ? null : image.bytes, {
        headers: { "Content-Type": image.mime, "Cache-Control": "public, max-age=3600" },
      });
    } else {
      const path = pathname === "/" ? "/index.html" : pathname === "/admin" ? "/admin.html" : pathname;
      const file = staticFile(decodeURIComponent(path));
      if (await file?.exists()) {
        const headers = {
          "Content-Type": file.type,
          "Cache-Control": path.endsWith(".html") ? "no-cache" : "public, max-age=3600",
        };
        if (/\.(?:html|css|js)$/.test(path)) {
          headers.Vary = "Accept-Encoding";
          if (acceptsGzip(request)) {
            headers["Content-Encoding"] = "gzip";
            const body = method === "HEAD" ? null : file.stream().pipeThrough(new CompressionStream("gzip"));
            return new Response(body, { headers });
          }
        }
        return new Response(method === "HEAD" ? null : file, { headers });
      }
    }
  }
  return json({ error: "This page or action was not found." }, 404);
}

await initialize();
Bun.serve({
  hostname: "0.0.0.0",
  port,
  maxRequestBodySize: 7 * 1024 * 1024,
  async fetch(request, server) {
    let response;
    try {
      response = await handle(request, server);
    } catch (error) {
      if (!(error instanceof StoreError)) console.error("Request failed", request.method, error.code ?? error.name);
      response = error instanceof StoreError
        ? json({ error: error.message }, error.status)
        : json({ error: "The store is temporarily unavailable. Try again." }, 500);
    }
    const headers = new Headers(response.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Robots-Tag", "noindex, nofollow");
    headers.set("Referrer-Policy", "same-origin");
    if (!headers.has("Content-Security-Policy")) {
      headers.set("Content-Security-Policy", "frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
    }
    return new Response(response.body, { status: response.status, headers });
  },
});
console.log(`Dama Nightly listening on port ${port}`);
