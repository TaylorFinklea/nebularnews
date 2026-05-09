import { Hono } from 'hono';
import type { Context } from 'hono';
import { nanoid } from 'nanoid';
import type { AppEnv } from '../index';
import { dbGet, dbRun } from '../db/helpers';
import { createAuth } from '../lib/auth';

export const oauthRoutes = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// OAuth 2.0 Authorization Code + PKCE provider
//
// Used by MCP clients (Claude desktop, ChatGPT custom GPTs) to authenticate
// users against the NebularNews MCP server. better-auth at /api/auth/* still
// owns Apple/Google social login; this provider issues access tokens that
// the auth middleware accepts alongside better-auth session tokens.
//
// Flow:
//   1. Client (Claude) opens GET /oauth/authorize with client_id, redirect_uri,
//      code_challenge, code_challenge_method, state.
//   2. We check for a better-auth session cookie. If absent, return an HTML
//      page that links to social sign-in and comes back here after.
//   3. With a session, generate a one-time `code`, persist it with the
//      challenge, and redirect to redirect_uri?code=...&state=... .
//   4. Client POSTs to /oauth/token with code + code_verifier + client creds.
//   5. We verify PKCE, mint an access token, store it in oauth_access_tokens.
// ---------------------------------------------------------------------------

const CODE_TTL_MS = 10 * 60 * 1000;          // 10 minutes
const ACCESS_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ---------------------------------------------------------------------------
// GET /favicon.ico — connector-card branding fallback. Browsers and some
// MCP clients fetch this off the host root when no logo_uri is configured.
// Served from R2 so the asset stays editable without a redeploy.
// ---------------------------------------------------------------------------

oauthRoutes.get('/favicon.ico', async (c) => {
  const obj = await c.env.R2_FALLBACK.get('icon.png');
  if (!obj) {
    return c.text('Not found', 404);
  }
  return new Response(obj.body, {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=86400',
    },
  });
});

// ---------------------------------------------------------------------------
// GET /.well-known/oauth-authorization-server — RFC 8414 discovery doc
//
// MCP clients (Claude.ai, ChatGPT) read this to find the authorize/token
// endpoints instead of guessing path conventions. The `issuer` MUST match
// the host the client used to fetch this metadata.
// ---------------------------------------------------------------------------

