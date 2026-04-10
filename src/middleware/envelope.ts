import { createMiddleware } from 'hono/factory';
import { nanoid } from 'nanoid';

/**
 * Wraps all JSON responses in the standard envelope:
 *   { ok: true, data: ... } or { ok: false, error: { code, message } }
 * Adds x-request-id to every response.
 */
export const envelope = () =>
  createMiddleware(async (c, next) => {
    const requestId = nanoid(12);
    c.header('x-request-id', requestId);

    try {
      await next();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = (err as { status?: number }).status ?? 500;
      return c.json(
        {
          ok: false,
          error: { code: status === 401 ? 'unauthorized' : 'internal_error', message },
          request_id: requestId,
        },
        status as 400,
      );
    }
  });
