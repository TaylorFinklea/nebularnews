import { Hono } from 'hono';
import type { AppEnv } from '../index';
import { getUsageSummary } from '../lib/rate-limiter';

export const usageRoutes = new Hono<AppEnv>();

// GET /usage/summary — daily/weekly token stats for the iOS Settings dashboard
usageRoutes.get('/usage/summary', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;

  const summary = await getUsageSummary(db, userId);
  return c.json({ ok: true, data: summary });
});
