import OAuth2Server from "@node-oauth/oauth2-server";
import {
  getOAuthProtectedResourceMetadataUrl, oauthMetadataResponse, requireBearerAuth,
} from "@modelcontextprotocol/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db, StoreError } from "./store.js";
import {
  findClient, mcpScope, oauthModel, redirectAllowed, redirectUrl, registerClient, revokeAccess, verifyAccess,
} from "./oauth-store.js";

const grantTypes = ["authorization_code", "refresh_token"];
const clientMethods = ["none", "client_secret_basic", "client_secret_post"];
const protocolHeaders = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "WWW-Authenticate",
};
const reply = (data, status = 200, headers = {}) => Response.json(data, { status, headers: { ...protocolHeaders, ...headers } });
const error = (name, status = 400, headers) => reply({ error: name }, status, headers);
const invalidClient = () => error("invalid_client", 401, { "WWW-Authenticate": 'Basic realm="Dama OAuth"' });
const registration = z.object({
  client_name: z.string().trim().min(1).max(100).default("MCP client"),
  redirect_uris: z.array(z.string().max(2048).refine((uri) => redirectUrl(uri) !== null)).min(1).max(10),
  token_endpoint_auth_method: z.enum(clientMethods).default("client_secret_basic"),
  grant_types: z.array(z.enum(grantTypes)).optional(),
  response_types: z.array(z.literal("code")).min(1).optional(),
});
const authorization = z.object({
  client_id: z.string(),
  redirect_uri: z.string().max(2048),
  response_type: z.literal("code"),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code_challenge_method: z.literal("S256"),
  state: z.string().regex(/^[\x20-\x7e]{1,1024}$/).optional(),
  scope: z.literal(mcpScope).default(mcpScope),
  resource: z.string().max(2048).optional(),
});

