import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../index';
import { createAuth } from '../lib/auth';

/**
 * Auth middleware: validates Bearer token against better-auth session table.
 * Sets c.set('userId', ...) for downstream handlers.
 */
export const requireAuth = () =>
  createMiddleware<AppEnv>(async (c, next) => {
    const auth = createAuth(c.env);

    const headers = new Headers();
    const authHeader = c.req.header('Authorization');
    if (authHeader) {
      headers.set('Authorization', authHeader);
    }
    const cookieHeader = c.req.header('Cookie');
    if (cookieHeader) {
      headers.set('Cookie', cookieHeader);
    }

    const session = await auth.api.getSession({ headers });

    if (!session?.user) {
      return c.json(
        { ok: false, error: { code: 'unauthorized', message: 'Invalid or expired session' } },
        401,
      );
    }

    c.set('userId', session.user.id);
    await next();
  });
