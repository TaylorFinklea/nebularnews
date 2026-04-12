import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env';
import { envelope } from './middleware/envelope';
import { requireAuth } from './middleware/auth';
import { healthRoutes } from './routes/health';
import { authRoutes } from './routes/auth';
import { articleRoutes } from './routes/articles';
import { feedRoutes } from './routes/feeds';
import { tagRoutes } from './routes/tags';
import { settingsRoutes } from './routes/settings';
import { todayRoutes } from './routes/today';
import { deviceRoutes } from './routes/devices';
import { onboardingRoutes } from './routes/onboarding';
import { enrichRoutes } from './routes/enrich';
import { chatRoutes } from './routes/chat';
import { briefRoutes } from './routes/brief';
import { usageRoutes } from './routes/usage';
import { mcpRoutes } from './routes/mcp';
import { subscriptionRoutes } from './routes/subscription';
import { pollFeeds } from './cron/poll-feeds';
import { scoreArticles } from './cron/score-articles';
import { cleanup } from './cron/cleanup';

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

protectedApi.route('/', articleRoutes);
protectedApi.route('/', feedRoutes);
protectedApi.route('/', tagRoutes);
protectedApi.route('/', settingsRoutes);
protectedApi.route('/', todayRoutes);
protectedApi.route('/', deviceRoutes);
protectedApi.route('/', onboardingRoutes);

protectedApi.route('/', enrichRoutes);
protectedApi.route('/', chatRoutes);
protectedApi.route('/', briefRoutes);
protectedApi.route('/', usageRoutes);
protectedApi.route('/', mcpRoutes);
protectedApi.route('/', subscriptionRoutes);

app.route('/api', protectedApi);

export default {
  fetch: app.fetch,
  scheduled: async (
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ) => {
    const run = async (name: string, fn: () => Promise<void>) => {
      try { await fn(); }
      catch (err) { console.error(`[cron:${name}]`, err); }
    };
    switch (event.cron) {
      case '*/5 * * * *':
        ctx.waitUntil(run('poll-feeds', () => pollFeeds(env)));
        break;
      case '0 * * * *':
        ctx.waitUntil(run('score-articles', () => scoreArticles(env)));
        break;
      case '30 3 * * *':
        ctx.waitUntil(run('cleanup', () => cleanup(env)));
        break;
    }
  },
};
