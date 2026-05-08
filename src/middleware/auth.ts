import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../index';
import { dbGet } from '../db/helpers';

interface SessionRow {
  userId: string;
  expiresAt: string;
}

interface OAuthTokenRow {
  user_id: string;
  expires_at: number;
}

/**
 * Auth middleware: validates Bearer tokens against either:
 *   1. better-auth sessions (web sign-in via Apple/Google) — `session.token`
 *   2. OAuth access tokens (issued to MCP clients) — `oauth_access_tokens.token`
 *
 * better-auth's session API only supports cookie lookups, so we go through
 * D1 directly — same code path the iOS app used pre-pivot, plus the new
 * MCP-token branch.
 */
export const requireAuth = () =>
  createMiddleware<AppEnv>(async (c, next) => {
    const authHeader = c.req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return c.json(
        { ok: false, error: { code: 'unauthorized', message: 'Missing authorization token' } },
        401,
      );
    }

    // Path 1: better-auth session (legacy web/iOS Bearer tokens).
    const session = await dbGet<SessionRow>(
      c.env.DB,
      `SELECT userId, expiresAt FROM session WHERE token = ? LIMIT 1`,
      [token],
    );
    if (session) {
      const expiresAt = new Date(session.expiresAt).getTime();
      if (expiresAt < Date.now()) {
        return c.json(
          { ok: false, error: { code: 'unauthorized', message: 'Session expired' } },
          401,
        );
      }
      c.set('userId', session.userId);
      await next();
      return;
    }

    // Path 2: OAuth access token (MCP clients).
    const oauthToken = await dbGet<OAuthTokenRow>(
      c.env.DB,
      `SELECT user_id, expires_at FROM oauth_access_tokens WHERE token = ? LIMIT 1`,
      [token],
    );
    if (oauthToken) {
      if (oauthToken.expires_at < Date.now()) {
        return c.json(
          { ok: false, error: { code: 'unauthorized', message: 'Access token expired' } },
          401,
        );
      }
      c.set('userId', oauthToken.user_id);
      await next();
      return;
    }

    return c.json(
      { ok: false, error: { code: 'unauthorized', message: 'Invalid token' } },
      401,
    );
  });
