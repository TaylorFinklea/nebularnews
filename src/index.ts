import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env';
import { envelope } from './middleware/envelope';
import { healthRoutes } from './routes/health';

export type AppEnv = { Bindings: Env; Variables: { userId: string } };

const app = new Hono<AppEnv>();

// Global middleware
app.use('*', cors());
app.use('*', envelope());

// Public routes
app.route('/api', healthRoutes);

// TODO: Phase 3 — auth routes + middleware
// TODO: Phase 4 — articles, feeds, tags, settings, today, devices, onboarding
// TODO: Phase 5 — enrich, chat, brief
// TODO: Phase 6 — cron handlers below

export default {
  fetch: app.fetch,
  scheduled: async (
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ) => {
    switch (event.cron) {
      case '*/5 * * * *':
        // ctx.waitUntil(pollFeeds(env));
        break;
      case '0 * * * *':
        // ctx.waitUntil(scoreArticles(env));
        break;
      case '30 3 * * *':
        // ctx.waitUntil(cleanup(env));
        break;
    }
  },
};