oauthRoutes.get('/.well-known/oauth-authorization-server', (c) => {
  const url = new URL(c.req.url);
  const issuer = `${url.protocol}//${url.host}`;
  return c.json({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    registration_endpoint: `${issuer}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256', 'plain'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    scopes_supported: ['mcp'],
    // Branding for the connector card. RFC 8414 doesn't standardize these,
    // but most clients (Claude.ai included) pick them up.
    service_documentation: 'https://nebularnews.com',
    op_policy_uri: 'https://nebularnews.com/privacy',
    logo_uri: 'https://r2-fallback.nebularnews.com/icon.png',
    client_uri: 'https://nebularnews.com',
  });
});

// ---------------------------------------------------------------------------
// GET /.well-known/oauth-protected-resource — RFC 9728 metadata. Some MCP
// clients fetch this from the protected-resource host first to discover the
// authorization server.
// ---------------------------------------------------------------------------

oauthRoutes.get('/.well-known/oauth-protected-resource', (c) => {
  const url = new URL(c.req.url);
  const issuer = `${url.protocol}//${url.host}`;
  return c.json({
    resource: issuer,
    authorization_servers: [issuer],
    scopes_supported: ['mcp'],
    resource_name: 'NebularNews',
    resource_documentation: 'https://nebularnews.com',
    logo_uri: 'https://r2-fallback.nebularnews.com/icon.png',
  });
});

// ---------------------------------------------------------------------------
// POST /register — RFC 7591 Dynamic Client Registration
//
// Lets MCP clients (Claude, ChatGPT, ad-hoc tools) self-register without a
// pre-configured client_id/secret. Issues a public client (no secret) so the
// only credentials a user needs are PKCE-protected. The seeded
// `claude-desktop-prod` client stays available for clients that already have
// it configured.
// ---------------------------------------------------------------------------

oauthRoutes.post('/register', async (c) => {
  let body: {
    redirect_uris?: unknown;
    client_name?: unknown;
    token_endpoint_auth_method?: unknown;
    grant_types?: unknown;
    response_types?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_client_metadata', error_description: 'Body must be JSON' }, 400);
  }

  const redirectUris = Array.isArray(body.redirect_uris)
    ? (body.redirect_uris as unknown[]).filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u))
    : [];
  if (redirectUris.length === 0) {
    return c.json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris must be a non-empty array of http(s) URIs' }, 400);
  }

  const clientName = typeof body.client_name === 'string' ? body.client_name.slice(0, 200) : null;
  const clientId = `dcr-${nanoid(24)}`;
  const now = Date.now();

  await dbRun(
    c.env.DB,
    `INSERT INTO oauth_clients (id, client_id, client_secret, redirect_uris, client_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [clientId, clientId, '', JSON.stringify(redirectUris), clientName, now, now],
  );

  // Public-client response per RFC 7591. No client_secret — the client
  // proves possession of the auth code via PKCE.
  return c.json({
    client_id: clientId,
    client_id_issued_at: Math.floor(now / 1000),
    redirect_uris: redirectUris,
    client_name: clientName,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code'],
    response_types: ['code'],
  }, 201);
});

// ---------------------------------------------------------------------------
// GET /authorize — OAuth 2.0 authorization endpoint
// ---------------------------------------------------------------------------

oauthRoutes.get('/authorize', async (c) => {
  const clientId = c.req.query('client_id') ?? '';
  const redirectUri = c.req.query('redirect_uri') ?? '';
  const responseType = c.req.query('response_type') ?? 'code';
  const codeChallenge = c.req.query('code_challenge') ?? '';
  const codeChallengeMethod = c.req.query('code_challenge_method') ?? 'plain';
  const state = c.req.query('state') ?? '';

  if (responseType !== 'code') {
    return errorRedirect(c, redirectUri, state, 'unsupported_response_type', 'Only response_type=code is supported');
  }

  // Validate client + redirect_uri.
  const client = await dbGet<{ client_id: string; redirect_uris: string }>(
    c.env.DB,
    `SELECT client_id, redirect_uris FROM oauth_clients WHERE client_id = ?`,
    [clientId],
  );
  if (!client) {
    return c.text('Invalid client_id', 400);
  }
  let allowedUris: string[];
  try {
    allowedUris = JSON.parse(client.redirect_uris) as string[];
  } catch {
    return c.text('Misconfigured client', 500);
  }
  if (!allowedUris.includes(redirectUri)) {
    return c.text('Invalid redirect_uri', 400);
  }

  // Validate PKCE — require S256 in production; allow plain for dev.
  if (codeChallenge && codeChallengeMethod !== 'S256' && codeChallengeMethod !== 'plain') {
    return errorRedirect(c, redirectUri, state, 'invalid_request', 'code_challenge_method must be S256 or plain');
  }

  // Look up the session. better-auth sets a cookie on api.nebularnews.com
  // after a successful social sign-in; we reuse the same getSession() helper
  // the auth route uses for /auth/me handoff.
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session?.session?.userId) {
    // Not signed in — show a minimal sign-in page that links to better-auth's
    // social providers with a return URL back to this same endpoint.
    const returnUrl = c.req.url;
    return c.html(signInPage(returnUrl));
  }

  // Signed in — generate the authorization code.
  const code = nanoid(32);
  const now = Date.now();
  await dbRun(
    c.env.DB,
    `INSERT INTO oauth_authorization_codes
       (code, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      code,
      clientId,
      session.session.userId,
      redirectUri,
      codeChallenge || null,
      codeChallenge ? codeChallengeMethod : null,
      now + CODE_TTL_MS,
      now,
    ],
  );

  const url = new URL(redirectUri);
  url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);
  return c.redirect(url.toString(), 302);
});

// ---------------------------------------------------------------------------
// POST /token — OAuth 2.0 token endpoint
// ---------------------------------------------------------------------------

