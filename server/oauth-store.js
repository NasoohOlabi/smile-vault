import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";
import { db } from "./store.js";

export const mcpScope = "mcp:admin";
const admin = { id: "dama-admin" };
const digest = (secret) => createHash("sha256").update(secret).digest("hex");
const random = () => randomBytes(32).toString("base64url");

function clientMatches(client, secret, method) {
  if (!client || method !== client.auth_method) return false;
  if (method === "none") return secret == null;
  return typeof secret === "string" && timingSafeEqual(Buffer.from(digest(secret)), Buffer.from(client.secret_hash));
}

export function redirectUrl(value) {
  if (typeof value !== "string" || value.includes("*") || value.includes("#")) return null;
  const url = URL.parse(value);
  if (!url || url.username || url.password) return null;
  if (url.protocol === "https:" || loopback(url)) return url;
  return null;
}

function loopback(url) {
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

export function redirectAllowed(uri, client) {
  const target = redirectUrl(uri);
  if (!target) return false;
  return client.redirect_uris.some((registered) => {
    if (registered === uri) return true;
    const source = new URL(registered);
    return loopback(target) && loopback(source) && target.hostname === source.hostname
      && target.pathname === source.pathname && target.search === source.search;
  });
}

export async function registerClient(name, redirects, method) {
  const id = random();
  const secret = method === "none" ? null : random();
  await db`
    INSERT INTO mcp_oauth_clients (id, name, redirect_uris, auth_method, secret_hash)
    VALUES (${id}, ${name}, ${JSON.stringify(redirects)}::text::jsonb, ${method}, ${secret && digest(secret)})
  `;
  return { id, secret };
}

export async function findClient(id, sql = db) {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(id)) return;
  const [client] = await sql`SELECT * FROM mcp_oauth_clients WHERE id = ${id}`;
  return client;
}

export async function verifyAccess(token, resource) {
  const [row] = await db`
    SELECT g.client_id, g.resource, least(g.expires_at, t.expires_at) AS expires_at
    FROM mcp_oauth_tokens t JOIN mcp_oauth_grants g ON g.id = t.grant_id
    WHERE t.digest = ${digest(token)} AND t.kind = 'access'
      AND g.resource = ${resource} AND t.expires_at > now() AND g.expires_at > now()
  `;
  if (!row) throw new OAuthError(OAuthErrorCode.InvalidToken, "Access token is invalid or expired");
  return {
    token, clientId: row.client_id, resource: new URL(row.resource), scopes: [mcpScope],
    expiresAt: Math.floor(row.expires_at.getTime() / 1000),
  };
}

export async function revokeAccess(clientId, secret, method, token, resource) {
  if (!clientMatches(await findClient(clientId), secret, method)) return false;
  await db`
    DELETE FROM mcp_oauth_grants g WHERE g.client_id = ${clientId} AND g.resource = ${resource}
      AND g.id = (SELECT grant_id FROM mcp_oauth_tokens WHERE digest = ${digest(token)})
  `;
  return true;
}

export function oauthModel(sql, resource, authenticate, authMethod) {
  let currentClient;
  let currentGrant;
  let replayed = false;
  return {
    wasReplay: () => replayed,
    async getClient(id, secret) {
      const client = await findClient(id, sql);
      if (!client || (authenticate && !clientMatches(client, secret, authMethod))) return;
      currentClient = { ...client, grants: ["authorization_code", "refresh_token"], redirectUris: client.redirect_uris };
      return currentClient;
    },
    validateRedirectUri: redirectAllowed,
    validateScope(_user, _client, scope) {
      if (!scope?.length || (scope.length === 1 && scope[0] === mcpScope)) return [mcpScope];
      return false;
    },
    async saveAuthorizationCode(code, client, user) {
      await sql`DELETE FROM mcp_oauth_codes WHERE expires_at < now()`;
      await sql`
        INSERT INTO mcp_oauth_codes (digest, client_id, redirect_uri, challenge, resource, expires_at)
        VALUES (${digest(code.authorizationCode)}, ${client.id}, ${code.redirectUri}, ${code.codeChallenge}, ${resource}, ${code.expiresAt})
      `;
      return { ...code, client, user };
    },
    async getAuthorizationCode(code) {
      const [record] = await sql`
        SELECT * FROM mcp_oauth_codes WHERE digest = ${digest(code)}
          AND client_id = ${currentClient.id} AND resource = ${resource} AND expires_at > now() FOR UPDATE
      `;
      if (!record) return;
      return {
        authorizationCode: code, expiresAt: record.expires_at, redirectUri: record.redirect_uri,
        codeChallenge: record.challenge, codeChallengeMethod: "S256", client: currentClient, user: admin, scope: [mcpScope],
      };
    },
    async revokeAuthorizationCode(code) {
      const [removed] = await sql`DELETE FROM mcp_oauth_codes WHERE digest = ${digest(code.authorizationCode)} RETURNING digest`;
      return Boolean(removed);
    },
    async getRefreshToken(token) {
      const hash = digest(token);
      // Lock the grant first, then reread the token so a concurrent rotation is visible.
      const [grant] = await sql`
        SELECT * FROM mcp_oauth_grants WHERE client_id = ${currentClient.id}
          AND resource = ${resource} AND expires_at > now()
          AND id = (SELECT grant_id FROM mcp_oauth_tokens WHERE digest = ${hash} AND kind = 'refresh')
        FOR UPDATE
      `;
      if (!grant) return;
      const [record] = await sql`
        SELECT used, expires_at FROM mcp_oauth_tokens WHERE digest = ${hash} AND expires_at > now()
      `;
      if (!record) return;
      if (record.used) {
        await sql`DELETE FROM mcp_oauth_grants WHERE id = ${grant.id}`;
        replayed = true;
        return;
      }
      currentGrant = grant;
      return {
        refreshToken: token, refreshTokenExpiresAt: record.expires_at, client: currentClient, user: admin, scope: [mcpScope],
      };
    },
    async revokeToken(token) {
      const [used] = await sql`
        UPDATE mcp_oauth_tokens SET used = true WHERE digest = ${digest(token.refreshToken)} AND NOT used RETURNING grant_id
      `;
      if (!used) return false;
      await sql`DELETE FROM mcp_oauth_tokens WHERE grant_id = ${used.grant_id} AND kind = 'access'`;
      return true;
    },
    async saveToken(token, client, user) {
      if (!currentGrant) {
        await sql`DELETE FROM mcp_oauth_grants WHERE expires_at < now()`;
        [currentGrant] = await sql`
          INSERT INTO mcp_oauth_grants (id, client_id, resource, expires_at)
          VALUES (${crypto.randomUUID()}, ${client.id}, ${resource}, ${token.refreshTokenExpiresAt}) RETURNING *
        `;
      }
      const refreshTokenExpiresAt = currentGrant.expires_at;
      const accessTokenExpiresAt = new Date(Math.min(token.accessTokenExpiresAt.getTime(), refreshTokenExpiresAt.getTime()));
      await sql`
        INSERT INTO mcp_oauth_tokens (digest, grant_id, kind, expires_at)
        VALUES
          (${digest(token.accessToken)}, ${currentGrant.id}, 'access', ${accessTokenExpiresAt}),
          (${digest(token.refreshToken)}, ${currentGrant.id}, 'refresh', ${refreshTokenExpiresAt})
      `;
      return { ...token, accessTokenExpiresAt, refreshTokenExpiresAt, client, user };
    },
  };
}