const escape = (value) => String(value).replace(/[&<>"']/g, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

function consentPage(client, callback, ticket, signedIn, message = "", status = 200) {
  return new Response(`<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect to Dama Studio</title>
<style>
body{margin:0;padding:2rem 1rem;background:#f1eff8;color:#282238;font:16px/1.5 system-ui,sans-serif}
main{max-width:29rem;margin:4vh auto;background:white;border:1px solid #ded9eb;border-radius:1rem;padding:1.5rem}
h1{line-height:1.15;margin:0 0 1rem}code{overflow-wrap:anywhere}label{display:grid;gap:.35rem;font-weight:650}
input[type=password],button{font:inherit;padding:.65rem;border-radius:.55rem;border:1px solid #bfb6d0}
button{margin:.75rem .35rem 0 0;cursor:pointer;background:white;color:inherit}.primary{color:white;background:#5133ae}
a{color:#5133ae}.error{color:#931f40}
</style>
<main>
  <h1>Connect to Dama Studio</h1>
  <p><strong>${escape(client.name)}</strong> is requesting access to manage nightly orders, products, storefront content, and images.</p>
  <p>Callback <code>${escape(callback.origin + callback.pathname)}</code></p>
  ${message ? `<p class="error" role="alert">${escape(message)}</p>` : ""}
  <form method="post" action="/oauth/authorize">
    <input type="hidden" name="ticket" value="${escape(ticket)}">
    ${signedIn ? "" : '<label>Admin password<input type="password" name="password" autocomplete="current-password" maxlength="256" required></label>'}
    <button class="primary" name="decision" value="allow">Approve access</button>
    <button name="decision" value="deny" formnovalidate>Cancel</button>
  </form>
</main>
</html>`, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${callback.origin}; frame-ancestors 'none'; base-uri 'none'`,
    },
  });
}

function params(form) {
  const output = Object.create(null);
  for (const [key, value] of form) {
    if (Object.hasOwn(output, key)) return null;
    output[key] = value;
  }
  return output;
}

async function formBody(request) {
  if (request.headers.get("content-type")?.split(";")[0]?.toLowerCase() !== "application/x-www-form-urlencoded") return null;
  const text = await request.text();
  return text.length <= 16_384 ? params(new URLSearchParams(text)) : null;
}

function clientAuth(request, body) {
  const header = request.headers.get("authorization");
  if (!header) {
    return {
      id: body.client_id,
      secret: body.client_secret,
      method: body.client_secret == null ? "none" : "client_secret_post",
    };
  }
  const basic = /^Basic\s+([a-z0-9+/=]+)$/i.exec(header);
  if (!basic || body.client_secret != null) return null;
  const credentials = /^([^:]+):([^:]+)$/.exec(Buffer.from(basic[1], "base64").toString("utf8"));
  if (!credentials || (body.client_id != null && body.client_id !== credentials[1])) return null;
  return { id: credentials[1], secret: credentials[2], method: "client_secret_basic" };
}

function serverFor(model) {
  return new OAuth2Server({
    model,
    allowEmptyState: true,
    requirePKCE: true,
    requireClientAuthentication: { authorization_code: false, refresh_token: false },
    authorizationCodeLifetime: 120,
    accessTokenLifetime: 15 * 60,
    refreshTokenLifetime: 30 * 24 * 60 * 60,
  });
}

function oauthError(failure) {
  if (!(failure instanceof OAuth2Server.OAuthError) || failure.code >= 500) throw failure;
  return failure.name === "invalid_client" ? invalidClient() : error(failure.name, failure.code);
}

export function createOAuth({ origin, secret, hasSession, signIn }) {
  const resourceServerUrl = new URL("/mcp", origin);
  const resource = resourceServerUrl.href;
  const metadata = {
    resourceServerUrl,
    scopesSupported: [mcpScope],
    resourceName: "Dama Studio Nightly",
    oauthMetadata: {
      issuer: origin,
      authorization_endpoint: origin + "/oauth/authorize",
      token_endpoint: origin + "/oauth/token",
      registration_endpoint: origin + "/oauth/register",
      revocation_endpoint: origin + "/oauth/revoke",
      response_types_supported: ["code"],
      grant_types_supported: grantTypes,
      token_endpoint_auth_methods_supported: clientMethods,
      revocation_endpoint_auth_methods_supported: clientMethods,
      code_challenge_methods_supported: ["S256"],
      scopes_supported: [mcpScope],
      authorization_response_iss_parameter_supported: true,
    },
  };
  const authenticate = requireBearerAuth({
    verifier: { verifyAccessToken: (token) => verifyAccess(token, resource) },
    requiredScopes: [mcpScope],
    expectedResource: resourceServerUrl,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceServerUrl),
  });
  const sign = (value) => createHmac("sha256", secret).update(`mcp-consent:${value}`).digest();
  const ticketFor = (query) => {
    const data = Buffer.from(JSON.stringify({ query, expires: Date.now() + 10 * 60_000 })).toString("base64url");
    return `${data}.${sign(data).toString("base64url")}`;
  };
  function readTicket(ticket) {
    const untrusted = /^([a-z0-9_-]{1,9000})\.([a-z0-9_-]{43})$/i.exec(ticket ?? "");
    if (!untrusted || !timingSafeEqual(sign(untrusted[1]), Buffer.from(untrusted[2], "base64url"))) return null;
    const { query, expires } = JSON.parse(Buffer.from(untrusted[1], "base64url").toString("utf8"));
    return expires > Date.now() ? query : null;
  }

  function redirect(uri, state, fields, sessionCookie) {
    const url = new URL(uri);
    for (const [key, value] of Object.entries(fields)) url.searchParams.set(key, value);
    if (state != null) url.searchParams.set("state", state);
    url.searchParams.set("iss", origin);
    const headers = { "Cache-Control": "no-store", Location: url.href };
    if (sessionCookie) headers["Set-Cookie"] = sessionCookie;
    return new Response(null, { status: 303, headers });
  }

  async function authorize(request, url, server) {
    const posted = request.method === "POST";
    if (posted && request.headers.get("origin") !== origin) return error("invalid_request", 403);
    const form = posted ? await formBody(request) : null;
    const query = authorization.safeParse(posted ? readTicket(form?.ticket) : params(url.searchParams));
    if (!query.success) return error("invalid_request");
    const { client_id, redirect_uri, state, resource: target } = query.data;
    const client = await findClient(client_id);
    if (!client || !redirectAllowed(redirect_uri, client)) return error("invalid_request");
    if (target != null && target !== resource) return redirect(redirect_uri, state, { error: "invalid_target" });

    const signedIn = hasSession(request);
    const callback = new URL(redirect_uri);
    if (!posted) return consentPage(client, callback, ticketFor(query.data), signedIn);
    if (form.decision === "deny") return redirect(redirect_uri, state, { error: "access_denied" });
    if (form.decision !== "allow") return error("invalid_request");
    let sessionCookie;
    try {
      if (!signedIn) sessionCookie = await signIn(request, server, form.password);
    } catch (failure) {
      if (failure instanceof StoreError) return consentPage(client, callback, form.ticket, false, failure.message, failure.status);
      throw failure;
    }

    const oauthRequest = new OAuth2Server.Request({ headers: {}, method: "GET", query: query.data });
    const response = new OAuth2Server.Response();
    try {
      const code = await serverFor(oauthModel(db, resource, false)).authorize(oauthRequest, response, {
        authenticateHandler: { handle: () => ({ id: "dama-admin" }) },
      });
      return redirect(redirect_uri, state, { code: code.authorizationCode }, sessionCookie);
    } catch (failure) {
      return oauthError(failure);
    }
  }

  async function register(request) {
    if (request.headers.get("content-type")?.split(";")[0]?.toLowerCase() !== "application/json") return error("invalid_client_metadata");
    let body;
    try {
      const text = await request.text();
      if (text.length > 16_384) return error("invalid_client_metadata");
      body = JSON.parse(text);
    } catch {
      return error("invalid_client_metadata");
    }
    const input = registration.safeParse(body);
    if (!input.success || (input.data.grant_types && !input.data.grant_types.includes("authorization_code"))) {
      return error("invalid_client_metadata");
    }
    const { client_name, redirect_uris, token_endpoint_auth_method } = input.data;
    const { id, secret: clientSecret } = await registerClient(client_name, [...new Set(redirect_uris)], token_endpoint_auth_method);
    return reply({
      client_id: id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
      client_name,
      redirect_uris,
      token_endpoint_auth_method,
      grant_types: grantTypes,
      response_types: ["code"],
      scope: mcpScope,
    }, 201);
  }

  async function exchange(request) {
    const body = await formBody(request);
    if (!body) return error("invalid_request");
    if (body.resource != null && body.resource !== resource) return error("invalid_target");
    if (!grantTypes.includes(body.grant_type)) return error("unsupported_grant_type");
    const client = clientAuth(request, body);
    if (!client) return invalidClient();
    const oauthRequest = new OAuth2Server.Request({
      method: "POST", query: {}, body,
      headers: { ...Object.fromEntries(request.headers), "content-length": String(new URLSearchParams(body).toString().length) },
    });
    try {
      return await db.begin(async (tx) => {
        const model = oauthModel(tx, resource, true, client.method);
        const response = new OAuth2Server.Response();
        try {
          await serverFor(model).token(oauthRequest, response);
          return reply(response.body);
        } catch (failure) {
          // A replay revokes the grant durably. Other failures roll back partial writes.
          if (model.wasReplay()) return oauthError(failure);
          throw failure;
        }
      });
    } catch (failure) {
      return oauthError(failure);
    }
  }

  async function revoke(request) {
    const body = await formBody(request);
    if (!body?.token) return error("invalid_request");
    const client = clientAuth(request, body);
    if (!client || !await revokeAccess(client.id, client.secret, client.method, body.token, resource)) return invalidClient();
    return new Response(null, { status: 200, headers: protocolHeaders });
  }

  return {
    authenticate,
    async handle(request, url, server) {
      const metadataResult = oauthMetadataResponse(request, metadata);
      if (metadataResult) return metadataResult;
      if (url.pathname === "/oauth/authorize" && ["GET", "POST"].includes(request.method)) return authorize(request, url, server);
      const handlers = { "/oauth/register": register, "/oauth/token": exchange, "/oauth/revoke": revoke };
      if (!Object.hasOwn(handlers, url.pathname)) return null;
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: {
        ...protocolHeaders, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type",
      } });
      if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST, OPTIONS" } });
      return handlers[url.pathname](request);
    },
  };
}
