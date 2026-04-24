import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { createAuth } from '../lib/auth';

export const authRoutes = new Hono<AppEnv>();

// Allowlist for the web sign-in handoff. Anything not in this list is
// rejected — prevents open-redirect abuse of the token endpoint.
const ALLOWED_HANDOFF_TARGETS = new Set<string>([
  'https://admin.nebularnews.com/sign-in/callback',
  'http://localhost:5173/sign-in/callback',
]);

/**
 * GET /api/auth/web-handoff?target=<allowlisted_url>
 *
 * After an OAuth flow completes against api.nebularnews.com, better-auth
 * sets its session cookie on that host. But our web clients live on
 * admin.nebularnews.com (or localhost) — and we keep crossSubDomainCookies
 * disabled so iOS Bearer-token flow stays uncoupled from browser cookies.
 *
 * This endpoint bridges the gap: if the caller already has a valid
 * better-auth session (cookie set by the OAuth callback), we look up the
 * raw session token and redirect to the target URL with ?token=<token>
 * appended. The web app reads that token and plants it in its own
 * httpOnly cookie on admin.nebularnews.com.
 */
authRoutes.get('/auth/web-handoff', async (c) => {
  const target = c.req.query('target') ?? '';
  if (!ALLOWED_HANDOFF_TARGETS.has(target)) {
    return c.json({ ok: false, error: { code: 'bad_request', message: 'Disallowed handoff target' } }, 400);
  }

  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.session?.token) {
    // Not signed in — bounce back with an error indicator so the web app
    // can show a friendly message rather than silently dropping the user.
    const errUrl = new URL(target);
    errUrl.searchParams.set('error', 'not_signed_in');
    return c.redirect(errUrl.toString(), 302);
  }

  const url = new URL(target);
  url.searchParams.set('token', session.session.token);
  return c.redirect(url.toString(), 302);
});

/**
 * Mount better-auth handler at /api/auth/*
 * This handles: sign-in, sign-up, sign-out, session, social providers
 */
authRoutes.all('/auth/*', async (c) => {
  const auth = createAuth(c.env);
  return auth.handler(c.req.raw);
});
