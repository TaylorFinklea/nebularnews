import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../index';
import { dbGet } from '../db/helpers';

interface SessionRow {
  id: string;
  userId: string;
  token: string;
  expiresAt: string;
}

/**
 * Auth middleware: validates Bearer token by looking up the session table
 * in D1 directly (better-auth only supports cookie-based getSession,
 * but mobile apps send Bearer tokens).
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

    const session = await dbGet<SessionRow>(
      c.env.DB,
      `SELECT id, userId, token, expiresAt FROM session WHERE token = ? LIMIT 1`,
      [token],
    );

    if (!session) {
      return c.json(
        { ok: false, error: { code: 'unauthorized', message: 'Invalid session token' } },
        401,
      );
    }

    // Check expiry
    const expiresAt = new Date(session.expiresAt).getTime();
    if (expiresAt < Date.now()) {
      return c.json(
        { ok: false, error: { code: 'unauthorized', message: 'Session expired' } },
        401,
      );
    }

    c.set('userId', session.userId);
    await next();
  });
