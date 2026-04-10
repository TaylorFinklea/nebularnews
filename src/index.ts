import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env';
import { envelope } from './middleware/envelope';
import { requireAuth } from './middleware/auth';
import { healthRoutes } from './routes/health';
import { authRoutes } from './routes/auth';

export type AppEnv = { Bindings: Env; Variables: { userId: string } };

const app = new Hono<AppEnv>();

// Global middleware
app.use('*', cors());
app.use('*', envelope());

// Public routes (no auth required)
app.route('/api', healthRoutes);
app.route('/api', authRoutes);

// Protected routes (auth required)
const protectedApi = new Hono<AppEnv>();
protectedApi.use('*', requireAuth());

// TODO: Phase 4 — mount article, feed, tag, settings, today, device, onboarding routes
// TODO: Phase 5 — mount enrich, chat, brief routes

app.route('/api', protectedApi);

export default {
  fetch: app.fetch,
  scheduled: async (
    _event: ScheduledEvent,
    _env: Env,
    _ctx: ExecutionContext,
  ) => {
    // TODO: Phase 6 — cron handlers
  },
};