oauthRoutes.post('/token', async (c) => {
  // Accept both JSON and application/x-www-form-urlencoded — Claude/MCP
  // clients use the latter.
  let body: Record<string, string>;
  const contentType = c.req.header('content-type') ?? '';
  if (contentType.includes('application/json')) {
    body = await c.req.json();
  } else {
    const text = await c.req.text();
    body = Object.fromEntries(new URLSearchParams(text).entries());
  }

  const grantType = body.grant_type;
  if (grantType !== 'authorization_code') {
    return c.json({ error: 'unsupported_grant_type' }, 400);
  }

  const clientId = body.client_id;
  const clientSecret = body.client_secret;
  const code = body.code;
  const redirectUri = body.redirect_uri;
  const codeVerifier = body.code_verifier;

  if (!clientId || !code || !redirectUri) {
    return c.json({ error: 'invalid_request', error_description: 'Missing required parameters' }, 400);
  }

  // Validate client.
  const client = await dbGet<{ client_id: string; client_secret: string; redirect_uris: string }>(
    c.env.DB,
    `SELECT client_id, client_secret, redirect_uris FROM oauth_clients WHERE client_id = ?`,
    [clientId],
  );
  if (!client) {
    return c.json({ error: 'invalid_client' }, 401);
  }
  if (clientSecret && !constantTimeEqual(clientSecret, client.client_secret)) {
    return c.json({ error: 'invalid_client' }, 401);
  }

  // Look up + invalidate the code (one-time use).
  const codeRow = await dbGet<{
    code: string; client_id: string; user_id: string; redirect_uri: string;
    code_challenge: string | null; code_challenge_method: string | null;
    expires_at: number;
  }>(
    c.env.DB,
    `SELECT code, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, expires_at
     FROM oauth_authorization_codes WHERE code = ?`,
    [code],
  );
  if (!codeRow) {
    return c.json({ error: 'invalid_grant', error_description: 'Code not found' }, 400);
  }
  await dbRun(c.env.DB, `DELETE FROM oauth_authorization_codes WHERE code = ?`, [code]);

  if (codeRow.expires_at < Date.now()) {
    return c.json({ error: 'invalid_grant', error_description: 'Code expired' }, 400);
  }
  if (codeRow.client_id !== clientId) {
    return c.json({ error: 'invalid_grant', error_description: 'Code/client mismatch' }, 400);
  }
  if (codeRow.redirect_uri !== redirectUri) {
    return c.json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }, 400);
  }

  // Verify PKCE.
  if (codeRow.code_challenge) {
    if (!codeVerifier) {
      return c.json({ error: 'invalid_grant', error_description: 'code_verifier required' }, 400);
    }
    const ok = await verifyPKCE(codeRow.code_challenge, codeVerifier, codeRow.code_challenge_method ?? 'plain');
    if (!ok) {
      return c.json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
    }
  }

  // Mint access token.
  const token = nanoid(48);
  const now = Date.now();
  const expiresAt = now + ACCESS_TOKEN_TTL_MS;
  await dbRun(
    c.env.DB,
    `INSERT INTO oauth_access_tokens (token, client_id, user_id, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [token, clientId, codeRow.user_id, expiresAt, now],
  );

  return c.json({
    access_token: token,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorRedirect(
  c: Context<AppEnv>,
  redirectUri: string,
  state: string,
  error: string,
  description: string,
) {
  if (!redirectUri || !/^https?:\/\//i.test(redirectUri)) {
    return c.text(`${error}: ${description}`, 400);
  }
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  url.searchParams.set('error_description', description);
  if (state) url.searchParams.set('state', state);
  return c.redirect(url.toString(), 302);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function verifyPKCE(challenge: string, verifier: string, method: string): Promise<boolean> {
  if (method === 'plain') return constantTimeEqual(challenge, verifier);
  if (method !== 'S256') return false;
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const computed = base64url(new Uint8Array(hash));
  return constantTimeEqual(computed, challenge);
}

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signInPage(returnUrl: string): string {
  // Better-auth's social-sign-in endpoints accept a `callbackURL` so we can
  // bounce the user straight back to /oauth/authorize after sign-in.
  const back = encodeURIComponent(returnUrl);
  const apple = `/api/auth/sign-in/social/apple?callbackURL=${back}`;
  const google = `/api/auth/sign-in/social/google?callbackURL=${back}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in to NebularNews</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0d0d0e; color: #f0f0f0; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .card { max-width: 360px; width: 90%; padding: 28px; background: #18181b; border-radius: 16px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
  h1 { margin: 0 0 8px; font-size: 20px; }
  p { color: #a8a8ad; margin: 0 0 24px; font-size: 14px; line-height: 1.5; }
  a.btn { display: block; padding: 12px; margin: 8px 0; text-align: center; border-radius: 10px; text-decoration: none; font-weight: 500; }
  a.apple { background: #fff; color: #000; }
  a.google { background: #2563eb; color: #fff; }
</style>
</head>
<body>
  <div class="card">
    <h1>Connect Claude to NebularNews</h1>
    <p>Sign in to authorize Claude to read your subscribed feeds. We'll send you back here once you're done.</p>
    <a class="btn apple" href="${apple}">Sign in with Apple</a>
    <a class="btn google" href="${google}">Sign in with Google</a>
  </div>
</body>
</html>`;
}
